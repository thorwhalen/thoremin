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
import { persist } from 'zustand/middleware';

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
    { name: 'thoremin-trainer-prefs' },
  ),
);
