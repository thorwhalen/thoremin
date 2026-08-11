/**
 * gestureStatus — a tiny store the engine writes the classifier's live per-hand
 * poses into (transition-gated: only when a pose CHANGES), so the Gestures panel
 * can show which pose each hand is currently holding without re-rendering at
 * frame rate. Ephemeral per-frame runtime state, exactly like `faceStatus` /
 * `midiStatus` — the DAG produces it; React only displays it. The dispatch
 * itself does NOT go through this store (it runs in the rAF loop, see
 * `gestureDispatch.ts`); this is display only.
 */
import { create } from 'zustand';
import type { Pose } from '@/nodes';

/** The classifier's per-hand pose snapshot (the `poses` output port shape). */
export type HandPoses = Record<'left' | 'right', Pose>;

/** The snapshot before the engine has reported anything (or after teardown). */
export const ABSENT_POSES: HandPoses = { left: 'absent', right: 'absent' };

export interface GestureStatusState {
  poses: HandPoses;
  report(poses: HandPoses): void;
  reset(): void;
}

export const useGestureStatus = create<GestureStatusState>((set) => ({
  poses: ABSENT_POSES,
  report: (poses) => set({ poses: { ...poses } }),
  reset: () => set({ poses: ABSENT_POSES }),
}));
