/**
 * Tagging runtime store (#92) — the thoremin glue that binds the pure `taglog` core
 * to the live app. This is a DEDICATED zustand store, deliberately SEPARATE from
 * `src/app/store.ts`: it owns nothing the instrument persists and never bumps that
 * store's persist version. Tag DEFINITIONS + config persist through the `taglog`
 * provider (localStorage, the zodal way); only live per-tick runtime state lives here
 * (read synchronously by the overlay + button stack, same discipline as `useControls`).
 *
 * What lives here: the active tag set (`defs`), session `config`, tagging `mode`
 * on/off, the live open/seq `state`, the active recording `take` (with its JSONL
 * sink), and the presentation `countdown`. The take lifecycle (`beginTake`/`endTake`)
 * is driven by the recorder via the {@link TagStreamSource} adapter (`runtime.ts`).
 *
 * The tick/audio loop is never awaited here — persistence is debounced and the
 * provider is only touched on setup/edits, never on a toggle.
 */
import { create } from 'zustand';
import type { DataProvider } from '@zodal/store';
import {
  applyToggle,
  closeAll,
  emptyTagState,
  TagDefSchema,
  DEFAULT_TAGGING_CONFIG,
  TAGS_SCHEMA_ID,
  type TagDef,
  type TaggingConfig,
  type TagState,
  type TagSrc,
} from '@/taglog/affordances';
import { TagEventSink } from '@/taglog/provider/sink';
import {
  createTagSetProvider,
  loadLastUsed,
  saveTagSet,
  TagSetDocSchema,
  type TagSetDoc,
} from '@/taglog/provider/defsStore';
import type { TagOverlaySnapshot } from '@/taglog/presentation';

/** The active take's runtime context (present only while recording). */
interface TakeContext {
  t0: number;
  session: string;
  sink: TagEventSink;
}

/** The presentation countdown for a just-opened tag with a lead-in (§6). */
export interface CountdownState {
  tagId: string;
  label: string;
  leadIn: number;
  /** perf-seconds when the open fired; the component derives remaining from this. */
  startPerf: number;
}

interface TaggingState {
  /** Tagging mode on/off — shows the button stack + arms the 1..9 keys. */
  mode: boolean;
  /** The active, ordered tag set. */
  defs: TagDef[];
  /** Session-level config (exclusivity, codec, clock, offset). */
  config: TaggingConfig;
  /** Live open/seq state (the toggle state machine's data). */
  state: TagState;
  /** The active recording take, or null when not recording. */
  take: TakeContext | null;
  /** The active lead-in countdown, or null. */
  countdown: CountdownState | null;
  /** Bumped whenever a point fires — a cheap signal for one-shot flash animations. */
  pulse: number;
  /** The tag id of the most recent point fire (paired with `pulse`), so a button can
   *  flash on a keyboard-triggered point, not just a click. */
  lastPoint: string | null;
  /** Engine-clock source in seconds (performance.now()/1000 = the DAG `ctx.time` on
   *  the live rAF path). Injectable for tests. NOTE: this reads the wall clock
   *  directly, so it equals `ctx.time` only while the engine runs in real time. If
   *  batch/speed-scaled recording (the Clock abstraction) is ever wired into a live
   *  take, tags.jsonl (this clock) and features.jsonl (`ctx.time`) would diverge —
   *  route both through one clock source then. */
  clock: () => number;

  // ---- selectors ----
  isOpen(tagId: string): boolean;
  /** True if this take should write a tags.jsonl (mode on + tags defined). */
  active(): boolean;
  /** The burned-in-overlay snapshot (null unless recording). */
  overlaySnapshot(): TagOverlaySnapshot | null;

  // ---- mode + setup ----
  setMode(on: boolean): void;
  setDefs(defs: TagDef[]): void;
  setConfig(patch: Partial<TaggingConfig>): void;
  addTag(partial?: Partial<TagDef>): void;
  updateTag(id: string, patch: Partial<TagDef>): void;
  removeTag(id: string): void;
  moveTag(id: string, dir: -1 | 1): void;

