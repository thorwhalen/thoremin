/**
 * Trainer tooling prefs (#163) — per-device, persisted, never part of an instrument.
 *
 * `recordTake`: when on, a routine is also RECORDED — the clean camera stream, the
 * feature vectors and the cue/verdict annotations — through the app's own session
 * recorder (#88), so the take can be replayed, exported and labelled later.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TrainerPrefs {
  recordTake: boolean;
  setRecordTake(on: boolean): void;
}

export const useTrainerPrefs = create<TrainerPrefs>()(
  persist((set) => ({ recordTake: false, setRecordTake: (on) => set({ recordTake: on }) }), {
    name: 'thoremin-trainer-prefs',
  }),
);
