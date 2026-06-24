/**
 * faceStatus — a tiny store the engine writes the live face-model status and
 * classified expression into each frame (throttled), so the UI can show the
 * player feedback: is the model loading / ready / failed, is a face detected,
 * and what expression is currently read (issue #65). Kept separate from the
 * persisted controls store since it is ephemeral, per-frame runtime state — the
 * DAG produces it; React only displays it.
 */
import { create } from 'zustand';
import { ABSENT_FACE_STATUS, type FaceStatus } from '@/nodes';
import { EXPRESSIONS, type ExpressionLabel } from '@/music/expression';

const EMPTY_PROBS: number[] = EXPRESSIONS.map(() => 0);

export interface FaceStatusState {
  status: FaceStatus;
  /** Latest classified expression label (null when no face / model not ready). */
  label: ExpressionLabel | null;
  /** Softmax over {@link EXPRESSIONS} (for the live readout bars). */
  probs: number[];
  report(status: FaceStatus, label: ExpressionLabel | null, probs: number[]): void;
  reset(): void;
}

export const useFaceStatus = create<FaceStatusState>((set) => ({
  status: ABSENT_FACE_STATUS,
  label: null,
  probs: EMPTY_PROBS,
  report: (status, label, probs) => set({ status, label, probs }),
  reset: () => set({ status: ABSENT_FACE_STATUS, label: null, probs: EMPTY_PROBS }),
}));
