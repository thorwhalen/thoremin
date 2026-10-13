/**
 * The face session's state (#330 P2): record a take, carve it, show it, name it, save it, and
 * open or delete a saved one. A zustand store the panel renders; the take, the carvers, the
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
import { categorizerFromModel, type CategorizerMode, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { carveView, carverFor, relabelCategorizer, renameCategory, savedView, withTypedName, type CarveView, type TypedName } from '../lib/carving';
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
  /** A saved categorizer opened: the grid and its names (k is fixed without the take). */
  | 'saved';

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
const faceOnly = (v: FeatureVector): FeatureVector => Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith('face.')));

export function createFaceSessionStore(deps: FaceSessionDeps): StoreApi<FaceSessionState> {
  let take: FaceTake | null = null;
  let source: FaceSource | null = null;
  let video: VideoTake | null = null;
  let blob: Blob | null = null;
  let takeId: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let carvers: Partial<Record<CategorizerMode, Carver>> = {};
  let openRecord: FaceModelRecord | null = null;
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
      const want = [...new Set(indices)].filter((i) => !urls.has(i) && !grabbing.has(i));
      if (want.length === 0 || !blob || !take) return grabs;
      const video_ = blob;
      const points = take.session().points();
      const t0 = video?.t0() ?? 0;
      for (const i of want) grabbing.add(i);
      grabs = grabs.then(async () => {
        try {
          if (gen !== generation) return;
          const got = await deps.grab(video_, want.map((i) => (points[i].t + FACE_SESSION_DEFAULTS.stillOffsetMs - t0) / 1000)).catch(() => want.map(() => null));
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
      set({ mode, k: view.k, view, notice });
      void grabThumbs(shownIndices(view));
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

      start() {
        if (isRecording(get().phase)) return;
        get().reset();
        source = deps.source();
        take = createFaceTake();
        takeId = deps.newTakeId();
        deps.claim(true);
        claimed = true;
        video = startVideoTake(source.video(), deps.now);
        const t0 = deps.now();
        take.start(t0);
        set({ phase: 'rest', points: 0, elapsed: 0, hasVideo: video !== null, notice: null, view: null, thumbs: {}, openId: null, name: '' });
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
        set({ phase: 'carved', hasVideo: blob !== null, name: '' });
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
          const model = renameCategory(view.model, id, name);
          set({ notice: null, view: { ...view, model, categories: view.categories.map((c) => (c.id === id ? { ...c, label: name, source: 'edited' } : c)) } });
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
          if (phase === 'saved' && openRecord) {
            categorizer = relabelCategorizer(openRecord.model.categorizer, view.model, trimmed);
            tid = openRecord.model.takeId;
          } else if (phase === 'carved' && take) {
            const points = take.session().points().map((p) => ({ ...p, vector: faceOnly(p.vector) }));
            categorizer = categorizerFromModel(view.model, points, { name: trimmed, mode, modality: 'face', createdAt: deps.isoNow() });
            tid = blob ? takeId : null;
            // The shown stills, grabbed in full first (a Save right after a re-cut must not file a
            // categorizer whose pictures were still being taken), then filed under the take.
            await grabThumbs(shownIndices(view));
            if (gen !== generation) return false;
            if (tid) for (const i of shownIndices(view)) {
              const still = stills.get(i);
              if (still) await deps.thumbs.put(thumbKey(tid, i), still).catch(() => undefined);
            }
          } else return false;
          // Saving under a name that already exists replaces that record: its take's stills go
          // too, unless another record (or this one) still shows them.
          const before = new Map((await Promise.all((await deps.models.list()).map((s) => deps.models.load(s.id)))).filter((r): r is FaceModelRecord => r !== null).map((r) => [r.id, r.model.takeId]));
          const record = await deps.models.save(trimmed, { categorizer, takeId: tid });
          const replaced = before.get(record.id);
          if (replaced && replaced !== tid) await dropStillsIfOrphaned(replaced);
          if (gen === generation) {
            set({ notice: `Saved "${record.name}".`, name: record.name, ...(phase === 'saved' ? { openId: record.id } : {}) });
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
        const view = savedView(record.model.categorizer, { exemplarCount: FACE_SESSION_DEFAULTS.exemplars });
        set({ phase: 'saved', openId: id, view, mode: view.mode, k: view.k, name: record.name, hasVideo: record.model.takeId !== null });
        void loadThumbs(shownIndices(view), record.model.takeId);
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
        typed = [];
        stills.clear();
        grabbing.clear();
        grabs = Promise.resolve();
        dropUrls();
        set({ phase: 'idle', view: null, thumbs: {}, points: 0, elapsed: 0, hasVideo: false, openId: null, k: 0, notice: null });
      },
    };
  });
  return store;
}
