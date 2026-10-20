/**
 * faceStatus — a tiny store the engine writes the live face-model status and
 * classified expression into each frame (throttled), so the UI can show the
 * player feedback: is the model loading / ready / failed, is a face detected,
 * and what expression is currently read (issue #65). Kept separate from the
 * persisted controls store since it is ephemeral, per-frame runtime state — the
 * DAG produces it; React only displays it.
 *
 * {@link makeFaceReporter} is the per-frame sink the host loop (`useEngine.ts`) registers to
 * write it.
 */
import { create } from 'zustand';
import { ABSENT_FACE_STATUS, type FaceStatus } from '@thoremin/sdk/nodes/domain';
import { readingName, type ExpressionLabel, type ExpressionScores } from '@/music/expression';
import { useToasts } from '../shell/toasts';
import type { OutputReader } from '@thoremin/sdk-ui/types';

export interface FaceStatusState {
  status: FaceStatus;
  /** Latest classified expression label (null when no face / model not ready). The
   *  per-emotion activations/thresholds live on the DAG `expression` output and are
   *  drawn by the overlay readout directly — this store only carries the label for
   *  the text status line. A personal categorizer's category name when one plays (#330 P4). */
  label: ExpressionLabel | string | null;
  /** Latest per-emotion activation scores (EMOTIONS-aligned, 0..1), or null when no
   *  face. Used by the calibration wizard as its live meter (throttled with `label`). */
  scores: number[] | null;
  report(status: FaceStatus, label: ExpressionLabel | string | null, scores: number[] | null): void;
  reset(): void;
}

export const useFaceStatus = create<FaceStatusState>((set) => ({
  status: ABSENT_FACE_STATUS,
  label: null,
  scores: null,
  report: (status, label, scores) => set({ status, label, scores }),
  reset: () => set({ status: ABSENT_FACE_STATUS, label: null, scores: null }),
}));

/** Min interval (ms) between face-status reports while a face is being read (throttle the readout). */
const FACE_REPORT_MS = 100;

/** How long (ms) the "face model failed" toast stays up. */
const FACE_ERROR_TOAST_MS = 6000;

/** The node and port ids the face reporter reads (the face branch in `graph.ts`). */
const FACE_NODES = { status: 'camFace', expression: 'faceExpr', played: 'exprChord' } as const;

/**
 * Build the per-frame sink that bridges the face model's status and classified expression from
 * the DAG back to React for the indicator and readout (#65), throttled so the bars don't
 * re-render 60×/s. A transition into `error` surfaces a toast once. Pure over the reader (the
 * `makeLoadStatusReporter` shape), so it is testable with a stub engine.
 *
 * @param now - the frame time in MILLISECONDS (the host converts the clock's seconds).
 */
export function makeFaceReporter(
  engine: OutputReader,
  store: Pick<FaceStatusState, 'report'> = useFaceStatus.getState(),
  toast: (message: string) => void = (message) => useToasts.getState().push(message, FACE_ERROR_TOAST_MS, 'error'),
): (now: number) => void {
  let lastFaceReport = 0;
  let lastPhase: FaceStatus['phase'] | null = null;
  let lastDetected = false;
  return (now) => {
    const fs = engine.getOutput(FACE_NODES.status, 'status') as FaceStatus | undefined;
    if (!fs) return;
    const phaseChanged = fs.phase !== lastPhase;
    const detectedChanged = fs.faceDetected !== lastDetected;
    // The 10/s cadence is only needed while a face is being read (for the
    // live label); when idle/loading/error we report only on transitions, so
    // an off/idle face control doesn't re-render the UI every 100ms.
    const live = fs.phase === 'ready' && fs.faceDetected;
    if (!phaseChanged && !detectedChanged && (!live || now - lastFaceReport < FACE_REPORT_MS)) {
      return;
    }
    if (fs.phase === 'error' && lastPhase !== null && lastPhase !== 'error') {
      toast('Face model failed to load — check your connection and re-pick a face mode');
    }
    const expr = engine.getOutput(FACE_NODES.expression, 'expression') as ExpressionScores | undefined;
    const detected = fs.phase === 'ready' && fs.faceDetected && expr?.present;
    // The label is what the chord PLAYED: the name of the category its categorizer read
    // (the general model's is an expression or `neutral`; #330 P4, P6); the scores stay
    // the general model's (the calibration wizard meters them per emotion).
    const played = engine.getOutput(FACE_NODES.played, 'played') as ExpressionScores | undefined;
    const label = played ? readingName(played) : expr?.label;
    store.report(fs, detected ? (label ?? null) : null, detected ? expr!.scores : null);
    lastFaceReport = now;
    lastPhase = fs.phase;
    lastDetected = fs.faceDetected;
  };
}
