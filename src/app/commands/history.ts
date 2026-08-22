/**
 * Undo/redo over the dials layer (#127) — the third reading of the one dispatch seam.
 *
 * ## Why this is hand-written and not `acture-undo`
 *
 * #127 proposes `acture-undo`, and it does not fit — for a structural reason worth
 * recording rather than rediscovering. `acture-undo` builds its history by observing
 * `adapter.setStateWithPatches` on a `PatchCapableAdapter`. thoremin's registry
 * **holds no acture adapter at all**: by deliberate design (see `registry.ts`) handlers
 * reach state by closure-capturing the dials store, so the registry stays a pure command
 * index. The store itself is `@zodal/dials-ui`'s `createSettingsStore`, which exposes
 * `set`/`reset`/`setLayer` and emits no patches. Adopting `acture-undo` would mean
 * writing a patch-capable adapter over a store we do not own, to reconstruct information
 * we can read directly. `acture-undo`'s own README names the alternative — "an agent can
 * hand-write this integration into your project instead" — and this is it.
 *
 * ## Why a whole-layer snapshot, not per-command inverses
 *
 * The obvious design is an inverse per command (`dial.set` ⇄ the previous value). It is
 * also the fragile one: every new mutating command must remember to supply an inverse,
 * and the day one forgets, undo silently skips a write instead of failing loudly. The
 * dials layer is a small sparse map, so we snapshot it whole, before and after, and push
 * an entry only when it ACTUALLY CHANGED (deep-compared). That buys three things:
 *
 * - **Command-agnostic.** A command added tomorrow gets undo for free, including
 *   `instrument.load`, which replaces the entire layer in one go.
 * - **`dial.patch` is atomic in the history too.** A synced-hands voice edit writes the
 *   primary field and its mirror; one dispatch is one entry, so one undo takes back the
 *   whole thing rather than half a mirrored pair.
 * - **A failed or no-op command leaves no entry.** Nothing to special-case: if the layer
 *   is unchanged there is nothing to undo, which is also the right answer for a query.
 *
 * ## Two properties to know
 *
 * - **Slider drags are invisible here** (Decision B: continuous `type="range"` writes
 *   bypass the registry for latency). Undo therefore steps through discrete choices and
 *   skips drags entirely. That is arguably the correct coalescing — you rarely want to
 *   undo one pointer-move frame — but it is a consequence, not a decision anyone made,
 *   so it is stated rather than discovered.
 * - **Undo/redo apply via `setLayer`, outside dispatch.** So the middleware never sees
 *   its own writes and cannot record an undo of an undo. `redo` is what re-applies.
 */
import { isOk } from 'acture';
import type { Layer, SettingKey } from '@zodal/dials-core';
import type { Middleware } from './middleware';

/** The slice of the dials store the history needs — narrowed so tests can pass a fake. */
export interface LayerStoreLike {
  getState(): { layer: Layer };
  setLayer(layer: Layer): void;
}

/** One undoable step: the editable layer either side of a dispatch that changed it. */
export interface HistoryEntry {
  /** The command id that produced the change (the label an undo UI would show). */
  command: string;
  /** The editable layer before the dispatch. */
  before: Layer;
  /** The editable layer after the dispatch. */
  after: Layer;
}

export interface DialsHistory {
  /** The middleware to install on the registry. */
  middleware: Middleware;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Revert the most recent change. Returns false if there was nothing to undo. */
  undo(): boolean;
  /** Re-apply the most recently undone change. Returns false if there was nothing to redo. */
  redo(): boolean;
  /** Forget all history (both stacks). */
  clear(): void;
  /** The command id undo would revert, for a menu label / tooltip. */
  undoLabel(): string | undefined;
  /** The command id redo would re-apply. */
  redoLabel(): string | undefined;
  /** How many undoable entries are held. */
  size(): number;
}

/** Bounded so a long session cannot grow the history without limit. */
const DEFAULT_LIMIT = 100;

/**
 * Deep clone a layer value. NOT `structuredClone`: a `Layer` value may be the dials-core
 * `UNSET` sentinel, which is a **symbol** — `structuredClone` throws on symbols, so a
 * single explicitly-unset dial would break the whole history. Symbols (and every other
 * primitive) pass through by identity here, which is exactly right for a sentinel.
 */
function cloneValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = cloneValue(v);
  return out;
}

/** Snapshot the editable layer, detached from the store's own object graph. */
function cloneLayer(layer: Layer): Layer {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(layer)) out[k] = cloneValue(v);
  return out as Layer;
}

/**
 * Structural equality, symbol-safe and key-order-independent. A hand-rolled walk rather
 * than `JSON.stringify` comparison: stringify drops the `UNSET` symbol (so an unset dial
 * would compare equal to an absent one) and is key-order sensitive (so an object rebuilt
 * by `setIn`'s spread could compare unequal to an identical one).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** True when two editable layers hold the same keys and the same values. */
export function layersEqual(a: Layer, b: Layer): boolean {
  return deepEqual(a, b);
}

/**
 * Build an undo history over a dials-like store. `limit` bounds the undo stack; the
 * oldest entry is dropped when it is exceeded.
 */
export function createDialsHistory(
  store: LayerStoreLike,
  options: { limit?: number } = {},
): DialsHistory {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];

  const middleware: Middleware = (next) => async (command, params, context, ...rest) => {
    const before = cloneLayer(store.getState().layer);
    const result = await next(command, params, context, ...rest);
    if (!isOk(result as never)) return result;
    const after = cloneLayer(store.getState().layer);
    if (layersEqual(before, after)) return result; // a query, or a write that changed nothing
    undoStack.push({ command, before, after });
    if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit);
    redoStack.length = 0; // a new branch discards the redo future
    return result;
  };

  return {
    middleware,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      store.setLayer(cloneLayer(entry.before));
      redoStack.push(entry);
      return true;
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      store.setLayer(cloneLayer(entry.after));
      undoStack.push(entry);
      return true;
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    undoLabel: () => undoStack[undoStack.length - 1]?.command,
    redoLabel: () => redoStack[redoStack.length - 1]?.command,
    size: () => undoStack.length,
  };
}

/** Re-exported for callers that hold a `SettingKey` — keeps the type import local. */
export type { SettingKey };
