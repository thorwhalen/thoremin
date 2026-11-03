/**
 * The measured input stage of THIS device (`@thoremin/sdk/timing/input_stage`): a per-device
 * preference, not an instrument's, set by whatever measured it (a loopback take, the latency
 * probe) through {@link setInputStage}, and read synchronously by the audio-input hub when it
 * converts a stamped frame to the moment the sound reached the microphone (`storedInputStage`,
 * the browser hub's default).
 *
 * Why it lives in the SDK's app half (#881): a slice may not import app code, and a standalone
 * game page (`play/`) carries none of the app, yet both must read and write the SAME record, so a
 * stage measured on a page applies in the camera app on the same origin and the reverse. So it
 * stays light enough for a page: a vanilla zustand store (no React), a record checked by hand
 * (`./inputStageRecord`, no Zod), and the persistence (`./inputStageProvider`: the host's storage
 * seam and the zodal providers) imported only when the store first hydrates, so a page's entry
 * chunk carries none of it. The store itself is made on first use: a page with site data blocked
 * (where touching `localStorage` throws) still loads, and plays with the stage it can find.
 *
 * Three things it gets right that a plain write-through would not:
 * - a set (or a forget) made before hydration finished is the truth, never overwritten by the
 *   record hydration reads afterwards;
 * - another tab that measures a stage (a `storage` event for the key, the #847 pattern) is taken
 *   in, so two open pages never judge with two stages;
 * - a write that fails keeps the value for the session and says so once.
 *
 * `src/app/audio/inputStage.ts` re-exports it for the app.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { DataProvider } from '@zodal/store';
import type { InputStage } from '@thoremin/sdk/timing/input_stage';
import { INPUT_STAGE_RECORD_ID, INPUT_STAGE_STORAGE_KEY, inputStageRecord, parseInputStageRecord, type InputStageRecord } from './inputStageRecord';

export { INPUT_STAGE_RECORD_ID, INPUT_STAGE_STORAGE_KEY, inputStageRecord, parseInputStageRecord, type InputStageRecord } from './inputStageRecord';

export interface InputStageState {
  stage: InputStageRecord | null;
  hydrated: boolean;
  /** Read the stored record once (later calls return the same promise). */
  hydrate(): Promise<void>;
  /** Read the stored record again and take it as the truth (another tab wrote it). */
  reload(): Promise<void>;
  set(stage: InputStage | null): void;
}

export interface InputStageStoreOptions {
  /** Where the record persists (default: `./inputStageProvider`, imported on first hydration). */
  provider?: DataProvider<InputStageRecord> | (() => Promise<DataProvider<InputStageRecord>>);
  /** The time a set is stamped with (default now). */
  now?: () => Date;
  /** Calls `changed` whenever another context wrote the record; returns the unsubscribe
   *  (default: the window's `storage` event for the key, nothing where there is no window). */
  watch?: (changed: () => void) => () => void;
}

/** The persistence a store gets by default: loaded on demand, out of a page's entry chunk. */
const defaultProvider = (): Promise<DataProvider<InputStageRecord>> => import('./inputStageProvider').then((m) => m.createInputStageProvider());

/** Another tab's write of the key (`key` null: that tab cleared its storage). */
function watchStorageEvents(changed: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const on = (e: StorageEvent) => {
    if (e.key === INPUT_STAGE_STORAGE_KEY || e.key === null) changed();
  };
  window.addEventListener('storage', on);
  return () => window.removeEventListener('storage', on);
}

export function createInputStageStore({ provider = defaultProvider, now = () => new Date(), watch = watchStorageEvents }: InputStageStoreOptions = {}): StoreApi<InputStageState> {
  let resolved: Promise<DataProvider<InputStageRecord>> | null = null;
  const persistence = () => (resolved ??= typeof provider === 'function' ? provider() : Promise.resolve(provider));
  let hydrating: Promise<void> | null = null;
  /** A set (or forget) happened before the first hydration finished: it is the truth. */
  let setBeforeHydration = false;
  const read = () =>
    persistence()
      .then((p) => p.getList({}))
      .then(({ data }) => parseInputStageRecord(data.find((r) => r.id === INPUT_STAGE_RECORD_ID)));
  const warn = (what: string) => (err: unknown) => console.warn(`[thoremin] could not ${what} the input stage`, err);

  const store = createStore<InputStageState>()((set, get) => ({
    stage: null,
    hydrated: false,
    hydrate() {
      hydrating ??= read()
        .then((stored) => set(setBeforeHydration ? { hydrated: true } : { stage: stored, hydrated: true }))
        .catch((err) => {
          warn('read')(err);
          set({ hydrated: true });
        });
      return hydrating;
    },
    reload() {
      return read()
        .then((stored) => set({ stage: stored, hydrated: true }))
        .catch(warn('read'));
    },
    set(stage) {
      if (!get().hydrated) setBeforeHydration = true;
      if (!stage) {
        set({ stage: null });
        persistence()
          .then((p) => p.delete(INPUT_STAGE_RECORD_ID))
          .catch(() => undefined);
        return;
      }
      const record = inputStageRecord(stage, now().toISOString());
      set({ stage: record });
      persistence()
        .then((p) => (p.upsert ? p.upsert(record) : p.update(INPUT_STAGE_RECORD_ID, record).catch(() => p.create(record))))
        .catch(warn('save'));
    },
  }));
  watch(() => void store.getState().reload());
  return store;
}

let pageStore: StoreApi<InputStageState> | null = null;

/** This page's store (the app's and every standalone page's: one per page, one record per origin), made on first use. */
export function inputStageStore(): StoreApi<InputStageState> {
  return (pageStore ??= createInputStageStore());
}

/** Record a measured input stage for this device (null forgets it). */
export function setInputStage(stage: InputStage | null): void {
  inputStageStore().getState().set(stage);
}

/** Read the stored record now (a page calls it at mount, so its first take converts with it). */
export function hydrateInputStage(): Promise<void> {
  return inputStageStore().getState().hydrate();
}

/** The stored record (with when it was measured), or null. */
export function inputStageRecordNow(): InputStageRecord | null {
  return inputStageStore().getState().stage;
}

/** The stored input stage, or null (read synchronously by the hub; starts hydration on first use). */
export function storedInputStage(): InputStage | null {
  const s = inputStageStore().getState();
  if (!s.hydrated) void s.hydrate();
  return s.stage ? { seconds: s.stage.seconds, source: s.stage.source } : null;
}
