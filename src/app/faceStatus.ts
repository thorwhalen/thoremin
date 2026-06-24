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
import { type ExpressionLabel } from '@/music/expression';

export interface FaceStatusState {
  status: FaceStatus;
  /** Latest classified expression label (null when no face / model not ready). The
   *  per-emotion activations/thresholds live on the DAG `expression` output and are
   *  drawn by the overlay readout directly — this store only carries the label for
   *  the text status line. */
  label: ExpressionLabel | null;
  report(status: FaceStatus, label: ExpressionLabel | null): void;
  reset(): void;
}

export const useFaceStatus = create<FaceStatusState>((set) => ({
  status: ABSENT_FACE_STATUS,
  label: null,
  report: (status, label) => set({ status, label }),
  reset: () => set({ status: ABSENT_FACE_STATUS, label: null }),
}));
