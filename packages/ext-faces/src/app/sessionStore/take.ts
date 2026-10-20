/**
 * The face session's take: Explore, recording with its pauses and bursts, the poll, the live
 * bars and watches, the capture seam, Stop, and reset. A concern of `createFaceSessionStore` (#746).
 */
import type { CaptureState, CarveCaptureControl } from '@thoremin/sdk-ui/enroll/capture';
import { type FaceTake, vocabularyCue, createFaceTake } from '../../lib/take';
import { type LiveBarsModel, type LiveBarsContext, createLiveBars } from '@thoremin/sdk/enroll/bars';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { restStats } from './ops';
import { createRestWatch, createLightWatch } from '../sessionWatches';
import { FACE_SESSION_DEFAULTS, type FacePhase, isLive, isRecording } from './state';
import { type ModalityOptions, createReader } from '@thoremin/sdk/enroll/modality';
import { modelFromCategorizer, MAX_CATEGORIZER_SAMPLES, categorizerFromModel } from '@thoremin/sdk/enroll/categorizer';
import { holdId } from '../thumbnails';
import { flooredRejectRadius, DEFAULT_TUNING } from '@thoremin/sdk/enroll/live';
import type { MergeRunner } from '../../lib/forest_prefetch';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import { neutralIndices } from '@thoremin/sdk/enroll/carve';
import { deleteHolds as deleteHoldsFrom } from '@thoremin/sdk/enroll/sorting';
import type { createStills } from './stills';
import type { createStrip } from './strip';
import type { createCarve } from './carve';
import type { SessionCtx } from './locals';
import type { FaceSessionState } from './state';

/** The take concern over the store's shared state. */
export function createTake(ctx: SessionCtx, h: Pick<ReturnType<typeof createStills>, 'grabStill' | 'show' | 'dropUrls'> & Pick<ReturnType<typeof createStrip>, 'refreshStrip' | 'refreshGhost' | 'clearStrip' | 'takeSamples' | 'withLeans' | 'withLabels' | 'labelledHolds' | 'holdAllIn'> & Pick<ReturnType<typeof createCarve>, 'restoreEdits' | 'showDoc' | 'commit' | 'carveFresh'>) {
  const { deps, freshTakeId, get, loc, modality, set } = ctx;
  const { grabStill, refreshStrip, refreshGhost, show, clearStrip, restoreEdits, showDoc, takeSamples, withLeans, withLabels, labelledHolds, holdAllIn, commit, carveFresh, dropUrls } = h;
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
  const actions: Pick<FaceSessionState, 'explore' | 'dropHold' | 'nameHold' | 'start' | 'pause' | 'resume' | 'toggleCapture' | 'setBurstName' | 'beginBurst' | 'endBurst' | 'live' | 'stop' | 'skipSetup' | 'setKeepStills' | 'reset' | 'cancelRecording'> = {
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
    skipSetup() {
      if (get().phase !== 'rest' || !loc.take) return;
      loc.take.skipSetup(deps.now());
      set({ setupStep: loc.take.setupStep() });
    },
    setKeepStills(on) {
      if (!isLive(get().phase)) set({ keepStills: on });
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
  };
  return { stopPolling, release, resetKeepingStills, captureState, provideCapture, barsFor, rest, light, readOptions, poll, stillNewHolds, afterBurst, actions };
}
