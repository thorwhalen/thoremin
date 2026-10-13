/**
 * The face session's state (#330 P2, P3): record a take, carve it, show it, name it, save it, and
 * open or delete a saved one; then (P3) test it and correct it: a WORKING copy of the open
 * categorizer takes the player's corrections (a live face added to a category, a sample moved,
 * a new take merged in with P1's `mergeSession`) and the live tuning, until Save; and a
 * categorizer is imported from or exported to P1's versioned file. A zustand store the panel renders; the take, the carvers, the
 * video, the stills and the names the player typed live beside it (not in it: none of them is
 * something a component renders by value).
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
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { categorizerFromModel, exportCategorizer, importCategorizer, type CategorizerMode, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { carveView, carverFor, savedView, withTypedName, type CarveView, type TypedName } from '../lib/carving';
import { addSample, moveSample, type CorrectionResult } from '../lib/corrections';
import { clampTuning, DEFAULT_TUNING, flooredRejectRadius, type Tuning } from '../lib/live';
import { createFaceTake, type FaceTake } from '../lib/take';
import type { Carver } from '@thoremin/sdk/enroll/carve';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { FaceModelRecord, SavedFaceModel } from './models';
import type { FaceSource } from './sources';
import { thumbKey, type FrameGrabber, type ThumbStore } from './thumbnails';
import { startVideoTake, type VideoTake } from './videoTake';

export type FacePhase =
  /** Nothing recorded; the saved list and Record. */
  | 'idle'
  /** Recording the resting face. */
  | 'rest'
  /** Recording the player's faces. */
  | 'faces'
  /** Stop was pressed: the video is being closed and the take carved. */
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
export const isRecording = (phase: FacePhase): boolean => phase === 'rest' || phase === 'faces' || phase === 'stopping';

export interface FaceSessionDeps {
  source: () => FaceSource;
  thumbs: ThumbStore;
  grab: FrameGrabber;
  models: NamedCollectionStore<FaceModelRecord, SavedFaceModel>;
  /** Engine-clock ms. */
  now: () => number;
  /** How often the live vector is read while recording. */
  pollMs: number;
  /** Claim (true) or release the face features and the instrument's quiet while recording. */
  claim: (on: boolean) => void;
  newTakeId: () => string;
  /** Wall-clock ISO time, for the saved file. */
  isoNow: () => string;
}

export interface FaceSessionState {
  phase: FacePhase;
  mode: CategorizerMode;
  k: number;
  view: CarveView | null;
  /** Object URLs of the stills in hand, by sample index. */
  thumbs: Readonly<Record<number, string>>;
  /** Held faces captured so far (while recording). */
  points: number;
  /** Seconds since Record (while recording). */
  elapsed: number;
  /** Whether this take's video is being / was kept (false: no pictures in the grid). */
  hasVideo: boolean;
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

  start(): void;
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
  /** Move sample `index` of the open categorizer to category `to` (null: to no category). */
  move(index: number, to: string | null): boolean;
  /** Record a new take and merge it into the open categorizer (P1's `mergeSession`). */
  startMerge(seed: MergeSeed): void;
  /** Open a categorizer from a file's text (validated, older versions migrated); not saved yet. */
  importFile(text: string): boolean;
  /** The open categorizer as a file's text (P1's versioned format), or null. */
  exportFile(): { name: string; text: string } | null;
}

export const FACE_SESSION_DEFAULTS = {
  pollMs: 33,
  exemplars: 4,
  /** A still-point's `t` is when the hold BEGAN; its picture is taken this much later, half the
   *  sampler's 220 ms dwell, so it shows the face held rather than the end of a transition. */
  stillOffsetMs: 110,
} as const;

/** Only the face's keys: a saved sample keeps what a face categorizer can use, not the hands
 *  and body that rode along in the live vector (it is stored in localStorage). */
export const faceOnly = (v: FeatureVector): FeatureVector => Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('face.')));

