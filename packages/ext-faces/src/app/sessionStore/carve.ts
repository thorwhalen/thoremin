/**
 * The face session's one editable carve (#385 E4): showing a categorizer (a fresh carve or an
 * opened one), committing an edit as one undo step, restoring a merge's edit history, the
 * re-cut options and the room left under the size bound. A concern of
 * `createFaceSessionStore` (#746).
 */
import { type RecutOptions, recutBounds, recutRange, consistentPins, type SortResult } from '@thoremin/sdk/enroll/sorting';
import { TRAIN_DEFAULTS } from '@thoremin/sdk/enroll/classify';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { type FaceSessionState, FACE_SESSION_DEFAULTS } from './state';
import { sortingView, nameCarve, carveTake } from '../../lib/carving';
import type { MergeBase } from './locals';
import type { CorrectionResult } from '../../lib/corrections';
import type { createStills } from './stills';
import type { SessionCtx } from './locals';

/** The carve's helpers over the store's shared state. */
export function createCarve(ctx: SessionCtx, h: Pick<ReturnType<typeof createStills>, 'loadThumbs'>) {
  const { deps, get, loc, modality, set } = ctx;
  const { loadThumbs } = h;
  /** What a re-cut of the working categorizer trains its reject radius from. */
  const recutOptions = (): RecutOptions =>
    loc.fresh ? { rest: loc.fresh.rest, baseRejectRadius: TRAIN_DEFAULTS.defaultRejectRadius } : { baseRejectRadius: loc.baseRadius };
  /** Show `working` in the sorting grid: its view, its stills by sample id (in memory from this
   *  session's takes first, then filed in IndexedDB). An open categorizer learns whether it has
   *  pictures from what is found; a fresh take's are still being encoded. */
  const showDoc = (working: PersonalCategorizer, patch: Partial<FaceSessionState> = {}) => {
    // The bounds on every show; the suggestion (which builds the forest) only for a pool a
    // person can wait for.
    const bounds = recutBounds(working, recutOptions());
    const recutable = bounds.pool <= FACE_SESSION_DEFAULTS.recutUpTo;
    const maxK = Math.min(bounds.maxK, FACE_SESSION_DEFAULTS.maxCategories);
    const suggested = recutable && bounds.pool <= FACE_SESSION_DEFAULTS.suggestUpTo ? recutRange(working, recutOptions()).suggestedK : working.categories.length;
    const range = recutable ? { minK: bounds.minK, maxK, suggestedK: Math.min(suggested, maxK), recutable } : { minK: working.categories.length, maxK: working.categories.length, suggestedK: working.categories.length, recutable };
    // Past the pool whose suggestion is built here, the forest would be built by the first
    // re-cut: have a worker build it now (the cache is keyed on content, so a stale answer is harmless).
    if (recutable && bounds.pool > FACE_SESSION_DEFAULTS.suggestUpTo) void deps.forests?.prefetch(working, recutOptions());
    const view = sortingView(working, { sources: loc.sources, range, neutralKnown: loc.fresh ? loc.fresh.cloud !== null : true, modality });
    loc.shownIds = working.samples.map((x) => x.id);
    loc.figureUrls.clear();
    if (deps.figure) {
      for (const x of working.samples) {
        // The figure kept with the sample, else drawn from its vector (a file made without one).
        const skeleton = x.skeleton ?? modality.skeleton?.(x.vector) ?? null;
        const url = skeleton ? deps.figure(skeleton) : null;
        if (url) loc.figureUrls.set(x.id, url);
      }
    }
    set({ working, view, strangers: working.strangers, hand: working.hand ?? 'either', mirror: working.mirror === true, vocabulary: working.vocabulary ?? null, k: view.k, history: { undo: loc.undoStack.length, redo: loc.redoStack.length }, ...patch });
    const gen = loc.generation;
    void loadThumbs(loc.shownIds).then((found) => {
      if (gen === loc.generation && get().working === working && get().phase === 'saved') set({ hasStills: found });
    });
  };
  /** Show an opened categorizer (phase `saved`): a fresh history, its names as saved. */
  const showOpened = (opened: PersonalCategorizer, patch: Partial<FaceSessionState> = {}) => {
    const working = consistentPins(opened);
    loc.fresh = null;
    loc.lastWasK = false;
    loc.baseRadius = working.rejectRadius;
    loc.sources = new Map();
    loc.undoStack = [];
    loc.redoStack = [];
    showDoc(working, { phase: 'saved', ...patch });
  };
  /** Put back the edit state a merge take left (its history, names and radius). */
  const restoreEdits = (e: MergeBase['edits']) => {
    // A fresh carve keeps its first take's rest (#421): the reject radius and Neutral's seed.
    loc.fresh = e.fresh;
    loc.sources = e.sources;
    loc.undoStack = e.undo;
    loc.redoStack = e.redo;
    loc.baseRadius = e.baseRadius;
    loc.lastWasK = false;
  };
  /** Make `next` the working categorizer, as one undoable edit: its unnamed categories named. */
  const commit = (next: PersonalCategorizer, patch: Partial<FaceSessionState> = {}, { k = false }: { k?: boolean } = {}) => {
    const cur = get().working;
    const joins = k && loc.lastWasK && loc.undoStack.length > 0;
    loc.lastWasK = k;
    if (cur && !joins) {
      loc.undoStack = [...loc.undoStack, { working: cur, sources: loc.sources }].slice(-FACE_SESSION_DEFAULTS.undoDepth);
      loc.redoStack = [];
    }
    const named = nameCarve(next, { modality, sources: loc.sources, restCloud: loc.fresh?.cloud ?? undefined });
    loc.sources = named.sources;
    showDoc(named.categorizer, { dirty: true, notice: null, ...patch });
  };
  /** Apply an edit of the working categorizer (in either phase), or say why not. */
  const edit = (run: (working: PersonalCategorizer) => SortResult | CorrectionResult, options: { k?: boolean } = {}): boolean => {
    const { working, phase } = get();
    if (!working || (phase !== 'carved' && phase !== 'saved')) return false;
    const r = run(working);
    if (!r.ok) {
      set({ notice: `Not changed: ${r.error}.` });
      return false;
    }
    commit(r.categorizer, {}, options);
    return true;
  };
  /** Refused when the edit would make more categories than an instrument has chords for. */
  const roomFor = (working: PersonalCategorizer): SortResult | null =>
    working.categories.length >= FACE_SESSION_DEFAULTS.maxCategories
      ? { ok: false, error: `${FACE_SESSION_DEFAULTS.maxCategories} categories is the most (one per chord slot an instrument has); merge two first` }
      : null;
  /** Carve the fresh take `base` (`carveTake`: the rest cloud in Neutral) and show it. */
  const carveFresh = (base: PersonalCategorizer) => {
    if (!loc.fresh) return;
    const { result, allNearRest, movedToNeutral } = carveTake(
      base,
      { ...loc.fresh, baseRejectRadius: TRAIN_DEFAULTS.defaultRejectRadius, maxCategories: FACE_SESSION_DEFAULTS.maxCategories },
      { neutralLabel: modality.words.neutral },
    );
    if (!result.ok) {
      set({ notice: `Nothing to carve: ${result.error}.` });
      return;
    }
    const { one, many } = modality.words;
    const notice = allNearRest && movedToNeutral > 0
      ? `Every held ${one} was close to your resting ${one}. The category that was mostly your resting ${one} (${movedToNeutral} ${movedToNeutral === 1 ? 'hold' : 'holds'}) is in Neutral; check the rest, and move any other resting ones to Neutral too, or record again with stronger ${many}.`
      : allNearRest
      ? `Every held ${one} was close to your resting ${one}, so none was put in Neutral: all are carved. Move the resting ones to Neutral, or record again with stronger ${many}.`
      : null;
    const named = nameCarve(result.categorizer, { modality, sources: loc.sources, restCloud: loc.fresh.cloud ?? undefined });
    loc.sources = named.sources;
    showDoc(named.categorizer, { dirty: true, notice });
  };
  return { recutOptions, showDoc, showOpened, restoreEdits, commit, edit, roomFor, carveFresh };
}
