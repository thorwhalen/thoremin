/**
 * Category dispatch (#160) — the FIFTH command dispatcher, beside the keyboard, the
 * palette, the AI assistant and the gestures (#129): moving into a learned category runs
 * the command bound to it.
 *
 * The same shape as `gestureDispatch.ts`, deliberately. A learned category is a discrete
 * recognised thing, as a pose is; what differs is only where it comes from (the player's
 * own trained model over the live feature vector, instead of a fixed classifier) and the
 * debounce (the category tracker's entry/exit hysteresis plus a hold, instead of a hold
 * plus a cooldown). The firing rules are `createCategoryEdge`'s (`@thoremin/sdk/enroll`).
 *
 * Further rules (pinned by `test/category_dispatch.test.ts`):
 * - **No set, or hushed: nothing runs.** While a trainer holds a hush claim the player
 *   cannot hear a change, and a trainer run must never re-voice the instrument under them.
 *   The edge is reset, and a reset edge ADOPTS the category the player is in rather than
 *   firing it (`createCategoryEdge` rule 5): closing the trainer, enabling, switching sets
 *   or an engine rebuild arm only future entries.
 * - **Off but previewing**: with binding off and the bindings panel open, the edge still
 *   classifies (the readout works) and every entry is spent, so turning binding on while
 *   holding a category does not fire it.
 * - **A binding EDIT does not reset the edge** (the store keeps the model object), so
 *   binding a category while holding it does not fire it until re-entry.
 * - **An entry with no binding is spent**, as an unbound gesture is.
 * - **Unknown or confirmation-gated commands are refused with a toast**, never dispatched
 *   ({@link isGestureBindable} is the one rule for any hands-free trigger).
 *
 * A bound categorizer's moving GESTURES (#754) are dispatched beside its categories, from the
 * same projected vector, by a live listener (`createGestureListener`: the matcher of the saved
 * traces, its own noise estimate, a refractory period): a gesture is an EVENT, so its command runs
 * when the matcher FIRES (each repetition), never on an entry, under the same rules otherwise (no
 * set or hushed: the listener is reset; off: a fire is spent; unbound: spent; unknown or
 * confirmation-gated: refused with a toast). What a fire's variation (speed, size) passes to its
 * command is #755's ({@link gestureArgs} is the seam).
 *
 * Time is an INPUT (`tick(nowMs)`), driven by the frame loop in `useEngine` after the
 * tick that updated the live vector. The latest reading is kept in a module holder for the
 * panel to poll at UI rate (the `liveVector.ts` pattern: never a per-tick store write).
 */
import { isErr, type Result } from 'acture';
import {
  createCategoryEdge,
  categoryName,
  toCategoryScores,
  type CategoryBinding,
  type CategoryEdge,
  type FeatureVector,
  type TrainedModel,
} from '@thoremin/sdk/enroll';
import { createGestureListener, type GestureFire, type GestureListener, type GestureModel } from '@thoremin/sdk/enroll/gestures';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import { registry } from '../commands/registry';
// The extensions' commands join the registry (#600 S11).
import '@/app/host/contributions';
import { isGestureBindable } from '../gestures/gestureDispatch';
import { useControls } from '../store';
import { useToasts } from '../shell/toasts';
import { readLiveVector } from './liveVector';
import { useTools } from '../tools/toolsStore';
import { CATEGORY_PANEL_TOOL, presenceFor, readFor, useCategoryBinding, type SavedCategories } from './categoryBinding';

const FIRE_TOAST_MS = 2500;
const ERROR_TOAST_MS = 5000;

/** What the panel shows: the reading as CategoryScores, the category the player is in, and
 *  the model it was read with (so a panel that just switched sets can ignore an old one). */
export interface CategoryLive {
  model: TrainedModel;
  scores: CategoryScores;
  committed: string | null;
  /** How many times each gesture fired since its set became active (#754), by gesture id. */
  gestureFires: Readonly<Record<string, number>>;
}

let live: CategoryLive | null = null;
/** The latest reading of the active set, or null while dispatch is not running. */
export function readCategoryLive(): CategoryLive | null {
  return live;
}

/** The injectable seams (tests swap all of them; the app uses the defaults). */
export interface CategoryDispatcherDeps {
  getActive(): SavedCategories | null;
  isEnabled(): boolean;
  /** True while the bindings panel is open: classify for its readout, even with binding off. */
  isPreviewing(): boolean;
  holdMs(): number;
  /** True while something (a trainer) has the instrument hushed. */
  isHushed(): boolean;
  readVector(): FeatureVector | null;
  hasCommand(id: string): boolean;
  commandTitle(id: string): string;
  isBindable(id: string): boolean;
  dispatch(command: string, args?: unknown): Promise<Result<unknown>>;
  notify(message: string, level?: 'info' | 'error'): void;
  /** The listener a set's gestures are heard with (#754; `createGestureListener` by default). */
  listen(model: GestureModel): GestureListener;
}

/**
 * The args a gesture's command runs with: the binding's own, for now. The #755 seam: a fire carries
 * its `variation` (how fast, how big), which the causal matcher's phase will pass on here.
 */
export function gestureArgs(binding: CategoryBinding, _fire: GestureFire): unknown {
  return binding.args;
}

