/**
 * The face session's state (#330 P2): record a take, carve it, show it, name it, save it, and
 * open or delete a saved one. A zustand store the panel renders; the take, the carvers, the
 * video and the stills' object URLs live beside it (not in it: none of them is something a
 * component renders by value).
 *
 * Every outside dependency is injected ({@link FaceSessionDeps}: the input source, the stills'
 * store and grabber, the saved-models collection, the clock, the claim on the face features),
 * so a test drives the whole flow with the synthetic face and in-memory stores.
 *
 * The hot-path split the app follows: the poll pushes vectors into the take at frame rate, and
 * the store is told only what a person can see change (the phase, the count of held faces, a
 * coarse elapsed time).
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { categorizerFromModel, type CategorizerMode, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { NamedCollectionStore, NamedSummary } from '@thoremin/sdk-ui/namedCollection';
import { carveView, carverFor, relabelCategorizer, renameCategory, savedView, type CarveView } from '../lib/carving';
import { createFaceTake, type FaceTake } from '../lib/take';
import type { Carver } from '@thoremin/sdk/enroll/carve';
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
  /** A take carved: the grid, k, the mode, names, Save. */
  | 'carved'
  /** A take that held no face long enough to carve. */
  | 'empty'
  /** A saved categorizer opened: the grid and its names (k is fixed without the take). */
  | 'saved';

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
  /** Ids (in `view`) of the categories whose name the player typed. */
  edited: readonly string[];
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

