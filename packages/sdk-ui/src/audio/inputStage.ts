/**
 * The measured input stage of THIS device (`@thoremin/sdk/timing/input_stage`): a per-device
 * preference, not an instrument's, set by whatever measured it (a loopback take, a tap-along
 * calibration, the latency probe) through {@link setInputStage}, and read synchronously by the
 * audio-input hub when it converts a stamped frame to the moment the sound reached the
 * microphone (`storedInputStage`, the hub's dependency of that name).
 *
 * Why it lives in the SDK's app half (#881): a slice may not import app code, and a standalone
 * game page (`play/`) carries none of the app, yet both must read and write the SAME record, so a
 * stage measured on a page applies in the camera app on the same origin and the reverse. So it
 * stays light enough for a page: a vanilla zustand store (no React), a record checked by a plain
 * guard (no Zod: a page's budget is a few tens of kilobytes and Zod alone is most of two hundred),
 * and the host's storage seam (`../storage`: localStorage under {@link INPUT_STAGE_STORAGE_KEY}
 * by default, the app's chosen target once the shell installs one). The barPins pattern: the store
 * for what is read, a zodal `DataProvider` record for what persists, hydrated once, written through
 * on every change. `src/app/audio/inputStage.ts` re-exports it for the app.
 */
import { createStore } from 'zustand/vanilla';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { INPUT_STAGE_TRUST, MAX_INPUT_STAGE_S, type InputStage, type InputStageSource } from '@thoremin/sdk/timing/input_stage';
import { hostCollection } from '../storage';

/** The one record kept: this device's stage, when it was measured (ISO), so a stale one can be shown as such. */
export interface InputStageRecord {
  id: typeof INPUT_STAGE_RECORD_ID;
  seconds: number;
  source: InputStageSource;
  at: string;
}

export const INPUT_STAGE_RECORD_ID = 'device';
export const INPUT_STAGE_STORAGE_KEY = 'thoremin.audio.inputStage';

/** The record, or null when `v` is not one (a value written by an older or broken build reads as none). */
export function parseInputStageRecord(v: unknown): InputStageRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<InputStageRecord>;
  const ok =
    r.id === INPUT_STAGE_RECORD_ID &&
    typeof r.seconds === 'number' &&
    Number.isFinite(r.seconds) &&
    r.seconds >= 0 &&
    r.seconds <= MAX_INPUT_STAGE_S &&
    (INPUT_STAGE_TRUST as readonly unknown[]).includes(r.source) &&
    typeof r.at === 'string';
  return ok ? { id: r.id!, seconds: r.seconds!, source: r.source!, at: r.at! } : null;
}

/** The record for `stage` measured `at`; throws, saying what is wrong, for a stage no device may keep. */
export function inputStageRecord(stage: InputStage, at: string): InputStageRecord {
  const r = parseInputStageRecord({ id: INPUT_STAGE_RECORD_ID, seconds: stage.seconds, source: stage.source, at });
  if (!r) throw new RangeError(`not an input stage a device may keep: ${JSON.stringify(stage)} (seconds in 0..${MAX_INPUT_STAGE_S}, source one of ${INPUT_STAGE_TRUST.join(', ')})`);
  return r;
}

/** The host's collection under the key, or memory where there is no localStorage (plain Node). */
export function createInputStageProvider(): DataProvider<InputStageRecord> {
  return typeof localStorage === 'undefined'
    ? createInMemoryProvider<InputStageRecord>([], { idField: 'id' })
    : hostCollection<InputStageRecord>(INPUT_STAGE_STORAGE_KEY);
}

export interface InputStageState {
  stage: InputStageRecord | null;
  hydrated: boolean;
  hydrate(): Promise<void>;
  set(stage: InputStage | null): void;
}

export interface InputStageStoreOptions {
  /** Where the record persists (default {@link createInputStageProvider}). */
  provider?: DataProvider<InputStageRecord>;
  /** The time a set is stamped with (default now). */
  now?: () => Date;
}

export function createInputStageStore({ provider = createInputStageProvider(), now = () => new Date() }: InputStageStoreOptions = {}) {
  let hydrating: Promise<void> | null = null;
  return createStore<InputStageState>()((set, get) => ({
    stage: null,
    hydrated: false,
    hydrate() {
      hydrating ??= provider
        .getList({})
        .then(({ data }) => {
          // A value set before hydration finished wins.
          set({ stage: get().stage ?? parseInputStageRecord(data.find((r) => r.id === INPUT_STAGE_RECORD_ID)), hydrated: true });
        })
        .catch((err) => {
          console.warn('[thoremin] could not read the input stage', err);
          set({ hydrated: true });
        });
      return hydrating;
    },
    set(stage) {
      if (!stage) {
        set({ stage: null });
        provider.delete(INPUT_STAGE_RECORD_ID).catch(() => undefined);
        return;
      }
      const record = inputStageRecord(stage, now().toISOString());
      set({ stage: record });
      const write = provider.upsert ? provider.upsert(record) : provider.update(INPUT_STAGE_RECORD_ID, record).catch(() => provider.create(record));
      Promise.resolve(write).catch((err) => console.warn('[thoremin] could not save the input stage', err));
    },
  }));
}

/** This page's store (the app's and every standalone page's: one per page, one record per origin). */
export const inputStageStore = createInputStageStore();

/** Record a measured input stage for this device (null forgets it). */
export function setInputStage(stage: InputStage | null): void {
  inputStageStore.getState().set(stage);
}

/** Read the stored record now (a page calls it at mount, so its first take converts with it). */
export function hydrateInputStage(): Promise<void> {
  return inputStageStore.getState().hydrate();
}

/** The stored record (with when it was measured), or null. */
export function inputStageRecordNow(): InputStageRecord | null {
  return inputStageStore.getState().stage;
}

/** The stored input stage, or null (read synchronously by the hub; starts hydration on first use). */
export function storedInputStage(): InputStage | null {
  const s = inputStageStore.getState();
  if (!s.hydrated) void s.hydrate();
  return s.stage ? { seconds: s.stage.seconds, source: s.stage.source } : null;
}
