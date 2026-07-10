/**
 * taglog — the toggle state machine (design §7, §8).
 *
 * `applyToggle` turns one neutral {@link TagAction} into the next {@link TagState}
 * plus the semantic {@link EdgeEvent}s it produced. It is the single, pure heart of
 * live tagging: interval open <-> close, point emit, BORIS-style mutual-exclusivity
 * auto-close of open siblings, lead-in correction, and monotonic `seq` assignment.
 *
 * Ordering rule (§7, §11.2): an auto-close carries a LOWER `seq` than the triggering
 * open (it is emitted first), so `resolveIntervals` sees the sibling close before the
 * new open with NO epsilon time-nudge — stored times stay clean. Keyboard and mouse
 * are indistinguishable here; only `src` differs.
 *
 * Pure: no React, no storage, no timers. `state` in -> `{state, edges}` out.
 */
import { correctedTime, isDegenerate } from './leadIn';
import {
  DEFAULT_EXCLUSIVITY_GROUP,
  type EdgeEvent,
  type TagAction,
  type TagDef,
  type TaggingConfig,
  type TagSrc,
  type TagState,
} from './schema';

/** The result of applying an action: the new (immutably-derived) state + edges. */
export interface ToggleResult {
  state: TagState;
  edges: EdgeEvent[];
}

/** The exclusion group a tag belongs to under the active mode, or null if none.
 *  `single` collapses every interval tag into one implicit group; `group` uses the
 *  tag's declared `group`; `off` means no exclusivity. */
function exclusionGroup(def: TagDef, config: TaggingConfig): string | null {
  if (def.kind !== 'interval') return null; // a point can't be "open" (§7)
  switch (config.exclusivity) {
    case 'off':
      return null;
    case 'single':
      return DEFAULT_EXCLUSIVITY_GROUP;
    case 'group':
      return def.group;
  }
}

/** Shallow-clone a state so callers never mutate the input (React/store friendly). */
function cloneState(state: TagState): TagState {
  return { open: { ...state.open }, seq: state.seq };
}

/** Emit a close edge for an open interval tag and remove it from `open`. Mutates the
 *  (already-cloned) `state` and pushes to `edges`. Used by both a manual close and an
 *  auto-close. `degenerate` is computed against the stored open's corrected time. */
function closeOpenTag(
  state: TagState,
  edges: EdgeEvent[],
  def: TagDef,
  t: number,
  src: TagSrc,
  clock: TaggingConfig['clock'],
): void {
  const open = state.open[def.id];
  if (!open) return;
  const tCorrected = correctedTime('close', t, def.leadIn);
  const degenerate = isDegenerate(open.openCorrected, tCorrected);
  edges.push({
    tag: def.id,
    kind: def.kind,
    status: 'close',
    t,
    tCorrected,
    seq: state.seq++,
    clock,
    src,
    ...(degenerate ? { degenerate: true } : {}),
  });
  delete state.open[def.id];
}

/**
 * Apply one toggle/point action. Returns the next state and the edges produced
 * (0..N — a point is 1, an interval open in exclusive mode may be several: the
 * auto-closes of open siblings, then the open). A no-op (unknown tag) returns the
 * input state unchanged and no edges.
 */
export function applyToggle(
  state: TagState,
  defs: readonly TagDef[],
  action: TagAction,
  config: TaggingConfig,
): ToggleResult {
  const def = defs.find((d) => d.id === action.tagId);
  if (!def) return { state, edges: [] };

  const next = cloneState(state);
  const edges: EdgeEvent[] = [];
  const { t, src } = action;
  const clock = config.clock;

  // A point is instantaneous — one edge, no open-state, unaffected by exclusivity.
  if (def.kind === 'point') {
    edges.push({
      tag: def.id,
      kind: 'point',
      status: 'point',
      t,
      tCorrected: correctedTime('point', t, def.leadIn),
      seq: next.seq++,
      clock,
      src,
    });
    return { state: next, edges };
  }

  // Interval: open tag -> close it; else open it (auto-closing exclusion siblings).
  if (next.open[def.id]) {
    closeOpenTag(next, edges, def, t, src, clock);
    return { state: next, edges };
  }

  const group = exclusionGroup(def, config);
  if (group !== null) {
    // Auto-close every OTHER open interval tag in the same group first (lower seq).
    for (const openId of Object.keys(next.open)) {
      if (openId === def.id) continue;
      const openDef = defs.find((d) => d.id === openId);
      if (openDef && exclusionGroup(openDef, config) === group) {
        closeOpenTag(next, edges, openDef, t, 'auto', clock);
      }
    }
  }

  const openCorrected = correctedTime('open', t, def.leadIn);
  const seq = next.seq++;
  edges.push({ tag: def.id, kind: 'interval', status: 'open', t, tCorrected: openCorrected, seq, clock, src });
  next.open[def.id] = { openT: t, openCorrected, seq, leadIn: def.leadIn };
  return { state: next, edges };
}

/**
 * Close every currently-open interval tag (the `0` "panic / clean-stop" key, and the
 * take-end sweep). Emits close edges in a stable order (by open seq) so the log is
 * deterministic. `src` records the trigger (`key` for the 0 key, `auto` for take-end).
 */
export function closeAll(
  state: TagState,
  defs: readonly TagDef[],
  t: number,
  config: TaggingConfig,
  src: TagSrc = 'key',
): ToggleResult {
  const next = cloneState(state);
  const edges: EdgeEvent[] = [];
  const openIds = Object.keys(next.open).sort((a, b) => next.open[a].seq - next.open[b].seq);
  for (const id of openIds) {
    const def = defs.find((d) => d.id === id);
    if (def) closeOpenTag(next, edges, def, t, src, config.clock);
    else delete next.open[id]; // orphaned open (def removed) — drop it
  }
  return { state: next, edges };
}
