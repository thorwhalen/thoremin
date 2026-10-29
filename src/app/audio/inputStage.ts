/**
 * The measured input stage of THIS device (`@thoremin/sdk/timing/input_stage`): a per-device
 * preference, not an instrument's, set by whatever measured it (a loopback take, a tap-along
 * calibration, the latency probe) through {@link setInputStage}, and read synchronously by the
 * audio-input hub when it converts a stamped frame to the moment the sound reached the
 * microphone. The barPins pattern: zustand for what is read, a zodal `DataProvider` record
 * (localStorage by default) for what persists, hydrated once, written through on every change.
 */
import { z } from 'zod';
import { create } from 'zustand';
import { createInMemoryProvider, type DataProvider } from '@zodal/store';
import { hostCollection } from '@thoremin/sdk-ui/storage';
import type { InputStage } from '@thoremin/sdk/timing/input_stage';

export const InputStageRecordSchema = z.object({
  id: z.literal('device'),
  seconds: z.number().finite().min(0).max(1),
  source: z.enum(['measured', 'loopback', 'tap', 'reported', 'prior']),
  /** When it was measured (ISO), so a stale one can be shown as such. */
  at: z.string(),
});
export type InputStageRecord = z.infer<typeof InputStageRecordSchema>;

export const INPUT_STAGE_STORAGE_KEY = 'thoremin.audio.inputStage';

export function createInputStageProvider(): DataProvider<InputStageRecord> {
  return typeof localStorage === 'undefined'
    ? createInMemoryProvider<InputStageRecord>([], { idField: 'id' })
    : hostCollection<InputStageRecord>(INPUT_STAGE_STORAGE_KEY);
}

interface InputStageState {
  stage: InputStageRecord | null;
  hydrated: boolean;
  hydrate(): Promise<void>;
  set(stage: InputStage | null): void;
}

export function createInputStageStore(provider: DataProvider<InputStageRecord> = createInputStageProvider()) {
  let hydrating: Promise<void> | null = null;
  return create<InputStageState>()((set, get) => ({
    stage: null,
    hydrated: false,
    hydrate() {
      hydrating ??= provider
        .getList({})
        .then(({ data }) => {
          const r = InputStageRecordSchema.safeParse(data[0]);
          // A value set before hydration finished wins.
          set({ stage: get().stage ?? (r.success ? r.data : null), hydrated: true });
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
        provider.delete('device').catch(() => undefined);
        return;
      }
      const record = InputStageRecordSchema.parse({ id: 'device', seconds: stage.seconds, source: stage.source, at: new Date().toISOString() });
      set({ stage: record });
      const write = provider.upsert ? provider.upsert(record) : provider.update('device', record).catch(() => provider.create(record));
      Promise.resolve(write).catch((err) => console.warn('[thoremin] could not save the input stage', err));
    },
  }));
}

export const useInputStage = createInputStageStore();

/** Record a measured input stage for this device (null forgets it). */
export function setInputStage(stage: InputStage | null): void {
  useInputStage.getState().set(stage);
}

/** The stored input stage, or null (read synchronously by the hub). */
export function storedInputStage(): InputStage | null {
  const s = useInputStage.getState();
  if (!s.hydrated) void s.hydrate();
  return s.stage ? { seconds: s.stage.seconds, source: s.stage.source } : null;
}
