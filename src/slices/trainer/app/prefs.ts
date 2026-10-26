/**
 * Trainer tooling prefs (#163) — per-device, persisted, never part of an instrument.
 *
 * `recordTake` (default ON): a routine is also RECORDED — the clean camera stream, the
 * feature vectors and the cue/verdict annotations — through the app's own session
 * recorder (#88), so the take can be replayed, exported and labelled later.
 *
 * `manualAdvance` (default off): the trainer waits for the player to press Done/Enter
 * before moving to the next cue, instead of deciding for itself.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { hostPersistValues, noopValues } from '@thoremin/sdk-ui/storage';
import { TRAINER_STORES } from '../stores';

interface TrainerPrefs {
  /** Record the take (clean camera + features + cue annotations). Default ON. */
  recordTake: boolean;
  setRecordTake(on: boolean): void;
  /**
   * Manual advance: the trainer never decides a cue is done on its own — you press
   * Done (or Enter) to move to the next. Default OFF (the automatic advance is the
   * out-of-the-box experience). See the runner's `manualAdvance`.
   */
  manualAdvance: boolean;
  setManualAdvance(on: boolean): void;
}

export const useTrainerPrefs = create<TrainerPrefs>()(
  persist(
    (set) => ({
      recordTake: true,
      setRecordTake: (on) => set({ recordTake: on }),
      manualAdvance: false,
      setManualAdvance: (on) => set({ manualAdvance: on }),
    }),
    // The host's key-value target (the storage seam, #659: localStorage in the browser, as
    // zustand's default was); a no-op where the host has none (Node).
    { name: TRAINER_STORES.prefs.legacyKey, storage: createJSONStorage(() => hostPersistValues(noopValues)) },
  ),
);
