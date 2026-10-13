/**
 * The face session's state (#330 P2, P3): record a take, carve it, show it, name it, save it, and
 * open or delete a saved one; then (P3) test it and correct it: a WORKING copy of the open
 * categorizer takes the player's corrections (a live face added to a category, a sample moved,
 * a new take merged in with P1's `mergeSession`) and the live tuning, until Save; and a
 * categorizer is imported from or exported to P1's versioned file. A zustand store the panel renders; the take, the carvers, the
 * stills and the names the player typed live beside it (not in it: none of them is something a
 * component renders by value).
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
  exportCategorizer,
  importCategorizer,
  type CategorizerMode,
  type PersonalCategorizer,
  type SampleInput,
} from '@thoremin/sdk/enroll/categorizer';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { carveView, carverFor, savedView, withTypedName, type CarveView, type TypedName } from '../lib/carving';
import { addSample, moveSample, type CorrectionResult } from '../lib/corrections';
import { clampTuning, DEFAULT_TUNING, flooredRejectRadius, type Tuning } from '../lib/live';
import { createFaceTake, vocabularyCue, type FaceTake, type HoldState } from '../lib/take';
import type { Carver } from '@thoremin/sdk/enroll/carve';
import { foreignModality, keepOnly, type CarveModality } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { createLiveBars, type LiveBars, type LiveBarsContext, type LiveBarsModel } from '@thoremin/sdk/enroll/bars';
import type { CaptureState, CarveCaptureControl } from '@thoremin/sdk-ui/enroll/capture';
import type { CarveModalityUi } from '@thoremin/sdk-ui/enroll/modality';
import type { FaceModelRecord, SavedFaceModel } from './models';
import type { FaceSource } from './sources';
import { holdId, type FrameOpener, type LiveFrames, type ThumbStore } from './thumbnails';

export type FacePhase =
  /** Nothing recorded; the saved list and Record. */
  | 'idle'
  /** The camera read (the bars, the ring), nothing recorded yet (#385 E2). */
  | 'explore'
  /** Recording the resting face. */
  | 'rest'
  /** Recording the player's faces. */
  | 'faces'
  /** The capture paused: the camera still read, nothing collected (#385 E2). */
  | 'paused'
  /** Stop was pressed: the take is being carved. */
  | 'stopping'
  /** A take carved: the grid, k, the mode, names, Save. */
  | 'carved'
  /** A take that held no face long enough to carve. */
  | 'empty'
  /** A categorizer open (saved, imported or merged): the grid and its names (k is fixed without
   *  the take), the live test, corrections and the tuning. */
  | 'saved';

/** What a new take merged into the open categorizer keeps of it (P1's `mergeSession` seed):
 *  `samples`, more of the same player; `centroids`, only the categories (a model made by
 *  someone else, retrained on this face). */
export type MergeSeed = 'samples' | 'centroids';

/** Whether a phase is a recording in progress (closing the tool must end it). */
export const isRecording = (phase: FacePhase): boolean => phase === 'rest' || phase === 'faces' || phase === 'paused' || phase === 'stopping';

/** Whether a phase reads the camera (claims the features, hushes the instrument): exploring
 *  or recording. Closing the tool ends it. */
export const isLive = (phase: FacePhase): boolean => phase === 'explore' || isRecording(phase);

export interface FaceSessionDeps {
  source: () => FaceSource;
  thumbs: ThumbStore;
  /** Opens the source's stream for stills, taken at capture (#385 E3). */
  frames: FrameOpener;
  /** The crop for a still (the modality's region; the whole frame by default). */
  region?: CarveModalityUi['region'];
  models: NamedCollectionStore<FaceModelRecord, SavedFaceModel>;
  /** Engine-clock ms. */
  now: () => number;
  /** How often the live vector is read while recording. */
  pollMs: number;
  /** Claim (true) or release the face features and the instrument's quiet while recording. */
  claim: (on: boolean) => void;
  /** A fresh take id: a take's holds are `<takeId>:<n>` (and a correction's own sample id is
   *  a fresh take's first). */
  newTakeId: () => string;
  /** Wall-clock ISO time, for the saved file. */
  isoNow: () => string;
  /** What is carved (the face by default): the keys a sample keeps, the cues, the names, the
   *  modality a file must be to import. */
  modality?: CarveModality;
  /** Provide the live take's capture control for the host's `carve.capture.toggle` command
   *  (`@thoremin/sdk-ui/enroll/capture`'s `provideCarveCapture`); returns its withdrawal. None
   *  by default. */
  capture?: (control: CarveCaptureControl) => () => void;
}