export function createFaceSessionStore(deps: FaceSessionDeps): StoreApi<FaceSessionState> {
  let take: FaceTake | null = null;
  let source: FaceSource | null = null;
  let video: VideoTake | null = null;
  let blob: Blob | null = null;
  let takeId: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let carvers: Partial<Record<CategorizerMode, Carver>> = {};
  let openRecord: FaceModelRecord | null = null;
  /** The categorizer a recording is being merged into, and what to restore if it is empty. */
  let mergeBase: { seed: MergeSeed; working: PersonalCategorizer; record: FaceModelRecord | null; openId: string | null; name: string; tuning: Tuning; dirty: boolean } | null = null;
  /** A `samples` merge's base stills, copied on Save from the base's take id into the merge's own
   *  (never filed under the base's id: another record may share it, with other faces at the new
   *  indices). */
  let copyBase: { from: string; count: number } | null = null;
  /** Which of the take's points a sample index's still comes from (null: not from this take).
   *  The identity for a carve; offset past the base's samples for a merge. */
  let pointOf: (index: number) => number | null = (i) => i;
  /** The take id the shown in-memory stills are filed under on Save (null: none to file). */
  let stillsTakeId: string | null = null;
  /** Whether this store holds the face-feature claim (and the hush). */
  let claimed = false;
  /** Bumped whenever the shown take changes, so a late result for an old one is dropped. */
  let generation = 0;
  /** The names the player typed for this take, carried onto every carve (see `TypedName`). */
  let typed: TypedName[] = [];
  const urls = new Map<number, string>();
  /** The live take's stills, by sample index: in memory until a save files them in IndexedDB,
   *  so a take nobody saves leaves nothing behind. */
  const stills = new Map<number, Blob>();
  /** Still grabs run one at a time, in order; `grabbing` holds the indices queued or running. */
  let grabs: Promise<void> = Promise.resolve();
  const grabbing = new Set<number>();

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
      if (claimed) deps.claim(false);
      claimed = false;
      source?.dispose();
      source = null;
    };
    const show = (gen: number) => {
      if (gen === generation) set({ thumbs: Object.fromEntries(urls) });
    };

    /** Queue the live take's stills for `indices` (those not in hand or queued), grabbed from its
     *  kept video one batch at a time. */
    const grabThumbs = (indices: readonly number[]): Promise<void> => {
      const gen = generation;
      const points = take?.session().points() ?? [];
      const want = [...new Set(indices)].filter((i) => !urls.has(i) && !grabbing.has(i) && points[pointOf(i) ?? -1] !== undefined);
      if (want.length === 0 || !blob || !take) return grabs;
      const video_ = blob;
      const t0 = video?.t0() ?? 0;
      for (const i of want) grabbing.add(i);
      grabs = grabs.then(async () => {
        try {
          if (gen !== generation) return;
          const got = await deps.grab(video_, want.map((i) => (points[pointOf(i)!].t + FACE_SESSION_DEFAULTS.stillOffsetMs - t0) / 1000)).catch(() => want.map(() => null));
          if (gen !== generation) return;
          want.forEach((i, j) => {
            const still = got[j];
            if (!still || urls.has(i)) return;
            stills.set(i, still);
            urls.set(i, URL.createObjectURL(still));
          });
          show(gen);
        } finally {
          for (const i of want) grabbing.delete(i);
        }
      });
      return grabs;
    };
    /** A saved categorizer's stills for `indices`, from IndexedDB. */
    const loadThumbs = async (indices: readonly number[], id: string | null) => {
      const gen = generation;
      if (!id) return;
      for (const i of new Set(indices)) {
        if (urls.has(i)) continue;
        const b = await deps.thumbs.get(thumbKey(id, i)).catch(() => null);
        if (gen !== generation) return;
        if (b && !urls.has(i)) urls.set(i, URL.createObjectURL(b));
      }
      show(gen);
    };
    const shownIndices = (view: CarveView): number[] => [...view.categories.flatMap((c) => c.exemplars.map((e) => e.index)), ...view.neutral.exemplars];

    /** Carve the take at (mode, k), with the player's typed names. */
    const recarve = (mode: CategorizerMode, k: number) => {
      if (!take) return;
      const session = take.session();
      const carver = (carvers[mode] ??= carverFor(session, take.restVectors(), mode));
      const view = carveView({ session, restVectors: take.restVectors(), carver, k, typed, exemplarCount: FACE_SESSION_DEFAULTS.exemplars });
      const notice =
        view.k === 0
          ? 'Every held face was close to your resting face, so there is no expression to carve. Choose "Every face is a category", or record again with stronger faces.'
          : null;
      set({ mode, k: view.k, view, notice, dirty: true });
      void grabThumbs(shownIndices(view));
    };

    /** Show the working categorizer (phase `saved`): its grid, its stills (in memory from a merged
     *  take first, then the saved record's in IndexedDB). */
    const showWorking = (working: PersonalCategorizer, patch: Partial<FaceSessionState> = {}) => {
      const view = savedView(working, { exemplarCount: FACE_SESSION_DEFAULTS.exemplars });
      set({ phase: 'saved', working, view, mode: view.mode, k: view.k, ...patch });
      const shown = shownIndices(view);
      void grabThumbs(shown);
      void loadThumbs(shown.filter((i) => pointOf(i) === null), openRecord?.model.takeId ?? null);
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

    /** Delete a take's stills unless a saved record other than `except` still shows them. */
    const dropStillsIfOrphaned = async (tid: string | null | undefined, except?: string) => {
      if (!tid) return;
      const others = await Promise.all((await deps.models.list()).filter((s) => s.id !== except).map((s) => deps.models.load(s.id)));
      if (!others.some((r) => r?.model.takeId === tid)) await deps.thumbs.removePrefix(`${tid}:`).catch(() => undefined);
    };

    return {
      phase: 'idle',
      mode: 'reject',
      k: 0,
      view: null,
      thumbs: {},
      points: 0,
      elapsed: 0,
      hasVideo: false,
      notice: null,
      saved: [],
      openId: null,
      name: '',
      saving: false,
      working: null,
      tuning: DEFAULT_TUNING,
      dirty: false,
      merging: null,

      start() {
        if (isRecording(get().phase)) return;
        const merge = mergeBase;
        get().reset();
        mergeBase = merge;
        source = deps.source();
        take = createFaceTake();
        takeId = deps.newTakeId();
        deps.claim(true);
        claimed = true;
        video = startVideoTake(source.video(), deps.now);
        const t0 = deps.now();
        take.start(t0);
        set({ phase: 'rest', points: 0, elapsed: 0, hasVideo: video !== null, notice: null, view: null, thumbs: {}, openId: null, name: merge?.name ?? '', merging: merge?.seed ?? null });
        let lastShown = -1;
        timer = setInterval(() => {
          if (!take || !source) return;
          const live = source.read();
          if (live) take.push(live.vector, live.t);
          const phaseNow = take.phase() === 'faces' ? 'faces' : 'rest';
          const elapsed = Math.floor((deps.now() - t0) / 250) / 4;
          const points = take.pointCount();
          const s = get();
          if (s.phase !== phaseNow || s.points !== points || elapsed !== lastShown) {
            lastShown = elapsed;
            set({ phase: phaseNow, points, elapsed });
          }
        }, deps.pollMs);
      },

      async stop() {
        const phase = get().phase;
        if (phase !== 'rest' && phase !== 'faces') return;
        // Synchronously out of the recording phases: a second Stop, or the panel's cleanup, now
        // sees a take being stopped, not one to stop again.
        set({ phase: 'stopping' });
        const gen = generation;
        const myTake = take!;
        const myVideo = video;
        let built = false;
        try {
          stopPolling();
          built = myTake.stop();
        } finally {
          release();
        }
        const kept = myVideo ? await myVideo.stop().catch(() => null) : null;
        if (gen !== generation) return;
        blob = kept;
        const merge = mergeBase;
        mergeBase = null;
        if (merge) {
          openRecord = merge.record;
          const restore = { openId: merge.openId, name: merge.name, tuning: merge.tuning, merging: null, hasVideo: merge.record?.model.takeId != null };
          if (!built) {
            pointOf = () => null;
            showWorking(merge.working, { ...restore, dirty: merge.dirty, notice: 'No face was held long enough to add. Nothing was merged.' });
            return;
          }
          const fresh = myTake.session().points().map((p) => ({ ...p, vector: faceOnly(p.vector) }));
          // New faces are sorted with the FLOORED radius the readout uses (a file's tiny stored
          // radius would set every new face aside); not with the dial's scale, which stays a live
          // setting rather than being written into the samples' radius.
          const base = merge.working.mode === 'reject' ? { ...merge.working, rejectRadius: flooredRejectRadius(merge.working) } : merge.working;
          const result = mergeSession(base, fresh, { seed: merge.seed });
          const offset = result.categorizer.samples.length - fresh.length;
          pointOf = (i) => (i >= offset ? i - offset : null);
          // The base's stills still show (from its take id) unless its samples were replaced by
          // its centroids (seed `centroids`). On Save they are copied under this take's id with
          // the new ones, so the record never shares a take id whose indices mean other faces.
          const baseTake = merge.seed === 'samples' ? (merge.record?.model.takeId ?? null) : null;
          copyBase = baseTake ? { from: baseTake, count: offset } : null;
          stillsTakeId = blob || baseTake ? takeId : null;
          if (!baseTake) openRecord = merge.record ? { ...merge.record, model: { ...merge.record.model, takeId: null } } : null;
          const keepsBase = baseTake !== null;
          const joined = result.assigned.filter((a) => a >= 0).length;
          const untouched = result.untouched.map((id) => result.categorizer.categories.find((c) => c.id === id)?.label || id);
          showWorking(result.categorizer, {
            ...restore,
            hasVideo: blob !== null || Boolean(keepsBase),
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
          set({
            phase: 'empty',
            notice:
              phase === 'rest'
                ? 'The take stopped during the rest, before any face was held. Record again and keep going after the rest.'
                : 'No face was held long enough to carve. Hold each face for a moment.',
          });
          return;
        }
        carvers = {};
        const mode = get().mode;
        const carver = (carvers[mode] = carverFor(myTake.session(), myTake.restVectors(), mode));
        pointOf = (i) => i;
        stillsTakeId = blob ? takeId : null;
        set({ phase: 'carved', hasVideo: blob !== null, name: '', dirty: true });
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
          let tid: string | null;
          const working = get().working;
          const tuningAtStart = get().tuning;
          if (phase === 'saved' && working) {
            categorizer = { ...working, name: trimmed };
            tid = stillsTakeId ?? openRecord?.model.takeId ?? null;
          } else if (phase === 'carved' && take) {
            const points = take.session().points().map((p) => ({ ...p, vector: faceOnly(p.vector) }));
            categorizer = categorizerFromModel(view.model, points, { name: trimmed, mode, modality: 'face', createdAt: deps.isoNow() });
            tid = stillsTakeId;
          } else return false;
          // The shown stills of the take in hand (a carve's, or a merged take's), grabbed in full
          // first (a Save right after a re-cut must not file a categorizer whose pictures were
          // still being taken), then filed under the take.
          if (copyBase && tid && copyBase.from !== tid) {
            const { from, count } = copyBase;
            for (let i = 0; i < count; i++) {
              const b = await deps.thumbs.get(thumbKey(from, i)).catch(() => null);
              if (b) await deps.thumbs.put(thumbKey(tid, i), b).catch(() => undefined);
            }
            if (gen !== generation) return false;
          }
          if (blob && tid) {
            await grabThumbs(shownIndices(view));
            if (gen !== generation) return false;
            for (const i of shownIndices(view)) {
              const still = stills.get(i);
              if (still) await deps.thumbs.put(thumbKey(tid, i), still).catch(() => undefined);
            }
          }
          // Saving under a name that already exists replaces that record: its take's stills go
          // too, unless another record (or this one) still shows them.
          const before = new Map((await Promise.all((await deps.models.list()).map((s) => deps.models.load(s.id)))).filter((r): r is FaceModelRecord => r !== null).map((r) => [r.id, r.model.takeId]));
          const tuning = get().tuning;
          const record = await deps.models.save(trimmed, { categorizer, takeId: tid, ...(phase === 'saved' ? { tuning } : {}) });
          const replaced = before.get(record.id);
          if (replaced && replaced !== tid) await dropStillsIfOrphaned(replaced);
          if (gen === generation) {
            // An edit made while the save was in flight (a correction, a tuning, a re-cut) is kept,
            // and still unsaved: what was saved is the state when Save was pressed.
            const changed = get().view !== view || get().tuning !== tuningAtStart;
            set({ notice: `Saved "${record.name}".${changed ? ' Changes made since are not saved yet.' : ''}`, name: record.name, dirty: changed, ...(phase === 'saved' ? { openId: record.id, working: changed && get().working ? { ...get().working!, name: record.name } : record.model.categorizer } : {}) });
            if (phase === 'saved') {
              openRecord = record;
              copyBase = null;
              stillsTakeId = record.model.takeId;
            }
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
        pointOf = () => null;
        showWorking(record.model.categorizer, { openId: id, name: record.name, hasVideo: record.model.takeId !== null, tuning: clampTuning(record.model.tuning ?? {}), dirty: false });
      },

      async remove(id) {
        const record = await deps.models.load(id);
        await deps.models.remove(id);
        await dropStillsIfOrphaned(record?.model.takeId);
        if (get().openId === id) get().reset();
        await get().refreshSaved();
      },

      reset() {
        generation++;
        release();
        video?.cancel();
        video = null;
        take = null;
        blob = null;
        carvers = {};
        openRecord = null;
        mergeBase = null;
        copyBase = null;
        pointOf = (i) => i;
        stillsTakeId = null;
        typed = [];
        stills.clear();
        grabbing.clear();
        grabs = Promise.resolve();
        dropUrls();
        set({ phase: 'idle', view: null, thumbs: {}, points: 0, elapsed: 0, hasVideo: false, openId: null, k: 0, notice: null, working: null, tuning: DEFAULT_TUNING, dirty: false, merging: null });
      },

      cancelRecording() {
        const merge = mergeBase;
        if (!isRecording(get().phase) || !merge) {
          if (isRecording(get().phase)) get().reset();
          return;
        }
        // A merge take abandoned: back to the categorizer it was adding to, unsaved work and all.
        get().reset();
        openRecord = merge.record;
        pointOf = () => null;
        showWorking(merge.working, {
          openId: merge.openId,
          name: merge.name,
          tuning: merge.tuning,
          dirty: merge.dirty,
          hasVideo: merge.record?.model.takeId != null,
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
        return applyCorrection(addSample(working, id, faceOnly(vector), { t: deps.now() }));
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
        const modality = r.categorizer.modality;
        if ((modality && modality !== 'face') || !r.categorizer.features.some((f) => f.startsWith('face.'))) {
          set({ notice: `Could not import: this is a ${modality ?? 'non-face'} categorizer, not a face one.` });
          return false;
        }
        get().reset();
        pointOf = () => null;
        const taken = get().saved.some((s) => s.name.trim().toLowerCase() === r.categorizer.name.trim().toLowerCase());
        showWorking(r.categorizer, {
          openId: null,
          name: r.categorizer.name,
          hasVideo: false,
          tuning: DEFAULT_TUNING,
          dirty: true,
          notice:
            `Imported "${r.categorizer.name}"${r.migratedFrom !== null ? ` (from file version ${r.migratedFrom})` : ''}. It has no pictures. Save to keep it` +
            (taken ? '; saving under the same name replaces the one you have.' : '.'),
        });
        return true;
      },

      exportFile() {
        const working = get().working;
        if (get().phase !== 'saved' || !working) return null;
        const name = get().name.trim() || working.name;
        return { name, text: exportCategorizer({ ...working, name }) };
      },
    };
  });
  return store;
}