  // ---- live actions (the hot path — never awaits) ----
  toggle(tagId: string, src: TagSrc): void;
  toggleByNumber(n: number, src: TagSrc): void;
  closeAllTags(src: TagSrc): void;
  clearCountdown(): void;

  // ---- take lifecycle (called by the recorder) ----
  beginTake(input: { t0: number; startedAt: string; session: string }): void;
  endTake(endT: number): string;

  // ---- persistence ----
  hydrate(): Promise<void>;

  /** Test hook: override the clock. */
  _setClock(fn: () => number): void;
}

/** Assign positional numbers (1..9 by order; null past the ninth) + display order. */
export function renumber(defs: TagDef[]): TagDef[] {
  return defs.map((d, i) => ({ ...d, order: i, number: i < 9 ? i + 1 : null }));
}

/** A small starter set so the button stack is usable on first open (pre-seed is
 *  overwritten by the last-used set once one has been saved). */
export function defaultTagSet(): TagDef[] {
  return renumber([
    TagDefSchema.parse({ id: 'tag_a', label: 'A', kind: 'interval', color: '#34d399' }),
    TagDefSchema.parse({ id: 'tag_b', label: 'B', kind: 'interval', color: '#60a5fa' }),
    TagDefSchema.parse({ id: 'tag_c', label: 'C', kind: 'point', color: '#f59e0b' }),
  ]);
}

/** A fresh unique tag id (app glue — Math.random is fine here, never in pure code). */
function newTagId(): string {
  return 'tag_' + Math.random().toString(36).slice(2, 8);
}

// --- persistence: a lazily-created provider + a debounced "last-used" save ---------
let _provider: DataProvider<TagSetDoc> | null = null;
function provider(): DataProvider<TagSetDoc> {
  return (_provider ??= createTagSetProvider());
}
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced persist of the current defs+config as the "last-used" tag set. Best
 *  effort — a storage failure never disrupts tagging. */
function persist(get: () => TaggingState): void {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const s = get();
    const doc = TagSetDocSchema.parse({
      id: 'last',
      name: 'Last used',
      tags: s.defs,
      config: s.config,
      updatedAt: Date.now(),
    });
    void saveTagSet(provider(), doc).catch(() => {});
  }, 400);
}