export interface FaceSessionState {
  phase: FacePhase;
  mode: CategorizerMode;
  k: number;
  view: CarveView | null;
  /** Object URLs of the stills in hand, by index into the shown samples (the take's holds, or
   *  the open categorizer's samples). */
  thumbs: Readonly<Record<number, string>>;
  /** Held faces captured so far (while recording). */
  points: number;
  /** The hold ring's state (exploring, capturing or paused). */
  hold: HoldState;
  /** Seconds since Record (while recording). */
  elapsed: number;
  /** Whether pictures are taken (recording) or found (an open categorizer); false: the grid
   *  has none. */
  hasStills: boolean;
  notice: string | null;
  saved: readonly NamedSummary[];
  /** The saved categorizer open in the grid (phase `saved`), by record id. */
  openId: string | null;
  /** The name the Save field starts from. */
  name: string;
  /** A save is in flight (Save is disabled meanwhile). */
  saving: boolean;
  /** The open categorizer with its unsaved corrections (phase `saved`), or null. */
  working: PersonalCategorizer | null;
  /** The open categorizer's live tuning (phase `saved`). */
  tuning: Tuning;
  /** Something shown is not saved: a fresh carve, a correction, a merge, an import, a tuning. */
  dirty: boolean;
  /** The take being recorded is merged into the open categorizer, with this seed. */
  merging: MergeSeed | null;