export const FACE_SESSION_DEFAULTS = { pollMs: 33, exemplars: 4 } as const;

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
  /** Bumped whenever the shown take changes, so a late still grab for an old one is dropped. */
  let generation = 0;
  const urls = new Map<number, string>();
  /** The live take's stills, by sample index: in memory until a save files them in IndexedDB,
   *  so a take nobody saves leaves nothing behind. */
  const stills = new Map<number, Blob>();

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
    /** The live take's stills for `indices`: grabbed from its kept video, held in memory. */
    const grabThumbs = async (indices: readonly number[]) => {
      const gen = generation;
      const missing = [...new Set(indices)].filter((i) => !urls.has(i));
      if (missing.length === 0 || !blob || !take) return;
      const points = take.session().points();
      const t0 = video?.t0 ?? 0;
      const got = await deps.grab(blob, missing.map((i) => (points[i].t - t0) / 1000)).catch(() => missing.map(() => null));
      if (gen !== generation) return;
      missing.forEach((i, j) => {
        const still = got[j];
        if (!still) return;
        stills.set(i, still);
        urls.set(i, URL.createObjectURL(still));
      });
      show(gen);
    };
    /** A saved categorizer's stills for `indices`, from IndexedDB. */
    const loadThumbs = async (indices: readonly number[], id: string | null) => {
      const gen = generation;
      if (!id) return;
      for (const i of new Set(indices)) {
        if (urls.has(i)) continue;
        const b = await deps.thumbs.get(thumbKey(id, i)).catch(() => null);
        if (gen !== generation) return;
        if (b) urls.set(i, URL.createObjectURL(b));
      }
      show(gen);
    };
    const shownIndices = (view: CarveView): number[] => [...view.categories.flatMap((c) => c.exemplars.map((e) => e.index)), ...view.neutral.exemplars];

    /** Carve the take at (mode, k), carrying the player's names from the shown view. */
    const recarve = (mode: CategorizerMode, k: number) => {
      if (!take) return;
      const session = take.session();
      const carver = (carvers[mode] ??= carverFor(session, take.restVectors(), mode));
      const prev = get().view;
      const view = carveView({
        session,
        restVectors: take.restVectors(),
        carver,
        k,
        previous: prev?.model ?? null,
        edited: new Set(get().edited),
        exemplarCount: FACE_SESSION_DEFAULTS.exemplars,
      });
      set({ mode, k: view.k, view, edited: view.categories.filter((c) => c.source === 'edited').map((c) => c.id) });
      void grabThumbs(shownIndices(view));
    };

    return {
      phase: 'idle',
      mode: 'reject',
      k: 0,
      view: null,
      edited: [],
      thumbs: {},
      points: 0,
      elapsed: 0,
      hasVideo: false,
      notice: null,
      saved: [],
      openId: null,
      name: '',

      start() {
        const phase = get().phase;
        if (phase === 'rest' || phase === 'faces') return;
        get().reset();
        generation++;
        source = deps.source();
        take = createFaceTake();
        takeId = deps.newTakeId();
        deps.claim(true);
        claimed = true;
        video = startVideoTake(source.video(), deps.now);
        const t0 = deps.now();
        take.start(t0);
        set({ phase: 'rest', points: 0, elapsed: 0, hasVideo: video !== null, notice: null, view: null, edited: [], thumbs: {}, openId: null });
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
        stopPolling();
        const built = take!.stop();
        release();
        blob = video ? await video.stop() : null;
        if (!built) {
          set({ phase: 'empty', notice: phase === 'rest' ? 'The take stopped during the rest, before any face was held. Record again and keep going after the rest.' : 'No face was held long enough to carve. Hold each face for a moment.' });
          return;
        }
        carvers = {};
        const mode = get().mode;
        const carver = (carvers[mode] = carverFor(take!.session(), take!.restVectors(), mode));
        set({ phase: 'carved', hasVideo: blob !== null, name: '' });
        recarve(mode, carver.suggestedK());
      },

      setMode(mode) {
        const { phase, view } = get();
        if (phase !== 'carved' || !take) {
          if (phase !== 'saved') set({ mode });
          return;
        }
        // The k the new mode's carver suggests, unless the player chose one: moving neutral in
        // or out of the categories changes k by one in the obvious direction.
        const carver = (carvers[mode] ??= carverFor(take.session(), take.restVectors(), mode));
        const k = view ? Math.max(1, Math.min(carver.maxK(), view.k + (mode === 'partition' ? 1 : -1))) : carver.suggestedK();
        recarve(mode, k);
      },

      setK(k) {
        if (get().phase !== 'carved') return;
        recarve(get().mode, k);
      },

      rename(id, label) {
        const { view, phase, edited } = get();
        if (!view || !label.trim()) return;
        const model = renameCategory(view.model, id, label);
        if (phase === 'saved') {
          set({ view: { ...view, model, categories: view.categories.map((c) => (c.id === id ? { ...c, label: label.trim(), source: 'edited' } : c)) } });
          return;
        }
        const ids = new Set(edited);
        ids.add(id);
        // Re-name the rest one-to-one around the player's names: a typed "happy" leaves the pool.
        set({ view: { ...view, model }, edited: [...ids] });
        recarve(get().mode, view.k);
      },

      async save(name) {
        const { view, phase, mode } = get();
        const trimmed = name.trim();
        if (!view || !trimmed) return false;
        let categorizer: PersonalCategorizer;
        let id: string | null = takeId;
        if (phase === 'saved' && openRecord) {
          categorizer = relabelCategorizer(openRecord.model.categorizer, view.model, trimmed);
          id = openRecord.model.takeId;
        } else if (phase === 'carved' && take) {
          categorizer = categorizerFromModel(view.model, take.session().points(), { name: trimmed, mode, modality: 'face', createdAt: deps.isoNow() });
        } else return false;
        try {
          // File the shown stills under the take first, so the saved record never points at
          // pictures that are not there yet.
          if (phase === 'carved' && id) {
            for (const i of shownIndices(view)) {
              const still = stills.get(i);
              if (still) await deps.thumbs.put(thumbKey(id, i), still).catch(() => undefined);
            }
          }
          const record = await deps.models.save(trimmed, { categorizer, takeId: phase === 'carved' && !get().hasVideo ? null : id });
          set({ notice: `Saved "${record.name}".`, name: record.name });
          await get().refreshSaved();
          return true;
        } catch (err) {
          set({ notice: `Could not save: ${err instanceof Error ? err.message : String(err)}` });
          return false;
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
        generation++;
        openRecord = record;
        const view = savedView(record.model.categorizer, { exemplarCount: FACE_SESSION_DEFAULTS.exemplars });
        set({ phase: 'saved', openId: id, view, mode: view.mode, k: view.k, name: record.name, hasVideo: record.model.takeId !== null, edited: [] });
        void loadThumbs(shownIndices(view), record.model.takeId);
      },

      async remove(id) {
        const record = await deps.models.load(id);
        await deps.models.remove(id);
        // Its stills go too, unless another saved categorizer came from the same take.
        const tid = record?.model.takeId;
        if (tid) {
          const others = await Promise.all((await deps.models.list()).map((s) => deps.models.load(s.id)));
          if (!others.some((r) => r?.model.takeId === tid)) await deps.thumbs.removePrefix(`${tid}:`).catch(() => undefined);
        }
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
        stills.clear();
        dropUrls();
        set({ phase: 'idle', view: null, edited: [], thumbs: {}, points: 0, elapsed: 0, hasVideo: false, openId: null, k: 0 });
      },
    };
  });
  return store;
}