export const useTagging = create<TaggingState>((set, get) => ({
  mode: false,
  defs: [],
  config: DEFAULT_TAGGING_CONFIG,
  state: emptyTagState(),
  take: null,
  countdown: null,
  pulse: 0,
  lastPoint: null,
  clock: () => performance.now() / 1000,

  isOpen: (tagId) => get().state.open[tagId] !== undefined,
  active: () => {
    const s = get();
    return s.mode && s.defs.length > 0;
  },
  overlaySnapshot: () => {
    const s = get();
    if (!s.take) return null;
    const open = Object.keys(s.state.open).map((id) => {
      const d = s.defs.find((x) => x.id === id);
      return { tag: id, label: d?.label ?? id, color: d?.color ?? '#34d399' };
    });
    return { t0: s.take.t0, open };
  },

  setMode: (on) => {
    if (on) {
      void get().hydrate();
      set({ mode: true });
    } else {
      // Leaving tagging mode clears the live open state so buttons stop blinking; a
      // take in progress keeps its own log (its `sink` is captured in `take`).
      set({ mode: false, state: emptyTagState(), countdown: null });
    }
  },

  setDefs: (defs) => {
    set({ defs: renumber(defs) });
    persist(get);
  },
  setConfig: (patch) => {
    set((s) => ({ config: { ...s.config, ...patch } }));
    persist(get);
  },
  addTag: (partial) => {
    const def = TagDefSchema.parse({ id: newTagId(), label: 'Tag', kind: 'interval', ...partial });
    set((s) => ({ defs: renumber([...s.defs, def]) }));
    persist(get);
  },
  updateTag: (id, patch) => {
    set((s) => ({ defs: renumber(s.defs.map((d) => (d.id === id ? TagDefSchema.parse({ ...d, ...patch, id }) : d))) }));
    persist(get);
  },
  removeTag: (id) => {
    set((s) => ({ defs: renumber(s.defs.filter((d) => d.id !== id)) }));
    persist(get);
  },
  moveTag: (id, dir) => {
    set((s) => {
      const i = s.defs.findIndex((d) => d.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.defs.length) return s;
      const next = [...s.defs];
      [next[i], next[j]] = [next[j], next[i]];
      return { defs: renumber(next) };
    });
    persist(get);
  },

  toggle: (tagId, src) => {
    const s = get();
    const def = s.defs.find((d) => d.id === tagId);
    if (!def) return;
    const perf = s.clock();
    // ABSOLUTE engine-clock seconds (= ctx.time = performance.now()/1000) — the SAME
    // stamp features.jsonl uses, so the two label streams share one frame by
    // construction. The take offset is `t - t0` per the manifest SSOT; NEVER subtract
    // t0 here or a consumer following the manifest would double-subtract it. During
    // rehearsal (no take) t is unused (nothing is logged).
    const t = perf;
    const { state, edges } = applyToggle(s.state, s.defs, { tagId, t, src }, s.config);
    if (s.take && edges.length) s.take.sink.append(edges);
    const opened = edges.find((e) => e.tag === tagId && e.status === 'open');
    const firedPoint = edges.some((e) => e.status === 'point');
    set({
      state,
      countdown: opened && def.leadIn > 0 ? { tagId, label: def.label, leadIn: def.leadIn, startPerf: perf } : s.countdown,
      pulse: firedPoint ? s.pulse + 1 : s.pulse,
      // The just-fired point tag id (with the bumped pulse) drives its button's flash
      // for BOTH click and keyboard, since both toggles route through here.
      lastPoint: firedPoint ? tagId : s.lastPoint,
    });
  },
  toggleByNumber: (n, src) => {
    const def = get().defs.find((d) => d.number === n);
    if (def) get().toggle(def.id, src);
  },
  closeAllTags: (src) => {
    const s = get();
    // Absolute engine clock, same as toggle() (see the note there).
    const t = s.clock();
    const { state, edges } = closeAll(s.state, s.defs, t, s.config, src);
    if (s.take && edges.length) s.take.sink.append(edges);
    set({ state, countdown: null });
  },
  clearCountdown: () => set({ countdown: null }),

  beginTake: ({ t0, startedAt, session }) => {
    const s = get();
    const sink = new TagEventSink(s.config.codec);
    // The anchor documents the origin so the file is self-describing: `t` is the
    // absolute engine-clock t0 (== manifest.t0). Every event `t` minus this is its
    // offset into the take — the same rule the manifest applies to every stream.
    sink.writeAnchor({
      anchor: true,
      t: t0,
      clock: s.config.clock,
      wallClockISO: startedAt,
      recStartPerf: t0 * 1000,
      session,
      schema: TAGS_SCHEMA_ID,
    });
    // Fresh log per take: seq starts at 0, no carried-over open tags (the recorded
    // intervals are exactly what is toggled during the take).
    set({ take: { t0, session, sink }, state: emptyTagState(), countdown: null });
  },
  endTake: (endT) => {
    const s = get();
    if (!s.take) return '';
    const { edges } = closeAll(s.state, s.defs, endT, s.config, 'auto');
    if (edges.length) s.take.sink.append(edges);
    const jsonl = s.take.sink.drain();
    set({ take: null, state: emptyTagState(), countdown: null });
    return jsonl;
  },

  hydrate: async () => {
    try {
      const last = await loadLastUsed(provider());
      if (last && last.tags.length) {
        set({ defs: renumber(last.tags), config: last.config });
        return;
      }
    } catch {
      /* no storage — fall through to the in-memory default */
    }
    if (!get().defs.length) set({ defs: defaultTagSet() });
  },

  _setClock: (fn) => set({ clock: fn }),
}));
