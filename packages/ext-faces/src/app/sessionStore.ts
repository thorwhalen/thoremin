/**
 * The face session's state (#330 P2, P3): record a take, carve it, show it, name it, save it, and
 * open or delete a saved one; then (P3) test it and correct it: a WORKING copy of the open
 * categorizer takes the player's corrections (a live face added to a category, a sample moved,
 * a new take merged in with P1's `mergeSession`) and the live tuning, until Save; and a
 * categorizer is imported from or exported to P1's versioned file. A zustand store the panel renders; the take, the
 * stills, the edit history and where the names came from live beside it (not in it: none of them
 * is something a component renders by value).
 *
 * #385 E4, one editable carve: from Stop on, a take IS a categorizer (`working`, every hold under
 * its id), so a fresh carve and an opened one are edited the same way: re-cut k (honouring the
 * player's pins, from the samples, so an opened one re-cuts too), move holds (a pin each), name
 * (a pin), merge, split, delete; every edit is one step of an undo history that restores the
 * exact previous document.
 *
 * #385 E3: a hold's still is taken the moment the take emits it, from the live frame, cropped to
 * the modality's region, and kept by its HOLD ID (`<takeId>:<n>`, the sample's id in the file);
 * Save files every hold's still under that id. So a merge, a correction or a re-cut never
 * re-files a still, and a still is deleted only when no saved record names its hold.
 *
 * Every outside dependency is injected ({@link FaceSessionDeps}: the input source, the stills'
 * store and grabber, the saved-models collection, the clock, the claim on the face features),
 * so a test drives the whole flow with the synthetic face and in-memory stores.
 *
 * The hot-path split the app follows: the poll pushes vectors into the take at frame rate, and
 * the store is told only what a person can see change (the phase, the count of held faces, a
 * coarse elapsed time).
 *
 * Every asynchronous step checks the store's `generation` when it resumes: `reset`, a new take
 * and opening a saved categorizer each bump it, so a late result for a take no longer shown is
 * dropped instead of landing on the new one.
 *
 * #385 E2: a take may begin in **Explore** (`explore()`: the features claimed and the camera
 * read, nothing collected) and be **paused** and resumed (`pause()` / `resume()`, or
 * `toggleCapture()`, which the host's `carve.capture.toggle` command reaches through the
 * capture seam the store provides while it is live). The live feature bars and the hold ring
 * are read, not pushed: the poll feeds the bars model, and the panel reads `live()` at its own
 * rate (the hot-path rule: a holder plus a poll, never a store write per frame). The store is
 * told only when the ring's state changes.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  MAX_CATEGORIZER_SAMPLES,
  categorizerFromModel,
  modelFromCategorizer,
  exportCategorizer,
  importCategorizer,
  type PersonalCategorizer,
  type SampleInput,
} from '@thoremin/sdk/enroll/categorizer';
import { neutralIndices } from '@thoremin/sdk/enroll/carve';
import { TRAIN_DEFAULTS } from '@thoremin/sdk/enroll/classify';
import { createLightWatch, createRestWatch } from './sessionWatches';
import { holdAllInCategory, labelledHoldsOf, leanPairs, withLabelsPlaced, type LabelledResult } from './holdGroups';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import type { MergeRunner } from '../lib/forest_prefetch';
import {
  deleteHolds as deleteHoldsFrom,
  mergeCategories,
  moveHolds as moveHoldsIn,
  nameCategory,
  NEW_CATEGORY,
  anchorNames,
  type LabelledHolds,
  consistentPins,
  mirrorOff,
  mirrorOffable,
  mirrorOn,
  recut,
  placeWith,
  recutBounds,
  recutRange,
  setNeutralTrained,
  setRadiusFrom as setRadiusFromOf,
  setStrangers as setStrangersOf,
  splitCategory,
  type RecutOptions,
  type SortResult,
} from '@thoremin/sdk/enroll/sorting';
import { carveTake, fullMean, generalContextOf, nameCarve, sortingView } from '../lib/carving';
import { addSample, moveSample, type CorrectionResult } from '../lib/corrections';
import { clampTuning, DEFAULT_TUNING, flooredRejectRadius, sameTuning } from '@thoremin/sdk/enroll/live';
import { createFaceTake, vocabularyCue, type FaceTake } from '../lib/take';
import { createReader, foreignModality, keepOnly, unknownVocabulary, type ModalityOptions } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { createLiveBars, liveStrip, type LiveBarsContext, type LiveBarsModel } from '@thoremin/sdk/enroll/bars';
import { NEUTRAL_TARGET } from '@thoremin/sdk/enroll/quality';
import type { CaptureState, CarveCaptureControl } from '@thoremin/sdk-ui/enroll/capture';
import type { FaceModelRecord } from './models';
import { holdId } from './thumbnails';
import { categoryEntries } from '../lib/vocabularyEntries';
import { FACE_SESSION_DEFAULTS, isLive, isRecording, type BarFocus, type FacePhase, type FaceSessionDeps, type FaceSessionState, type StripCardView } from './sessionStore/state';
import { restStats, withHand } from './sessionStore/ops';
import { createLocals, type MergeBase } from './sessionStore/locals';

export * from './sessionStore/state';

export function createFaceSessionStore(deps: FaceSessionDeps): StoreApi<FaceSessionState> {
  const modality = deps.modality ?? faceModality;
  /** Only the modality's keys: a saved sample keeps what its categorizer can use, not the hands
   *  and body that rode along in the live vector (it is stored in localStorage). */
  const modalityOnly = (v: FeatureVector): FeatureVector => keepOnly(modality, v);
  /** The store's working state outside the zustand state (never destructured: see `SessionLocals`). */
  const loc = createLocals();

  /** A take id none of `samples`' ids is under (ids are random in the app; a test's clock-made
   *  ones could repeat), so a new hold never takes an old hold's id, or its still. */
  const freshTakeId = (samples: readonly { id: string }[]): string => {
    const used = new Set(samples.flatMap((x) => (x.id.includes(':') ? [x.id.slice(0, x.id.lastIndexOf(':'))] : [])));
    let tid = deps.newTakeId();
    for (let n = 2; used.has(tid); n++) tid = `${deps.newTakeId()}-${n}`;
    return tid;
  };

  const store = createStore<FaceSessionState>()((set, get) => {
    const dropUrls = () => {
      for (const u of loc.urls.values()) URL.revokeObjectURL(u);
      loc.urls.clear();
    };
    const stopPolling = () => {
      if (loc.timer) clearInterval(loc.timer);
      loc.timer = null;
    };
    const release = () => {
      stopPolling();
      loc.frames?.close();
      loc.frames = null;
      if (loc.claimed) deps.claim(false);
      loc.claimed = false;
      loc.source?.dispose();
      loc.source = null;
      loc.bars = null;
      loc.withdraw?.();
      loc.withdraw = null;
    };

    /** `reset`, keeping the stills taken this session: a merge's take (or its cancel) returns to
     *  a working categorizer whose earlier merged holds have their pictures only in memory. */
    const resetKeepingStills = () => {
      const kept = [...loc.stills];
      get().reset();
      for (const [id, b] of kept) loc.stills.set(id, b);
    };

    /** The capture state the host's command sees (null when nothing is live). */
    const captureState = (): CaptureState | null => {
      const phase = get().phase;
      return phase === 'explore' ? 'explore' : phase === 'rest' ? 'rest' : phase === 'faces' ? 'capturing' : phase === 'paused' ? 'paused' : null;
    };
    const provideCapture = () => {
      if (loc.withdraw || !deps.capture) return;
      const control: CarveCaptureControl = {
        what: modality.words.many,
        state: () => captureState() ?? 'explore',
        toggle: () => get().toggleCapture(),
        beginBurst: () => {
          get().beginBurst();
          return get().burst !== null;
        },
        endBurst: () => {
          const held = get().burst !== null;
          get().endBurst();
          return held;
        },
      };
      loc.withdraw = deps.capture(control);
    };

    /** The bars' view of a take: its features, its noise unit, its rest once there is one, and
     *  its holds (the arrays cached, so the online carve runs once per new hold). */
    const barsFor = (t: FaceTake): LiveBarsModel => {
      const session = t.session();
      const ids = session.featuresFor(vocabularyCue(modality));
      let holds: { n: number; gone: number; vectors: FeatureVector[] } = { n: 0, gone: 0, vectors: [] };
      let rest: { mean: FeatureVector; spread: Record<string, number> } | null = null;
      const context = (): LiveBarsContext => {
        const points = session.points();
        if (points.length !== holds.n || loc.dropped.size !== holds.gone) {
          // The holds deleted from the strip are not carved (#404): the cards say what Stop will.
          loc.keptIdx = points.flatMap((_, i) => (loc.dropped.has(i) ? [] : [i]));
          holds = { n: points.length, gone: loc.dropped.size, vectors: loc.keptIdx.map((i) => points[i].vector) };
        }
        if (!rest && t.facesStartedAt() !== null) rest = restStats(t.restVectors(), ids);
        const noise = session.noise();
        return { ids, sigma: (id) => (noise.isWarm(id) ? noise.sigma(id) : Number.NaN), rest: rest?.mean ?? null, restSpread: rest?.spread ?? null, holds: holds.vectors };
      };
      return createLiveBars(context);
    };

    const rest = createRestWatch(
      { get, set },
      { progressStep: FACE_SESSION_DEFAULTS.restProgressStep, movingAt: FACE_SESSION_DEFAULTS.restMovingAt, movingForMs: FACE_SESSION_DEFAULTS.restMovingForMs, movingHoldMs: FACE_SESSION_DEFAULTS.restMovingHoldMs },
    );
    const light = createLightWatch({ get, set }, { everyMs: FACE_SESSION_DEFAULTS.lightMs, frames: () => loc.frames, region: deps.region });

    /** How the source is read: a merge reads with its base's hand, a fresh take with the chosen. */
    const readOptions = (): ModalityOptions =>
      loc.mergeBase ? { hand: loc.mergeBase.working.hand ?? 'either', mirror: loc.mergeBase.working.mirror === true } : { hand: get().hand, mirror: get().mirror };
    /** Read the source into the take every `pollMs`, telling the store only what a person can
     *  see change (the phase, the count of held faces, the ring, a coarse elapsed time). */
    const poll = (t0: number) => {
      stopPolling();
      let lastShown = -1;
      // The vector the carve works in (#385 E8): one hand made side-relative; the face as is. A
      // mirrored body take holds its side (#382), a merge chooses the side nearer its base.
      const readLive = createReader(modality, readOptions(), loc.mergeBase?.working.mirror ? modelFromCategorizer(loc.mergeBase.working) : undefined);
      loc.timer = setInterval(() => {
        if (!loc.take || !loc.source) return;
        const read = loc.source.read();
        const live = read ? { ...read, vector: readLive(read.vector) } : null;
        if (live) loc.lastMirrored = readLive.mirrored();
        if (live) {
          loc.take.push(live.vector, live.t);
          loc.bars?.push(modality.read(live.vector), live.t);
          loc.lastVector = live.vector;
          // A burst's still: once a few frames in, from the frame showing now.
          const b = loc.take.burst();
          if (b && !loc.burstStill && loc.frames && b.frames >= FACE_SESSION_DEFAULTS.burstStillAfter) loc.burstStill = grabStill(live.vector);
          stillNewHolds(live.vector);
        }
        let tp = loc.take.phase();
        // "Show me on the bars" (#435): the rest done, the take waits paused for the rehearsal.
        if (tp === 'faces' && loc.pauseOnCapture) {
          loc.pauseOnCapture = false;
          loc.take.pause(deps.now());
          tp = loc.take.phase();
        }
        const phaseNow: FacePhase = tp === 'explore' || tp === 'rest' || tp === 'faces' || tp === 'paused' ? tp : get().phase;
        const elapsed = phaseNow === 'explore' ? 0 : Math.floor((deps.now() - t0) / 250) / 4;
        const points = loc.take.pointCount();
        const hold = loc.take.hold();
        const step = loc.take.setupStep();
        if (step !== get().setupStep) set({ setupStep: step });
        rest.watch(loc.take.restProgress(), loc.take.restMotion(), live?.t ?? deps.now());
        const b = loc.take.burst();
        // The burst's frames coarsely (a person sees it grow, not every frame).
        const burst = b ? { label: b.label, frames: b.frames - (b.frames % FACE_SESSION_DEFAULTS.burstShowStep) } : null;
        const s = get();
        const burstChanged = (s.burst === null) !== (burst === null) || (burst !== null && (s.burst!.frames !== burst.frames || s.burst!.label !== burst.label));
        if (s.phase !== phaseNow || s.points !== points || elapsed !== lastShown || s.hold !== hold || burstChanged) {
          lastShown = elapsed;
          set({ phase: phaseNow, points, elapsed, hold, ...(burstChanged ? { burst } : {}) });
        }
        refreshStrip();
        refreshGhost(live?.vector ?? null, live?.t ?? deps.now());
        light.watch(live?.vector ?? loc.lastVector, deps.now());
      }, deps.pollMs);
    };
    /** A new take's strip: nothing deleted, named or shown yet. */
    const clearStrip = () => {
      loc.dropped.clear();
      loc.holdNames.clear();
      loc.holdSides.clear();
      loc.lastMirrored = null;
      loc.keptIdx = [];
      loc.stripKey = '';
      loc.stripFigures.clear();
      loc.ghostAt = Number.NEGATIVE_INFINITY;
      set({ strip: [], stripOnce: [], ghost: null });
    };
    /** A hold's picture for the strip: its still once encoded, else its stick figure. */
    const stripThumb = (index: number, id: string): string | null => {
      let url = loc.urls.get(id);
      const still = url ? undefined : loc.stills.get(id);
      if (still) loc.urls.set(id, (url = URL.createObjectURL(still)));
      if (url) return url;
      if (!deps.figure || !modality.skeleton || !loc.take) return null;
      if (!loc.stripFigures.has(id)) {
        const point = loc.take.session().points()[index];
        const skeleton = point ? modality.skeleton(point.vector) : null;
        const fig = skeleton ? deps.figure(skeleton) : null;
        if (!fig) return null;
        loc.stripFigures.set(id, fig);
      }
      return loc.stripFigures.get(id) ?? null;
    };
    /** The live strip (#404) from the bars' online carve, set only when what it shows changed. */
    const refreshStrip = () => {
      const phase = get().phase;
      if (!loc.take || !loc.bars || !loc.takeId || (phase !== 'faces' && phase !== 'paused')) {
        if (loc.stripKey !== '') {
          loc.stripKey = '';
          set({ strip: [], stripOnce: [] });
        }
        return;
      }
      const tid = loc.takeId;
      const labels = loc.take.labels();
      const nameOf = (i: number): string => (loc.holdNames.get(i) ?? labels.get(i) ?? '').trim();
      // A named hold goes where Stop puts it: with the holds of its name (pinned there), whatever
      // the carve says; the carve's groups keep the unnamed ones.
      const byName = new Map<string, number[]>();
      const clusters = loc.bars
        .carve()
        .map((c) =>
          c.flatMap((p) => {
            const i = loc.keptIdx[p];
            if (i === undefined) return [];
            const name = nameOf(i).toLowerCase();
            if (!name) return [i];
            byName.set(name, [...(byName.get(name) ?? []), i]);
            return [];
          }),
        )
        .concat([...byName.values()]);
      const { cards, once } = liveStrip(clusters);
      const strip: StripCardView[] = cards.map((c) => ({ n: c.index + 1, like: c.like === null ? null : c.like + 1, name: nameOf(c.index) || null, thumb: stripThumb(c.index, holdId(tid, c.index)) }));
      const stripOnce = once.map((i) => i + 1);
      // The change key without the pictures' text (a stick figure is a data URL of kilobytes).
      const key = `${strip.map((c) => `${c.n}:${c.like ?? ''}:${c.name ?? ''}:${c.thumb ? c.thumb.length : 0}`).join('|')}/${stripOnce.join(',')}`;
      if (key === loc.stripKey) return;
      loc.stripKey = key;
      set({ strip, stripOnce });
    };
    /** While paused and a hold is forming, what it would be (#404), carved at most every
     *  `ghostMs`; null otherwise. */
    const refreshGhost = (vector: FeatureVector | null, tMs: number) => {
      const s = get();
      const forming =
        s.phase === 'paused' && (s.hold === 'settling' || s.hold === 'taken') && vector !== null && loc.bars !== null && loc.keptIdx.length > 0 && loc.keptIdx.length <= FACE_SESSION_DEFAULTS.ghostUpTo;
      if (!forming) {
        if (s.ghost !== null) set({ ghost: null });
        loc.ghostAt = Number.NEGATIVE_INFINITY;
        return;
      }
      if (tMs - loc.ghostAt < FACE_SESSION_DEFAULTS.ghostMs && s.ghost !== null) return;
      loc.ghostAt = tMs;
      const joins = loc.bars!.wouldBe(vector!);
      // Said in the strip's terms: the card it would join, by that card's group leader (one more
      // point can split a group, and the ghost must not contradict the cards).
      const first = joins ? Math.min(...joins.map((p) => loc.keptIdx[p])) + 1 : null;
      const card = first === null ? undefined : s.strip.find((c) => c.n === first);
      const like = first === null ? null : (card?.like ?? first);
      if (s.ghost?.like !== like || s.ghost === null) set({ ghost: { like } });
    };
    const show = (gen: number) => {
      if (gen !== loc.generation) return;
      const thumbs: Record<number, string> = {};
      loc.shownIds.forEach((id, i) => {
        let url = loc.urls.get(id);
        const still = url ? undefined : loc.stills.get(id);
        if (still) loc.urls.set(id, (url = URL.createObjectURL(still)));
        url ??= loc.figureUrls.get(id);
        if (url) thumbs[i] = url;
      });
      set({ thumbs });
    };

    /** The current frame as a still, cropped to the modality's region and overlaid with its lines,
     *  both from `vector` (projected). */
    const grabStill = (vector: FeatureVector): Promise<Blob | null> =>
      loc.frames
        ? loc.frames
            .grab(deps.region ? (size) => deps.region!({ vector, ...size }) : null, deps.overlay ? (size) => deps.overlay!({ vector, ...size }) : null)
            .catch(() => null)
        : Promise.resolve(null);
    /** Take a still for each hold the take emitted since the last poll, from the frame showing
     *  now (the hold was just taken, so the face is still held), cropped to the region the live
     *  vector places the part in. */
    const stillNewHolds = (vector: FeatureVector) => {
      if (!loc.take || !loc.takeId) return;
      const n = loc.take.pointCount();
      const tid = loc.takeId;
      for (; loc.stilled < n; loc.stilled++) {
        const id = holdId(tid, loc.stilled);
        // The side it was read on (#529), from the frame showing as it was taken.
        if (loc.lastMirrored !== null) loc.holdSides.set(loc.stilled, loc.lastMirrored);
        if (!loc.frames) continue;
        const gen = loc.generation;
        // A burst's hold has its still already (taken mid-burst); any other is taken now.
        const grabbed = loc.burstStill ?? grabStill(vector);
        loc.burstStill = null;
        const job = grabbed
          .then((still) => {
            // Kept even if the take is no longer shown: the id is this hold's alone, and a merge
            // that ended a moment ago may be saved with it.
            if (!still || loc.stills.has(id)) return;
            loc.stills.set(id, still);
            show(gen);
            if (gen === loc.generation) refreshStrip();
          })
          .finally(() => loc.pending.delete(job));
        loc.pending.add(job);
      }
    };
    /** A burst just ended (released, or ended by a pause, a resume or Stop): its hold's still
     *  filed under its id, or dropped when it took no hold. */
    const afterBurst = () => {
      if (!loc.take || loc.take.burst()) return;
      if (loc.lastVector) stillNewHolds(loc.lastVector);
      loc.burstStill = null;
    };
    /** Every still being encoded, done. */
    const stillsTaken = () => Promise.all([...loc.pending]);
    /** Stills for `ids` filed in IndexedDB (those not in hand). Returns whether any was found. */
    const loadThumbs = async (ids: readonly string[]): Promise<boolean> => {
      const gen = loc.generation;
      let found = false;
      for (const id of new Set(ids)) {
        if (loc.urls.has(id)) {
          found = true;
          continue;
        }
        if (loc.stills.has(id)) {
          found = true;
          continue;
        }
        const b = await deps.thumbs.get(id).catch(() => null);
        if (gen !== loc.generation) return found;
        if (b && !loc.urls.has(id)) loc.urls.set(id, URL.createObjectURL(b));
        found ||= b !== null;
      }
      show(gen);
      return found;
    };
    /** The take's holds, as the samples a categorizer is made of: their ids, the modality's
     *  keys only, and their supporting frames. */
    const takeSamples = (t: FaceTake, tid: string): SampleInput[] =>
      t
        .session()
        .points()
        .map((p, i) => ({ ...p, id: holdId(tid, i), vector: modalityOnly(p.vector), support: t.support(i), skeleton: modality.skeleton?.(p.vector) ?? null, mirrored: loc.holdSides.get(i) }));

    /** The take's labelled holds (#385 E7: bursts under a typed name), by name, as sample ids. */
    /** The take's holds by name: a burst's, or one given in the strip. */
    const holdNamesOf = (t: FaceTake): Map<number, string> => {
      // A name given in the strip (#404) is a burst's name given afterwards: it wins over one.
      const names = new Map(t.labels());
      for (const [i, name] of loc.holdNames) names.set(i, name);
      return names;
    };
    const labelledHolds = (t: FaceTake, tid: string): LabelledHolds[] => labelledHoldsOf(holdNamesOf(t), loc.dropped, tid);
    /** `r` with each lean's holds (#349) put and pinned where the hold they leaned on is. */
    const withLeans = <R extends { categorizer: PersonalCategorizer }>(r: R, t: FaceTake, tid: string): R => {
      const placed = placeWith(r.categorizer, leanPairs(t.leans(), loc.dropped, tid));
      return placed.ok ? { ...r, categorizer: placed.categorizer } : r;
    };
    /** `labelled` with every hold of the take that has no name of its own (and was not deleted in
     *  the strip) moved to category `id` and pinned there (#435). */
    const holdAllIn = (labelled: LabelledResult, t: FaceTake, tid: string, id: string): LabelledResult =>
      holdAllInCategory(labelled, { names: holdNamesOf(t), dropped: loc.dropped, count: t.pointCount(), takeId: tid, to: id });
    /** `c` with the take's labelled holds placed and pinned (unchanged when there are none). */
    const withLabels = (c: PersonalCategorizer, groups: readonly LabelledHolds[]): LabelledResult =>
      withLabelsPlaced(c, groups, { neutralLabel: modality.words.neutral, maxCategories: FACE_SESSION_DEFAULTS.maxCategories });

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

    /** Delete the stills of `ids` that no saved record's samples name any more. */
    const dropStillsIfOrphaned = async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const records = await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id).catch(() => null)));
      // A record that cannot be read may name these holds: then nothing is deleted.
      if (records.some((r) => r === null)) return;
      const named = new Set(records.flatMap((r) => r!.model.categorizer.samples.map((x) => x.id)));
      const orphans = ids.filter((id) => !named.has(id));
      if (orphans.length > 0) await deps.thumbs.remove(orphans).catch(() => undefined);
    };

    return {
      modality,
      phase: 'idle',
      strangers: 'neutral',
      hand: 'either',
      mirror: false,
      vocabulary: null,
      keepStills: deps.stillsByDefault ?? true,
      figures: deps.figure !== undefined && modality.skeleton !== undefined,
      setupStep: 0,
      restProgress: null,
      restMoving: false,
      tooDark: false,
      k: 0,
      view: null,
      thumbs: {},
      points: 0,
      strip: [],
      stripOnce: [],
      ghost: null,
      hold: 'open',
      elapsed: 0,
      hasStills: false,
      notice: null,
      saved: [],
      openId: null,
      name: '',
      saving: false,
      working: null,
      history: { undo: 0, redo: 0 },
      tuning: DEFAULT_TUNING,
      dirty: false,
      merging: null,
      focus: null,
      holdsAs: null,
      burstName: '',
      burst: null,
      checks: {},

      explore() {
        if (isLive(get().phase)) return;
        get().reset();
        loc.source = deps.source();
        loc.take = createFaceTake({ modality });
        loc.bars = barsFor(loc.take);
        deps.claim(true);
        loc.claimed = true;
        loc.take.explore(deps.now());
        set({ phase: 'explore', points: 0, elapsed: 0, hold: 'open', notice: null, view: null, thumbs: {}, openId: null, name: '', merging: null, focus: null, holdsAs: null });
        provideCapture();
        poll(deps.now());
      },

      dropHold(n) {
        const phase = get().phase;
        const i = n - 1;
        if (!loc.take || (phase !== 'faces' && phase !== 'paused') || !Number.isInteger(i) || i < 0 || i >= loc.take.pointCount() || loc.dropped.has(i)) return;
        loc.dropped.add(i);
        refreshStrip();
      },

      nameHold(n, name) {
        const phase = get().phase;
        const i = n - 1;
        if (!loc.take || (phase !== 'faces' && phase !== 'paused') || !Number.isInteger(i) || i < 0 || i >= loc.take.pointCount() || loc.dropped.has(i)) return;
        loc.holdNames.set(i, name.trim());
        refreshStrip();
      },

      start() {
        const exploring = get().phase === 'explore' && loc.take !== null && loc.source !== null;
        if (isRecording(get().phase)) return;
        const merge = loc.mergeBase;
        if (!exploring) {
          if (merge) resetKeepingStills();
          else get().reset();
          loc.mergeBase = merge;
          loc.source = deps.source();
          // A merge keeps its base's features and weights, so it has no use for the nuisances.
          loc.take = createFaceTake({ modality, nuisance: !merge });
          loc.bars = barsFor(loc.take);
          deps.claim(true);
          loc.claimed = true;
        }
        else {
          // A fresh source for the capture: the live one is stateless (the tap and the camera
          // stay), and the scripted one starts its script, rest first, when the capture does.
          loc.source!.dispose();
          loc.source = deps.source();
        }
        loc.takeId = freshTakeId(merge?.working.samples ?? []);
        loc.stilled = 0;
        clearStrip();
        const stream = get().keepStills ? loc.source!.video() : null;
        loc.frames = stream ? deps.frames(stream) : null;
        light.reset();
        const t0 = deps.now();
        loc.take!.start(t0);
        rest.reset();
        set({ phase: 'rest', setupStep: 0, restProgress: 0, restMoving: false, tooDark: false, points: 0, elapsed: 0, hold: 'open', hasStills: loc.frames !== null, notice: null, view: null, thumbs: {}, openId: null, name: merge?.name ?? '', merging: merge?.seed ?? null });
        provideCapture();
        poll(t0);
      },

      pause() {
        if (get().phase !== 'faces' || !loc.take) return;
        loc.take.pause(deps.now());
        afterBurst();
        set({ phase: 'paused', hold: loc.take.hold(), burst: null, points: loc.take.pointCount() });
      },

      resume() {
        if (get().phase !== 'paused' || !loc.take) return;
        loc.take.resume(deps.now());
        afterBurst();
        set({ phase: 'faces', hold: loc.take.hold(), burst: null, points: loc.take.pointCount() });
      },

      toggleCapture() {
        const phase = get().phase;
        if (phase === 'explore') get().start();
        else if (phase === 'faces') get().pause();
        else if (phase === 'paused') get().resume();
      },

      setBurstName(name) {
        set({ burstName: name });
      },

      beginBurst(lean = false) {
        const phase = get().phase;
        if (!loc.take || (phase !== 'faces' && phase !== 'paused')) return;
        if (loc.take.beginBurst(deps.now(), lean ? '' : get().burstName, { lean })) set({ burst: { label: get().burstName.trim(), frames: 0 }, hold: loc.take.hold(), notice: null });
      },

      endBurst() {
        if (!loc.take || !loc.take.burst()) return;
        const took = loc.take.endBurst(deps.now());
        afterBurst();
        set({
          burst: null,
          hold: loc.take.hold(),
          points: loc.take.pointCount(),
          ...(took ? {} : { notice: `That burst was too short to take: hold the key for a moment while you make the ${modality.words.one}.` }),
        });
      },

      live(options = {}) {
        if (!loc.bars || !isLive(get().phase) || get().phase === 'stopping') return null;
        const focus = get().focus;
        if (!focus) return loc.bars.snapshot(options);
        // The hint's features first, then the player's own pins; the two centres marked.
        const pinned = [...focus.features, ...(options.pinned ?? []).filter((id) => !focus.features.includes(id))];
        return loc.bars.snapshot({ ...options, pinned, marks: focus.marks });
      },

      async stop() {
        const phase = get().phase;
        if (phase !== 'rest' && phase !== 'faces' && phase !== 'paused') return;
        // Synchronously out of the recording phases: a second Stop, or the panel's cleanup, now
        // sees a take being stopped, not one to stop again.
        set({ phase: 'stopping', restProgress: null, restMoving: false });
        const myTake = loc.take!;
        const hadStills = loc.frames !== null;
        let built = false;
        try {
          // A burst held through Stop is a hold like a released one, with its still.
          if (myTake.burst()) {
            myTake.endBurst(deps.now());
            afterBurst();
          }
          stopPolling();
          built = myTake.stop();
        } finally {
          release();
        }
        const merge = loc.mergeBase;
        loc.mergeBase = null;
        if (merge) {
          loc.openRecord = merge.record;
          // The name a "Record more X" gave the bursts belongs to that take only.
          const restore = { openId: merge.openId, name: merge.name, tuning: merge.tuning, checks: merge.checks, merging: null, focus: null, holdsAs: null, burst: null, burstName: '' };
          // Back to the categorizer the take was adding to, its edit history and all.
          restoreEdits(merge.edits);
          // A fresh carve has pictures when either take took them (an open one finds its own).
          showDoc(merge.working, { phase: merge.phase, ...restore, ...(merge.phase === 'carved' ? { hasStills: merge.hasStills || hadStills } : {}), dirty: merge.dirty });
          // A merge needs no carve of its own, so one hold (a single burst: "Record more frown")
          // is enough; a fresh take needs two to carve.
          if (!built && myTake.pointCount() === 0) {
            set({ notice: `No ${modality.words.one} was held long enough to add. Nothing was merged.` });
            return;
          }
          // The holds deleted from the strip (#404) are not merged.
          const added = takeSamples(myTake, loc.takeId!).filter((_, i) => !loc.dropped.has(i));
          if (added.length === 0) {
            set({ notice: `Every held ${modality.words.one} was deleted. Nothing was merged.` });
            return;
          }
          // New faces are sorted with the FLOORED radius the readout uses (a file's tiny stored
          // radius would set every new face aside); not with the dial's scale, which stays a live
          // setting rather than being written into the samples' radius.
          const base = merge.working.strangers === 'neutral' ? { ...merge.working, rejectRadius: flooredRejectRadius(merge.working) } : merge.working;
          let result: Awaited<ReturnType<MergeRunner>>;
          try {
            result = await (deps.merge ?? (async (b, a, o) => mergeSession(b, a, o)))(base, added, { seed: merge.seed });
          } catch (err) {
            // A working copy the merge cannot read (it validates): the base kept, said plainly.
            set({ notice: `Nothing was merged: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
            return;
          }
          // The import bound (addSample keeps it too): a categorizer merged past it could not
          // be read back from its own exported file. Refused as a notice, the base kept.
          if (result.categorizer.samples.length > MAX_CATEGORIZER_SAMPLES) {
            set({ notice: `Nothing was merged: the result would hold ${result.categorizer.samples.length} ${modality.words.many}, more than the ${MAX_CATEGORIZER_SAMPLES} a categorizer keeps.` });
            return;
          }
          // Bursts recorded under a name go to the category of that name (or a new one), pinned
          // (#385 E7): "Record more frown" lands in frown, whatever is nearest.
          const named = withLeans(withLabels(result.categorizer, labelledHolds(myTake, loc.takeId!)), myTake, loc.takeId!);
          // "Record more" (#435): every hold not named otherwise goes to its category, by id.
          const labelled = merge.holdsIn ? holdAllIn(named, myTake, loc.takeId!, merge.holdsIn) : named;
          for (const id of labelled.named) if (!loc.sources.has(id)) loc.sources = new Map([...loc.sources, [id, { source: 'edited', matched: null }]]);
          // Every sample keeps its id (the base's, and the new holds' `<takeId>:<n>`), so every
          // still stays filed where it is: the new ones are filed on Save, nothing is re-filed.
          const joined = result.assigned.filter((a) => a >= 0).length;
          const untouched = result.untouched.map((id) => result.categorizer.categories.find((c) => c.id === id)?.label || id);
          // One undoable edit: undo returns to the categorizer before the merge.
          commit(labelled.categorizer, {
            notice:
              (labelled.error ? `The named ${modality.words.many} were sorted like the others (${labelled.error}). ` : '') +
              `Merged: ${joined} of ${added.length} new ${modality.words.many} joined a category` +
              (added.length > joined ? ` (${added.length - joined} read as none of these)` : '') +
              (untouched.length > 0 ? `; no new ${modality.words.one} for ${untouched.map((l) => `"${l}"`).join(', ')}` : '') +
              '. Save to keep it.',
          });
          return;
        }
        if (!built) {
          const { one } = modality.words;
          set({
            phase: 'empty',
            notice:
              phase === 'rest'
                ? `The take stopped during the rest, before any ${one} was held. Record again and keep going after the rest.`
                : `No ${one} was held long enough to carve. Hold each ${one} for a moment.`,
          });
          return;
        }
        // The take becomes the working categorizer at once (#385 E4): every hold with its id, all
        // in one category, then carved at the suggested k, the rest cloud in Neutral.
        const session = myTake.session();
        const samples = takeSamples(myTake, loc.takeId!);
        const rest = myTake.restVectors();
        const cloud = neutralIndices(session.points().map((p) => p.vector), rest, session.features(), session.weights());
        const strangers = get().strangers;
        const unlabelled = categorizerFromModel(session.modelFor([samples.map((_, i) => i)]), samples, { name: '', strangers, modality: modality.id, hand: get().hand, mirror: get().mirror, vocabulary: get().vocabulary ?? undefined, createdAt: deps.isoNow() });
        // One take's choice: the categorizer keeps it, the next take starts from coverage again.
        loc.chosenVocabulary = null;
        // Bursts recorded under a name are pinned to a category of that name before the carve, so
        // the re-cut keeps them together (must-link) at every k (#385 E7).
        const labelled = withLeans(withLabels(unlabelled, labelledHolds(myTake, loc.takeId!)), myTake, loc.takeId!);
        // The holds deleted from the strip (#404) go before the carve, so it never sees them.
        const gone = samples.flatMap((x, i) => (loc.dropped.has(i) ? [x.id] : []));
        const kept = gone.length > 0 ? deleteHoldsFrom(labelled.categorizer, gone) : { ok: true as const, categorizer: labelled.categorizer };
        if (!kept.ok) {
          set({ phase: 'empty', burst: null, notice: `Every held ${modality.words.one} was deleted, so there is nothing to carve. Record again.` });
          return;
        }
        loc.fresh = { rest, cloud: cloud ? new Set(cloud.flatMap((i) => (loc.dropped.has(i) ? [] : [samples[i].id]))) : null };
        // The typed names are the player's: kept as theirs (the general model never renames them).
        for (const id of labelled.named) loc.sources = new Map([...loc.sources, [id, { source: 'edited', matched: null }]]);
        set({ phase: 'carved', hasStills: hadStills, name: '', dirty: true, burst: null });
        carveFresh(kept.categorizer);
        if (labelled.error) set({ notice: `The named holds were carved like the others: ${labelled.error}.` });
      },

      setStrangers(strangers) {
        const { phase, working } = get();
        if (!working || (phase !== 'carved' && phase !== 'saved')) {
          if (phase === 'idle' || phase === 'empty') set({ strangers });
          return;
        }
        if (strangers === working.strangers) return;
        // Neutral is taught by example in both settings: the switch moves no hold, re-cuts nothing.
        edit((w) => setStrangersOf(w, strangers, recutOptions()));
      },

      setHand(hand) {
        const { phase, working } = get();
        if (!working || (phase !== 'carved' && phase !== 'saved')) {
          if (phase === 'idle' || phase === 'empty') set({ hand });
          return;
        }
        if (hand === (working.hand ?? 'either')) return;
        edit((w) => ({ ok: true, categorizer: withHand(w, hand) }));
      },

      setMirror(on) {
        const { phase, working } = get();
        if (working && (phase === 'carved' || phase === 'saved')) {
          // After the take (#459): ON is one undoable edit (every hold on one side, re-cut at the
          // suggested k); OFF too (#529), where every hold kept the side it was read on.
          if (on === (working.mirror === true) || !modality.mirrorImage || !modality.mirrorSide) return;
          if (!on && !mirrorOffable(working)) {
            set({ notice: `Not changed: some ${modality.words.many} did not keep the side they were read on (recorded before this was kept, or added from Trying), so left and right cannot be told apart again.` });
            return;
          }
          if (!get().view?.recutable) {
            set({ notice: `Not changed: ${working.samples.length} ${modality.words.many} are too many to sort again here; merge categories or delete some first.` });
            return;
          }
          const image = modality.mirrorImage;
          const side = modality.mirrorSide;
          // A name carries when it is the player's, and never a default name of the side it leaves
          // ("right arm up", the general model's without the mirror and not with it; or the
          // reverse when the mirror goes off), which a reopened categorizer cannot tell from a
          // typed one: the new side's words name that category afresh.
          const labelsOf = (c: PersonalCategorizer) => new Set((modality.general?.(generalContextOf(c))?.labels ?? []).map((l) => l.toLowerCase()));
          const { mirror: _mirror, ...unmirrored } = working;
          void _mirror;
          const mirroredLabels = labelsOf({ ...working, mirror: true });
          const plainLabels = labelsOf(unmirrored);
          const [leaving, arriving] = on ? [plainLabels, mirroredLabels] : [mirroredLabels, plainLabels];
          const stale = [...leaving].filter((l) => !arriving.has(l));
          const carry = (cat: PersonalCategorizer['categories'][number]) =>
            ['kept', 'edited'].includes(loc.sources.get(cat.id)?.source ?? 'kept') && cat.label.trim() !== '' && !stale.includes(cat.label.trim().toLowerCase());
          const tools = { image, side, skeleton: modality.skeleton ? (v: FeatureVector) => modality.skeleton!(v) : undefined };
          const turn = on ? mirrorOn : mirrorOff;
          edit((w) => turn(w, tools, { ...recutOptions(), carry, maxCategories: FACE_SESSION_DEFAULTS.maxCategories }));
          return;
        }
        if (phase !== 'idle' && phase !== 'empty') return;
        loc.chosenMirror = on;
        set({ mirror: on });
      },

      setVocabulary(vocabulary) {
        // Read when a take becomes a categorizer, so any time before that is in time.
        if (get().working) return;
        loc.chosenVocabulary = vocabulary;
        set({ vocabulary });
      },

      setKeepStills(on) {
        if (!isLive(get().phase)) set({ keepStills: on });
      },

      skipSetup() {
        if (get().phase !== 'rest' || !loc.take) return;
        loc.take.skipSetup(deps.now());
        set({ setupStep: loc.take.setupStep() });
      },

      teachNeutral() { return edit((w) => setNeutralTrained(w, true)); },
      setRadiusFrom(from) { return edit((w) => setRadiusFromOf(w, from)); },

      setK(k) {
        const { working, view } = get();
        const want = Math.min(Math.round(k), FACE_SESSION_DEFAULTS.maxCategories);
        if (!working || !view || want === view.k) return;
        if (!view.recutable) {
          set({ notice: `Not changed: ${working.samples.length} ${modality.words.many} are too many to re-cut here; merge categories or delete some instead.` });
          return;
        }
        // A name saved before pins existed (or kept from the file) is the player's: anchored
        // first, so the re-cut keeps it (the general model's proposals are not).
        const kept = (cat: PersonalCategorizer['categories'][number]) => ['kept', 'edited'].includes(loc.sources.get(cat.id)?.source ?? 'kept') && cat.label.trim() !== '';
        const cut = () => edit((w) => recut(anchorNames(w, kept), want, recutOptions()), { k: true });
        // A pool past the suggestion's size has its forest built in the worker after each edit
        // (#499): wait for that build rather than race it onto the page, and let a later move of
        // the slider win over an earlier one still waiting.
        const wait = deps.forests && working.samples.length > FACE_SESSION_DEFAULTS.suggestUpTo ? deps.forests.whenReady(anchorNames(working, kept), recutOptions()) : null;
        if (!wait) {
          cut();
          return;
        }
        const mine = ++loc.cutToken;
        void wait.then(() => {
          if (mine === loc.cutToken && get().working === working) cut();
        });
      },

      rename(id, label) {
        const name = label.trim();
        const working = get().working;
        if (!working || !name) return;
        const same = (x: string) => x.trim().toLowerCase() === name.toLowerCase();
        const clash = working.categories.find((c) => c.id !== id && same(c.label));
        const yields = clash && !['edited', 'kept'].includes(loc.sources.get(clash.id)?.source ?? 'kept');
        if (clash && !yields) {
          set({ notice: `Another category is already called "${clash.label}".` });
          return;
        }
        // A default name the player takes yields (it is proposed again elsewhere); the player's
        // own names, and an opened categorizer's, do not.
        const cleared = yields ? { ...working, categories: working.categories.map((c) => (c.id === clash.id ? { ...c, label: '' } : c)) } : working;
        if (edit(() => nameCategory(cleared, id, name))) {
          loc.sources = new Map(loc.sources).set(id, { source: 'edited', matched: null });
          showDoc(get().working!);
        }
      },

      moveHolds(ids, to) {
        return edit((w) => (to === NEW_CATEGORY && roomFor(w)) || moveHoldsIn(w, ids, to));
      },

      deleteHolds(ids) {
        return edit((w) => deleteHoldsFrom(w, ids));
      },

      merge(from, into) {
        return edit((w) => mergeCategories(w, from, into));
      },

      split(id) {
        return edit((w) => roomFor(w) ?? splitCategory(w, id));
      },

      undo() {
        const cur = get().working;
        const prev = loc.undoStack.at(-1);
        if (!cur || !prev) return;
        loc.undoStack = loc.undoStack.slice(0, -1);
        loc.redoStack = [...loc.redoStack, { working: cur, sources: loc.sources }];
        loc.lastWasK = false;
        loc.sources = prev.sources;
        showDoc(prev.working, { dirty: true, notice: null });
      },

      redo() {
        const cur = get().working;
        const next = loc.redoStack.at(-1);
        if (!cur || !next) return;
        loc.redoStack = loc.redoStack.slice(0, -1);
        loc.undoStack = [...loc.undoStack, { working: cur, sources: loc.sources }];
        loc.lastWasK = false;
        loc.sources = next.sources;
        showDoc(next.working, { dirty: true, notice: null });
      },

      async save(name) {
        const { view, phase, saving } = get();
        const trimmed = name.trim();
        if (!view || !trimmed || saving || view.k === 0) return false;
        if (phase !== 'carved' && phase !== 'saved') return false;
        const gen = loc.generation;
        set({ saving: true });
        /** The stills this save filed (removed again if the record is not saved). */
        const filed: string[] = [];
        try {
          let categorizer: PersonalCategorizer;
          const working = get().working;
          const tuningAtStart = get().tuning;
          const checksAtStart = get().checks;
          if (working) categorizer = { ...working, name: trimmed };
          else return false;
          // Every hold's still taken this session, filed under its id once it is encoded (a Save
          // right after Stop must not file a categorizer whose pictures were still being taken).
          // Stills already filed (a saved base's) stay where they are.
          await stillsTaken();
          if (gen !== loc.generation) return false;
          for (const x of categorizer.samples) {
            const still = loc.stills.get(x.id);
            if (still && (await deps.thumbs.put(x.id, still).then(() => true, () => false))) filed.push(x.id);
          }
          // Saving under a name that already exists replaces that record: its stills go too,
          // unless another record (or this one) still names their holds.
          const before = new Map(
            (await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id))))
              .filter((r): r is FaceModelRecord => r !== null)
              .map((r) => [r.id, r.model.categorizer.samples.map((x) => x.id)]),
          );
          const tuning = get().tuning;
          const checks = get().checks;
          const hasChecks = checks.quiz !== undefined || checks.everyday !== undefined;
          const record = await deps.models.save(trimmed, { categorizer, ...(phase === 'saved' ? { tuning, ...(hasChecks ? { checks } : {}) } : {}) });
          const replaced = before.get(record.id);
          if (replaced) await dropStillsIfOrphaned(replaced);
          if (gen === loc.generation) {
            // An edit made while the save was in flight (a correction, a tuning, a re-cut) is kept,
            // and still unsaved: what was saved is the state when Save was pressed.
            const changed = get().view !== view || get().tuning !== tuningAtStart || get().checks !== checksAtStart;
            set({ notice: `Saved "${record.name}".${changed ? ' Changes made since are not saved yet.' : ''}`, name: record.name, dirty: changed, ...(phase === 'saved' ? { openId: record.id, working: changed && get().working ? { ...get().working!, name: record.name } : record.model.categorizer } : {}) });
            if (phase === 'saved') loc.openRecord = record;
          }
          await get().refreshSaved();
          return true;
        } catch (err) {
          // The record was not saved: the stills filed for it go again, unless a record names them.
          await dropStillsIfOrphaned(filed).catch(() => undefined);
          set({ notice: `Could not save: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
          return false;
        } finally {
          set({ saving: false });
        }
      },

      async refreshSaved() {
        const saved = await deps.models.list().catch(() => []);
        set({ saved });
      },

      async open(id) {
        const record = await deps.models.load(id);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return;
        }
        get().reset();
        loc.openRecord = record;
        showOpened(record.model.categorizer, { openId: id, name: record.name, hasStills: true, tuning: clampTuning(record.model.tuning ?? {}), checks: record.model.checks ?? {}, dirty: false });
      },

      async remove(id) {
        const record = await deps.models.load(id);
        await deps.models.remove(id);
        await dropStillsIfOrphaned(record?.model.categorizer.samples.map((x) => x.id) ?? []);
        if (get().openId === id) get().reset();
        await get().refreshSaved();
      },

      reset() {
        loc.generation++;
        loc.pauseOnCapture = false;
        release();
        loc.take = null;
        loc.takeId = null;
        loc.stilled = 0;
        loc.burstStill = null;
        loc.lastVector = null;
        loc.fresh = null;
        loc.baseRadius = undefined;
        loc.sources = new Map();
        loc.undoStack = [];
        loc.redoStack = [];
        loc.lastWasK = false;
        loc.openRecord = null;
        loc.mergeBase = null;
        loc.shownIds = [];
        loc.figureUrls.clear();
        loc.stills.clear();
        loc.pending.clear();
        dropUrls();
        clearStrip();
        set({ phase: 'idle', restProgress: null, restMoving: false, tooDark: false, mirror: loc.chosenMirror, vocabulary: loc.chosenVocabulary, view: null, thumbs: {}, points: 0, hold: 'open', elapsed: 0, hasStills: false, openId: null, k: 0, notice: null, working: null, history: { undo: 0, redo: 0 }, tuning: DEFAULT_TUNING, checks: {}, dirty: false, merging: null, focus: null, holdsAs: null, burst: null, burstName: '' });
      },

      cancelRecording() {
        const merge = loc.mergeBase;
        if (!isRecording(get().phase) || !merge) {
          if (isLive(get().phase)) get().reset();
          return;
        }
        // A merge take abandoned: back to the categorizer it was adding to, unsaved work and all.
        resetKeepingStills();
        loc.openRecord = merge.record;
        restoreEdits(merge.edits);
        showDoc(merge.working, {
          phase: merge.phase,
          ...(merge.phase === 'carved' ? { hasStills: merge.hasStills } : {}),
          openId: merge.openId,
          name: merge.name,
          tuning: merge.tuning,
          checks: merge.checks,
          burstName: '',
          dirty: merge.dirty,
          notice: 'The take was stopped before it finished. Nothing was merged.',
        });
      },

      setTuning(tuning) {
        if (get().phase !== 'saved') return;
        const next = clampTuning({ ...get().tuning, ...tuning });
        const cur = get().tuning;
        if (sameTuning(next, cur)) return;
        set({ tuning: next, dirty: true });
      },

      setChecks(checks) {
        if (get().phase !== 'saved') return;
        set({ checks: { ...get().checks, ...checks }, dirty: true });
      },

      correct(id, vector) {
        const working = get().working;
        if (get().phase !== 'saved' || !working) return false;
        return edit((w) => addSample(w, id, modalityOnly(vector), { sampleId: holdId(freshTakeId(w.samples), 0), t: deps.now(), modality }));
      },

      move(index, to) {
        return edit((w) => moveSample(w, index, to));
      },

      startMerge(seed, options = {}) {
        const { phase, working, openId, name, tuning, checks, hasStills } = get();
        // A fresh carve too (#421): the same document, so the new holds are added to it, its
        // pins kept, and its first take's rest kept for the reject radius.
        if ((phase !== 'saved' && phase !== 'carved') || !working) return;
        loc.mergeBase = { seed, phase, hasStills, working, record: loc.openRecord, openId, name: options.name ?? name, tuning, checks, dirty: get().dirty, ...(options.holdsIn ? { holdsIn: options.holdsIn } : {}), edits: { sources: loc.sources, undo: loc.undoStack, redo: loc.redoStack, baseRadius: loc.baseRadius, fresh: loc.fresh } };
        loc.pauseOnCapture = false;
        get().start();
        // After the start (which resets): the take's bursts carry this name.
        const into = options.holdsIn ? working.categories.find((c) => c.id === options.holdsIn) : undefined;
        set({ burstName: options.burstName ?? '', holdsAs: into ? into.label || into.id : null });
      },

      recordMore(id) {
        const { working, phase } = get();
        const cat = working?.categories.find((c) => c.id === id);
        if (!cat || !cat.label.trim() || (phase !== 'saved' && phase !== 'carved')) return false;
        get().startMerge('samples', { burstName: cat.label, holdsIn: cat.id });
        return isRecording(get().phase);
      },

      showOnBars(id) {
        const { working, view } = get();
        const hint = view?.hints.get(id);
        const cat = working?.categories.find((c) => c.id === id);
        if (!working || !hint || !cat) return false;
        const vectors = working.samples.map((x) => x.vector);
        const at = new Map(working.samples.map((x, i) => [x.id, i]));
        const centre = (ids: readonly string[]) => fullMean(vectors, ids.flatMap((x) => (at.has(x) ? [at.get(x)!] : [])));
        const other = hint.other === NEUTRAL_TARGET ? null : working.categories.find((c) => c.id === hint.other);
        const otherIds = other ? other.members : working.neutral;
        const otherLabel = other ? other.label || other.id : modality.words.neutral;
        const focus: BarFocus = {
          category: id,
          label: cat.label || cat.id,
          features: [...new Set(hint.movements.map((m) => m.feature))],
          marks: [
            { label: cat.label || cat.id, vector: centre(cat.members) },
            ...(otherIds.length > 0 ? [{ label: otherLabel, vector: centre(otherIds) }] : []),
          ],
        };
        if (!get().recordMore(id)) return false;
        loc.pauseOnCapture = true;
        set({ focus });
        return true;
      },

      importFile(text) {
        const r = importCategorizer(text);
        if (!r.ok) {
          set({ notice: `Could not import: ${r.error}.` });
          return false;
        }
        const foreign = foreignModality(modality, r.categorizer);
        if (foreign) {
          set({ notice: `Could not import: this is ${foreign}.` });
          return false;
        }
        get().reset();
        const taken = get().saved.some((s) => s.name.trim().toLowerCase() === r.categorizer.name.trim().toLowerCase());
        // An unknown vocabulary id is dropped and said so, not silently ignored (#465).
        const badVocabulary = unknownVocabulary(modality, r.categorizer);
        const { vocabulary: _dropped, ...rest } = r.categorizer;
        const imported = badVocabulary ? rest : r.categorizer;
        showOpened(imported, {
          openId: null,
          name: r.categorizer.name,
          tuning: DEFAULT_TUNING,
          dirty: true,
          notice:
            `Imported "${r.categorizer.name}"${r.migratedFrom !== null ? ` (from file version ${r.migratedFrom})` : ''}. A file carries no pictures. Save to keep it` +
            (taken ? '; saving under the same name replaces the one you have.' : '.') +
            (badVocabulary ? ` Note: ${badVocabulary}.` : ''),
        });
        return true;
      },

      exportFile(asked) {
        const { phase, working } = get();
        const given = asked?.trim() || get().name.trim();
        if ((phase !== 'saved' && phase !== 'carved') || !working) return null;
        const name = given || working.name || (modality.id === 'face' ? FACE_SESSION_DEFAULTS.exportName : `My ${modality.words.many}`);
        return { name, text: exportCategorizer({ ...working, name }) };
      },

      async exportSaved(id) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return null;
        }
        return { name: record.name, text: exportCategorizer({ ...record.model.categorizer, name: record.name }) };
      },

      async savedLabels(id) {
        const record = await deps.models.load(id).catch(() => null);
        return record ? record.model.categorizer.categories.map((c) => c.label) : null;
      },

      async importSaved(id, importer, confirm) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return false;
        }
        const entries = categoryEntries(record.model.categorizer);
        const taken = entries.filter((e) => importer.canonical(e.label) !== null);
        if (taken.length === 0) {
          set({ notice: `None of the categories of "${record.name}" is named as one of the ${importer.label} (${entries.map((e) => `"${e.label}"`).join(', ')}). Rename them first.` });
          return false;
        }
        const replaced = [...new Set(taken.filter((e) => importer.has(e.label)).map((e) => importer.canonical(e.label)!))];
        if (replaced.length > 0 && !confirm(`The ${importer.label} already have ${replaced.join(', ')}. Replace ${replaced.length === 1 ? 'it' : 'them'} with the ones from "${record.name}"?`)) return false;
        try {
          const r = await importer.import(entries, { hand: record.model.categorizer.hand ?? 'either' });
          const skipped = r.skipped.length > 0 ? ` Skipped ${r.skipped.map((l) => `"${l}"`).join(', ')} (not a name the ${importer.label} take, or too few samples).` : '';
          const warned = r.warnings.length > 0 ? ` Note: ${r.warnings.join('; ')}.` : '';
          set({ notice: r.imported.length > 0 ? `Now in the ${importer.label}: ${r.imported.join(', ')}.${skipped}${warned}` : `Nothing was imported.${skipped}` });
          return r.imported.length > 0;
        } catch (err) {
          set({ notice: `Could not import: ${err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)}` });
          return false;
        }
      },

      async bindSaved(id, binder) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return false;
        }
        try {
          // By id (#371): the host reads the record itself, with its tuning, its modality and its hand.
          await binder.bind({ id: record.id });
          return true;
        } catch (e) {
          set({ notice: `Not bound: ${e instanceof Error ? e.message : String(e)}.` });
          return false;
        }
      },
    };
  });
  return store;
}