function defaultDeps(): CategoryDispatcherDeps {
  return {
    getActive: () => useCategoryBinding.getState().active,
    isEnabled: () => useCategoryBinding.getState().enabled,
    isPreviewing: () => useTools.getState().open === CATEGORY_PANEL_TOOL,
    holdMs: () => useCategoryBinding.getState().holdMs,
    isHushed: () => useControls.getState().hushedBy.length > 0,
    readVector: () => readLiveVector()?.vector ?? null,
    hasCommand: (id) => registry.has(id),
    commandTitle: (id) => registry.get(id)?.title ?? id,
    isBindable: isGestureBindable,
    dispatch: (command, args) => registry.dispatch(command, args),
    notify: (message, level = 'info') =>
      useToasts.getState().push(message, level === 'error' ? ERROR_TOAST_MS : FIRE_TOAST_MS, level),
    listen: (model) => createGestureListener(model),
  };
}

export interface CategoryDispatcher {
  tick(nowMs: number): void;
}

/** Build a category dispatcher (fresh edge state; one per engine run). */
export function createCategoryDispatcher(overrides: Partial<CategoryDispatcherDeps> = {}): CategoryDispatcher {
  const deps: CategoryDispatcherDeps = { ...defaultDeps(), ...overrides };
  let model: TrainedModel | null = null;
  let edge: CategoryEdge | null = null;
  /** How the active set reads the live vector (#385 E8; its tuning since #371), kept per set. */
  let readSet: SavedCategories | null = null;
  let project: (v: FeatureVector) => FeatureVector = (v) => v;
  let tune: ((v: FeatureVector) => FeatureVector) | undefined;
  /** The set's gestures (#754): the model the listener was made for, the listener, the fires. */
  let gestureModel: GestureModel | null = null;
  let listener: GestureListener | null = null;
  let gestureFires: Record<string, number> = {};

  /** Run the binding of `id` (a category's entry, or a gesture's fire), named `label`. */
  const fire = (set: SavedCategories, id: string, label: string, args: (binding: CategoryBinding) => unknown = (b) => b.args) => {
    // Own keys only: an id such as `constructor` reads as present on any `{}` (#338).
    const bindings = set.categories.bindings;
    const binding = Object.hasOwn(bindings, id) ? bindings[id] : undefined;
    if (!binding) return; // an unbound entry is spent
    if (!deps.hasCommand(binding.command)) {
      deps.notify(`${label}: unknown command "${binding.command}". Rebind it in the Gestures panel`, 'error');
      return;
    }
    if (!deps.isBindable(binding.command)) {
      deps.notify(`${label}: "${binding.command}" needs confirmation and cannot be fired hands-free`, 'error');
      return;
    }
    const title = deps.commandTitle(binding.command);
    void deps.dispatch(binding.command, args(binding)).then(
      (result) => {
        if (isErr(result)) deps.notify(`${label}: ${result.error.message}`, 'error');
        else deps.notify(`${label} → ${title}`);
      },
      (e: unknown) => deps.notify(`${label}: ${e instanceof Error ? e.message : String(e)}`, 'error'),
    );
  };

  return {
    tick(nowMs) {
      const set = deps.getActive();
      const enabled = deps.isEnabled();
      if (!set || deps.isHushed() || !(enabled || deps.isPreviewing())) {
        edge?.reset();
        listener?.reset();
        live = null;
        return;
      }
      if (set.categories.model !== model || !edge) {
        model = set.categories.model;
        const minPresent = presenceFor(set.categories.read);
        edge = createCategoryEdge(model, minPresent !== undefined ? { minPresent } : {});
      }
      edge.setHoldMs(deps.holdMs());
      if (set !== readSet) {
        readSet = set;
        project = readFor(set.categories.read, set.categories.model);
        // A carved categorizer's live tuning (#453), after the projection, as its tool applies it.
        tune = set.tune;
      }
      const gm = set.gestures?.model ?? null;
      if (gm !== gestureModel) {
        gestureModel = gm;
        listener = gm && gm.gestures.length > 0 ? deps.listen(gm) : null;
        gestureFires = {};
      }
      const raw = deps.readVector();
      const projected = raw ? project(raw) : null;
      const step = edge.push(projected && tune ? tune(projected) : projected, nowMs);
      // A gesture is heard on the projected vector (the tuning is the held categories').
      const fired = listener?.push(projected, nowMs) ?? null;
      if (fired) gestureFires = { ...gestureFires, [fired.gesture]: (gestureFires[fired.gesture] ?? 0) + 1 };
      live = { model, scores: toCategoryScores(model, step.reading), committed: edge.current(), gestureFires };
      // An entry that completes while binding is off (a preview) is spent, not deferred.
      if (step.entered && enabled) fire(set, step.entered, categoryName(set.categories.model, step.entered));
      // So is a gesture's fire.
      if (fired && enabled) {
        const label = set.gestures?.names.find((g) => g.id === fired.gesture)?.label.trim() || fired.gesture;
        fire(set, fired.gesture, label, (b) => gestureArgs(b, fired));
      }
    },
  };
}

/** Forget the live reading (engine teardown, tests). */
export function resetCategoryLive(): void {
  live = null;
}