  /** Read the camera without recording (#385 E2): the bars and the ring run; Start captures. */
  explore(): void;
  /** Record: the rest, then the faces. From Explore it goes on with the same reading. */
  start(): void;
  /** Stop collecting faces; the camera is still read (from `faces`). */
  pause(): void;
  /** Collect faces again (from `paused`). */
  resume(): void;
  /** Space: Explore starts, capturing pauses, paused resumes (the rest is left to end). */
  toggleCapture(): void;
  /** The live feature bars now, or null when nothing is read. Not reactive: a panel polls it. */
  live(options?: { count?: number }): LiveBars | null;
  stop(): Promise<void>;
  setMode(mode: CategorizerMode): void;
  setK(k: number): void;
  rename(id: string, label: string): void;
  save(name: string): Promise<boolean>;
  refreshSaved(): Promise<void>;
  open(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Back to the list, dropping the take (and stopping a recording). */
  reset(): void;
  /** End a recording without keeping it: a merge take returns to the categorizer it was adding
   *  to (its unsaved changes kept); any other take is dropped, as `reset`. */
  cancelRecording(): void;
  /** Set the open categorizer's live tuning (kept with it on Save). */
  setTuning(tuning: Partial<Tuning>): void;
  /** "This face is `id`": add a live face to a category of the open categorizer. */
  correct(id: string, vector: FeatureVector): boolean;
  /** Move sample `index` of the open categorizer to category `to` (null: out of every one). */
  move(index: number, to: string | null): boolean;
  /** Record a new take and merge it into the open categorizer (P1's `mergeSession`). */
  startMerge(seed: MergeSeed): void;
  /** Open a categorizer from a file's text (validated, older versions migrated); not saved yet. */
  importFile(text: string): boolean;
  /** The categorizer shown, as a file's text (P1's versioned format): an open one, or a fresh
   *  carve before it is saved (#369), named `name` when given (the Save field's text), else
   *  its own name, else {@link FACE_SESSION_DEFAULTS.exportName}. Null with nothing to export. */
  exportFile(name?: string): { name: string; text: string } | null;
  /** A saved categorizer as a file's text, without opening it (#369): the SAVED version, not
   *  unsaved edits on it while it is open. Null (and a notice) if it cannot be read. */
  exportSaved(id: string): Promise<{ name: string; text: string } | null>;
}

export const FACE_SESSION_DEFAULTS = {
  /** The name a fresh carve is exported under when it has none yet. */
  exportName: 'My faces',
  pollMs: 33,
  exemplars: 4,
} as const;

export function createFaceSessionStore(deps: FaceSessionDeps): StoreApi<FaceSessionState> {
  const modality = deps.modality ?? faceModality;
  /** Only the modality's keys: a saved sample keeps what its categorizer can use, not the hands
   *  and body that rode along in the live vector (it is stored in localStorage). */
  const modalityOnly = (v: FeatureVector): FeatureVector => keepOnly(modality, v);
  let take: FaceTake | null = null;
  /** The live bars over the take being read (null when nothing is read). */
  let bars: LiveBarsModel | null = null;
  /** Withdraws the capture control this store provided. */
  let withdraw: (() => void) | null = null;
  let source: FaceSource | null = null;
  /** The source's stream, open for stills while recording (null: no pictures this take). */
  let frames: LiveFrames | null = null;
  let takeId: string | null = null;
  /** Holds of the take whose still was asked for (the take's point count, as last seen). */
  let stilled = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let carvers: Partial<Record<CategorizerMode, Carver>> = {};
  let openRecord: FaceModelRecord | null = null;
  /** The categorizer a recording is being merged into, and what to restore if it is empty. */
  let mergeBase: { seed: MergeSeed; working: PersonalCategorizer; record: FaceModelRecord | null; openId: string | null; name: string; tuning: Tuning; dirty: boolean } | null = null;
  /** The hold ids of the samples shown, by index (the take's holds, or the open categorizer's
   *  samples): what `thumbs` is keyed by. */
  let shownIds: readonly string[] = [];
  /** Whether this store holds the face-feature claim (and the hush). */
  let claimed = false;
  /** Bumped whenever the shown take changes, so a late result for an old one is dropped. */
  let generation = 0;
  /** The names the player typed for this take, carried onto every carve (see `TypedName`). */
  let typed: TypedName[] = [];
  /** Object URLs of the stills in hand, by hold id. */
  const urls = new Map<string, string>();
  /** The stills taken this session, by hold id: in memory until a save files them in
   *  IndexedDB, so a take nobody saves leaves nothing behind. Kept across a merge's take (the
   *  base's in-memory stills stay shown) until `reset`. */
  const stills = new Map<string, Blob>();
  /** The stills still being encoded, so Save waits for them. */
  const pending = new Set<Promise<void>>();

  const store = createStore<FaceSessionState>()((set, get) => {
    const dropUrls = () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    };
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const release = () => {
      stopPolling();
      frames?.close();
      frames = null;
      if (claimed) deps.claim(false);
      claimed = false;
      source?.dispose();
      source = null;
      bars = null;
      withdraw?.();
      withdraw = null;
    };

    /** The capture state the host's command sees (null when nothing is live). */
    const captureState = (): CaptureState | null => {
      const phase = get().phase;
      return phase === 'explore' ? 'explore' : phase === 'rest' ? 'rest' : phase === 'faces' ? 'capturing' : phase === 'paused' ? 'paused' : null;
    };
    const provideCapture = () => {
      if (withdraw || !deps.capture) return;
      const control: CarveCaptureControl = { what: modality.words.many, state: () => captureState() ?? 'explore', toggle: () => get().toggleCapture() };
      withdraw = deps.capture(control);
    };

    /** The bars' view of a take: its features, its noise unit, its rest once there is one, and
     *  its holds (the arrays cached, so the online carve runs once per new hold). */
    const barsFor = (t: FaceTake): LiveBarsModel => {
      const session = t.session();
      const ids = session.featuresFor(vocabularyCue(modality));
      let holds: { n: number; vectors: FeatureVector[] } = { n: 0, vectors: [] };
      let rest: { mean: FeatureVector; spread: Record<string, number> } | null = null;
      const context = (): LiveBarsContext => {
        const points = session.points();
        if (points.length !== holds.n) holds = { n: points.length, vectors: points.map((p) => p.vector) };
        if (!rest && t.facesStartedAt() !== null) rest = restStats(t.restVectors(), ids);
        const noise = session.noise();
        return { ids, sigma: (id) => (noise.isWarm(id) ? noise.sigma(id) : Number.NaN), rest: rest?.mean ?? null, restSpread: rest?.spread ?? null, holds: holds.vectors };
      };
      return createLiveBars(context);
    };

    /** Read the source into the take every `pollMs`, telling the store only what a person can
     *  see change (the phase, the count of held faces, the ring, a coarse elapsed time). */
    const poll = (t0: number) => {
      stopPolling();
      let lastShown = -1;
      timer = setInterval(() => {
        if (!take || !source) return;
        const live = source.read();
        if (live) {
          take.push(live.vector, live.t);
          bars?.push(modality.read(live.vector), live.t);
          stillNewHolds(live.vector);
        }
        const tp = take.phase();
        const phaseNow: FacePhase = tp === 'explore' || tp === 'rest' || tp === 'faces' || tp === 'paused' ? tp : get().phase;
        const elapsed = phaseNow === 'explore' ? 0 : Math.floor((deps.now() - t0) / 250) / 4;
        const points = take.pointCount();
        const hold = take.hold();
        const s = get();
        if (s.phase !== phaseNow || s.points !== points || elapsed !== lastShown || s.hold !== hold) {
          lastShown = elapsed;
          set({ phase: phaseNow, points, elapsed, hold });
        }
      }, deps.pollMs);
    };
    const show = (gen: number) => {
      if (gen !== generation) return;
      const thumbs: Record<number, string> = {};
      shownIds.forEach((id, i) => {
        const url = urls.get(id);
        if (url) thumbs[i] = url;
      });
      set({ thumbs });
    };

    /** Take a still for each hold the take emitted since the last poll, from the frame showing
     *  now (the hold was just taken, so the face is still held), cropped to the region the live
     *  vector places the part in. */
    const stillNewHolds = (vector: FeatureVector) => {
      if (!take || !takeId) return;
      const n = take.pointCount();
      const tid = takeId;
      for (; stilled < n; stilled++) {
        const id = holdId(tid, stilled);
        if (!frames) continue;
        const gen = generation;
        const job = frames
          .grab(deps.region ? (size) => deps.region!({ vector, ...size }) : null)
          .catch(() => null)
          .then((still) => {
            if (gen !== generation || !still || stills.has(id)) return;
            stills.set(id, still);
            urls.set(id, URL.createObjectURL(still));
            show(gen);
          })
          .finally(() => pending.delete(job));
        pending.add(job);
      }
    };
    /** Every still being encoded, done. */
    const stillsTaken = () => Promise.all([...pending]);
    /** Stills for `ids` filed in IndexedDB (those not in hand). Returns whether any was found. */
    const loadThumbs = async (ids: readonly string[]): Promise<boolean> => {
      const gen = generation;
      let found = false;
      for (const id of new Set(ids)) {
        if (urls.has(id)) {
          found = true;
          continue;
        }
        const b = await deps.thumbs.get(id).catch(() => null);
        if (gen !== generation) return found;
        if (b && !urls.has(id)) urls.set(id, URL.createObjectURL(b));
        found ||= b !== null;
      }
      show(gen);
      return found;
    };
    const shownIndices = (view: CarveView): number[] => [...view.categories.flatMap((c) => c.exemplars.map((e) => e.index)), ...view.neutral.exemplars];
    /** The take's holds, as the samples a categorizer is made of: their ids, the modality's
     *  keys only, and their supporting frames. */
    const takeSamples = (t: FaceTake, tid: string): SampleInput[] =>
      t
        .session()
        .points()
        .map((p, i) => ({ ...p, id: holdId(tid, i), vector: modalityOnly(p.vector), support: t.support(i) }));

    /** The take in hand as a categorizer, carved as shown (what Save files and Export writes). */
    const carvedCategorizer = (view: CarveView, mode: CategorizerMode, name: string): PersonalCategorizer =>
      categorizerFromModel(view.model, takeSamples(take!, takeId!), { name, mode, modality: modality.id, createdAt: deps.isoNow() });

    /** Carve the take at (mode, k), with the player's typed names. */
    const recarve = (mode: CategorizerMode, k: number) => {
      if (!take) return;
      const session = take.session();
      const carver = (carvers[mode] ??= carverFor(session, take.restVectors(), mode));
      const view = carveView({ session, restVectors: take.restVectors(), carver, k, typed, exemplarCount: FACE_SESSION_DEFAULTS.exemplars, modality });
      const notice =
        view.k === 0
          ? 'Every held face was close to your resting face, so there is no expression to carve. Choose "Every face is a category", or record again with stronger faces.'
          : null;
      shownIds = take.session().points().map((_, i) => holdId(takeId!, i));
      set({ mode, k: view.k, view, notice, dirty: true });
      show(generation);
    };

    /** Show the working categorizer (phase `saved`): its grid, its stills by sample id (in
     *  memory from this session's takes first, then filed in IndexedDB). */
    const showWorking = (working: PersonalCategorizer, patch: Partial<FaceSessionState> = {}) => {
      const view = savedView(working, { exemplarCount: FACE_SESSION_DEFAULTS.exemplars });
      shownIds = working.samples.map((x) => x.id);
      set({ phase: 'saved', working, view, mode: view.mode, k: view.k, ...patch });
      const gen = generation;
      void loadThumbs(shownIndices(view).map((i) => shownIds[i])).then((found) => {
        if (gen === generation && get().working === working) set({ hasStills: found });
      });
    };
    /** Apply a correction to the working categorizer. */
    const applyCorrection = (r: CorrectionResult): boolean => {
      if (!r.ok) {
        set({ notice: `Not changed: ${r.error}.` });
        return false;
      }
      showWorking(r.categorizer, { dirty: true, notice: null });
      return true;
    };

    /** Delete the stills of `ids` that no saved record's samples name any more. */
    const dropStillsIfOrphaned = async (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const records = await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id)));
      const named = new Set(records.flatMap((r) => r?.model.categorizer.samples.map((x) => x.id) ?? []));
      const orphans = ids.filter((id) => !named.has(id));
      if (orphans.length > 0) await deps.thumbs.remove(orphans).catch(() => undefined);
    };

    return {
      phase: 'idle',
      mode: 'reject',
      k: 0,
      view: null,
      thumbs: {},
      points: 0,
      hold: 'open',
      elapsed: 0,
      hasStills: false,
      notice: null,
      saved: [],
      openId: null,
      name: '',
      saving: false,
      working: null,
      tuning: DEFAULT_TUNING,
      dirty: false,
      merging: null,

      explore() {
        if (isLive(get().phase)) return;
        get().reset();
        source = deps.source();
        take = createFaceTake({ modality });
        bars = barsFor(take);
        deps.claim(true);
        claimed = true;
        take.explore(deps.now());
        set({ phase: 'explore', points: 0, elapsed: 0, hold: 'open', notice: null, view: null, thumbs: {}, openId: null, name: '', merging: null });
        provideCapture();
        poll(deps.now());
      },

      start() {
        const exploring = get().phase === 'explore' && take !== null && source !== null;
        if (isRecording(get().phase)) return;
        const merge = mergeBase;
        if (!exploring) {
          get().reset();
          mergeBase = merge;
          source = deps.source();
          take = createFaceTake({ modality });
          bars = barsFor(take);
          deps.claim(true);
          claimed = true;
        }
        else {
          // A fresh source for the capture: the live one is stateless (the tap and the camera
          // stay), and the scripted one starts its script, rest first, when the capture does.
          source!.dispose();
          source = deps.source();
        }
        takeId = deps.newTakeId();
        stilled = 0;
        const stream = source!.video();
        frames = stream ? deps.frames(stream) : null;
        const t0 = deps.now();
        take!.start(t0);
        set({ phase: 'rest', points: 0, elapsed: 0, hold: 'open', hasStills: frames !== null, notice: null, view: null, thumbs: {}, openId: null, name: merge?.name ?? '', merging: merge?.seed ?? null });
        provideCapture();
        poll(t0);
      },

      pause() {
        if (get().phase !== 'faces' || !take) return;
        take.pause(deps.now());
        set({ phase: 'paused', hold: take.hold() });
      },

      resume() {
        if (get().phase !== 'paused' || !take) return;
        take.resume(deps.now());
        set({ phase: 'faces', hold: take.hold() });
      },

      toggleCapture() {
        const phase = get().phase;
        if (phase === 'explore') get().start();
        else if (phase === 'faces') get().pause();
        else if (phase === 'paused') get().resume();
      },

      live(options) {
        return bars && isLive(get().phase) && get().phase !== 'stopping' ? bars.snapshot(options) : null;
      },

      async stop() {
        const phase = get().phase;
        if (phase !== 'rest' && phase !== 'faces' && phase !== 'paused') return;
        // Synchronously out of the recording phases: a second Stop, or the panel's cleanup, now
        // sees a take being stopped, not one to stop again.
        set({ phase: 'stopping' });
        const myTake = take!;
        const hadStills = frames !== null;
        let built = false;
        try {
          stopPolling();
          built = myTake.stop();
        } finally {
          release();
        }
        const merge = mergeBase;
        mergeBase = null;
        if (merge) {
          openRecord = merge.record;
          const restore = { openId: merge.openId, name: merge.name, tuning: merge.tuning, merging: null };
          if (!built) {
            showWorking(merge.working, { ...restore, dirty: merge.dirty, notice: 'No face was held long enough to add. Nothing was merged.' });
            return;
          }
          const fresh = takeSamples(myTake, takeId!);
          // New faces are sorted with the FLOORED radius the readout uses (a file's tiny stored
          // radius would set every new face aside); not with the dial's scale, which stays a live
          // setting rather than being written into the samples' radius.
          const base = merge.working.strangers === 'neutral' ? { ...merge.working, rejectRadius: flooredRejectRadius(merge.working) } : merge.working;
          const result = mergeSession(base, fresh, { seed: merge.seed });
          // The import bound (addSample keeps it too): a categorizer merged past it could not
          // be read back from its own exported file. Refused as a notice, the base kept.
          if (result.categorizer.samples.length > MAX_CATEGORIZER_SAMPLES) {
            showWorking(merge.working, {
              ...restore,
              dirty: merge.dirty,
              notice: `Nothing was merged: the result would hold ${result.categorizer.samples.length} faces, more than the ${MAX_CATEGORIZER_SAMPLES} a categorizer keeps.`,
            });
            return;
          }
          // Every sample keeps its id (the base's, and the new holds' `<takeId>:<n>`), so every
          // still stays filed where it is: the new ones are filed on Save, nothing is re-filed.
          const joined = result.assigned.filter((a) => a >= 0).length;
          const untouched = result.untouched.map((id) => result.categorizer.categories.find((c) => c.id === id)?.label || id);
          showWorking(result.categorizer, {
            ...restore,
            dirty: true,
            notice:
              `Merged: ${joined} of ${fresh.length} new faces joined a category` +
              (fresh.length > joined ? ` (${fresh.length - joined} read as none of these)` : '') +
              (untouched.length > 0 ? `; no new face for ${untouched.map((l) => `"${l}"`).join(', ')}` : '') +
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
        carvers = {};
        const mode = get().mode;
        const carver = (carvers[mode] = carverFor(myTake.session(), myTake.restVectors(), mode));
        set({ phase: 'carved', hasStills: hadStills, name: '', dirty: true });
        recarve(mode, carver.suggestedK());
      },

      setMode(mode) {
        const { phase, view } = get();
        if (phase !== 'carved' || !take) {
          if (phase === 'idle' || phase === 'empty') set({ mode });
          return;
        }
        // Moving neutral in or out of the categories changes k by one in the obvious direction.
        const carver = (carvers[mode] ??= carverFor(take.session(), take.restVectors(), mode));
        const k = view && view.k > 0 ? Math.max(1, Math.min(carver.maxK(), view.k + (mode === 'partition' ? 1 : -1))) : carver.suggestedK();
        recarve(mode, k);
      },

      setK(k) {
        if (get().phase !== 'carved') return;
        recarve(get().mode, k);
      },

      rename(id, label) {
        const { view, phase } = get();
        const name = label.trim();
        if (!view || !name) return;
        const clash = view.categories.find((c) => c.id !== id && c.label.trim().toLowerCase() === name.toLowerCase());
        if (phase === 'saved') {
          if (clash) {
            set({ notice: `Another category is already called "${clash.label}".` });
            return;
          }
          const working = get().working;
          if (!working) return;
          showWorking({ ...working, categories: working.categories.map((c) => (c.id === id ? { ...c, label: name } : c)) }, { notice: null, dirty: true });
          return;
        }
        if (phase !== 'carved') return;
        // A default name the player takes yields (it is proposed elsewhere); another typed name does not.
        const next = withTypedName(typed, view, id, name);
        if (!next) {
          set({ notice: `Another category is already called "${clash?.label ?? name}".` });
          return;
        }
        typed = next;
        recarve(get().mode, view.k);
      },

      async save(name) {
        const { view, phase, mode, saving } = get();
        const trimmed = name.trim();
        if (!view || !trimmed || saving || view.k === 0) return false;
        if (phase !== 'carved' && phase !== 'saved') return false;
        const gen = generation;
        set({ saving: true });
        try {
          let categorizer: PersonalCategorizer;
          const working = get().working;
          const tuningAtStart = get().tuning;
          if (phase === 'saved' && working) categorizer = { ...working, name: trimmed };
          else if (phase === 'carved' && take) categorizer = carvedCategorizer(view, mode, trimmed);
          else return false;
          // Every hold's still taken this session, filed under its id once it is encoded (a Save
          // right after Stop must not file a categorizer whose pictures were still being taken).
          // Stills already filed (a saved base's) stay where they are.
          await stillsTaken();
          if (gen !== generation) return false;
          for (const x of categorizer.samples) {
            const still = stills.get(x.id);
            if (still) await deps.thumbs.put(x.id, still).catch(() => undefined);
          }
          // Saving under a name that already exists replaces that record: its stills go too,
          // unless another record (or this one) still names their holds.
          const before = new Map(
            (await Promise.all((await deps.models.list()).map((x) => deps.models.load(x.id))))
              .filter((r): r is FaceModelRecord => r !== null)
              .map((r) => [r.id, r.model.categorizer.samples.map((x) => x.id)]),
          );
          const tuning = get().tuning;
          const record = await deps.models.save(trimmed, { categorizer, ...(phase === 'saved' ? { tuning } : {}) });
          const replaced = before.get(record.id);
          if (replaced) await dropStillsIfOrphaned(replaced);
          if (gen === generation) {
            // An edit made while the save was in flight (a correction, a tuning, a re-cut) is kept,
            // and still unsaved: what was saved is the state when Save was pressed.
            const changed = get().view !== view || get().tuning !== tuningAtStart;
            set({ notice: `Saved "${record.name}".${changed ? ' Changes made since are not saved yet.' : ''}`, name: record.name, dirty: changed, ...(phase === 'saved' ? { openId: record.id, working: changed && get().working ? { ...get().working!, name: record.name } : record.model.categorizer } : {}) });
            if (phase === 'saved') openRecord = record;
          }
          await get().refreshSaved();
          return true;
        } catch (err) {
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
        openRecord = record;
        showWorking(record.model.categorizer, { openId: id, name: record.name, tuning: clampTuning(record.model.tuning ?? {}), dirty: false });
      },

      async remove(id) {
        const record = await deps.models.load(id);
        await deps.models.remove(id);
        await dropStillsIfOrphaned(record?.model.categorizer.samples.map((x) => x.id) ?? []);
        if (get().openId === id) get().reset();
        await get().refreshSaved();
      },

      reset() {
        generation++;
        release();
        take = null;
        takeId = null;
        stilled = 0;
        carvers = {};
        openRecord = null;
        mergeBase = null;
        shownIds = [];
        typed = [];
        stills.clear();
        pending.clear();
        dropUrls();
        set({ phase: 'idle', view: null, thumbs: {}, points: 0, hold: 'open', elapsed: 0, hasStills: false, openId: null, k: 0, notice: null, working: null, tuning: DEFAULT_TUNING, dirty: false, merging: null });
      },

      cancelRecording() {
        const merge = mergeBase;
        if (!isRecording(get().phase) || !merge) {
          if (isLive(get().phase)) get().reset();
          return;
        }
        // A merge take abandoned: back to the categorizer it was adding to, unsaved work and all.
        get().reset();
        openRecord = merge.record;
        showWorking(merge.working, {
          openId: merge.openId,
          name: merge.name,
          tuning: merge.tuning,
          dirty: merge.dirty,
          notice: 'The take was stopped before it finished. Nothing was merged.',
        });
      },

      setTuning(tuning) {
        if (get().phase !== 'saved') return;
        const next = clampTuning({ ...get().tuning, ...tuning });
        const cur = get().tuning;
        if (next.sensitivity === cur.sensitivity && next.rejectScale === cur.rejectScale && next.distance === cur.distance) return;
        set({ tuning: next, dirty: true });
      },

      correct(id, vector) {
        const working = get().working;
        if (get().phase !== 'saved' || !working) return false;
        return applyCorrection(addSample(working, id, modalityOnly(vector), { sampleId: holdId(deps.newTakeId(), 0), t: deps.now(), modality }));
      },

      move(index, to) {
        const working = get().working;
        if (get().phase !== 'saved' || !working) return false;
        return applyCorrection(moveSample(working, index, to));
      },

      startMerge(seed) {
        const { phase, working, openId, name, tuning } = get();
        if (phase !== 'saved' || !working) return;
        mergeBase = { seed, working, record: openRecord, openId, name, tuning, dirty: get().dirty };
        get().start();
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
        showWorking(r.categorizer, {
          openId: null,
          name: r.categorizer.name,
          tuning: DEFAULT_TUNING,
          dirty: true,
          notice:
            `Imported "${r.categorizer.name}"${r.migratedFrom !== null ? ` (from file version ${r.migratedFrom})` : ''}. A file carries no pictures. Save to keep it` +
            (taken ? '; saving under the same name replaces the one you have.' : '.'),
        });
        return true;
      },

      exportFile(asked) {
        const { phase, working, view, mode } = get();
        const given = asked?.trim() || get().name.trim();
        if (phase === 'saved' && working) {
          const name = given || working.name;
          return { name, text: exportCategorizer({ ...working, name }) };
        }
        if (phase === 'carved' && take && view && view.k > 0) {
          const name = given || FACE_SESSION_DEFAULTS.exportName;
          return { name, text: exportCategorizer(carvedCategorizer(view, mode, name)) };
        }
        return null;
      },

      async exportSaved(id) {
        const record = await deps.models.load(id).catch(() => null);
        if (!record) {
          set({ notice: 'That categorizer could not be read.' });
          return null;
        }
        return { name: record.name, text: exportCategorizer({ ...record.model.categorizer, name: record.name }) };
      },
    };
  });
  return store;
}

/** The rest frames' mean and standard deviation over `ids` (raw units): what the bars measure
 *  from, and the neutral band they draw. */
function restStats(vectors: readonly FeatureVector[], ids: readonly string[]): { mean: FeatureVector; spread: Record<string, number> } | null {
  if (vectors.length === 0) return null;
  const mean: FeatureVector = {};
  const spread: Record<string, number> = {};
  for (const id of ids) {
    const xs = vectors.map((v) => v[id]).filter((x): x is number => Number.isFinite(x));
    if (xs.length === 0) continue;
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    mean[id] = m;
    spread[id] = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  }
  return { mean, spread };
}
