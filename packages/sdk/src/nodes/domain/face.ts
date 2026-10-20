/**
 * The face on the DAG's edges (#64, #76): the face mappings, a frame of blendshapes, the
 * head pose decoded from the facial transformation matrix, the face features and controls,
 * and the face status. Part of the domain types (`../domain.ts` re-exports it).
 */
import type { FrameTiming } from './frame_timing';

/**
 * What the player's face maps to (the face-mapping chooser, #64 + #76):
 *  - `none`     : no face detection or mapping (the model never loads).
 *  - `timbre`   : expression continuously shapes the active voices (smile→brightness,
 *                 open mouth→vibrato).
 *  - `chord`    : the classified *emotion* selects a diatonic triad on the current
 *                 seven-note scale.
 *  - `controls` : deliberate head/face *pose* axes play a chord instrument (#76) —
 *                 head-yaw→degree, head-pitch→octave, jaw-open→gate, smile→timbre,
 *                 brow→add-7th. The honest, controllable alternative to emotion mode.
 * Any non-`none` mode lazy-loads the `webcam-face` model — but the mapping is no longer
 * the ONLY thing that can want the model: the Feature Lab requests it too when it is
 * measuring face groups, so a player can observe their face features without the face
 * driving the sound (the face source is composed when the Lab shows a face group: `branchIdsFor`, #136).
 */
export const FACE_MAPPINGS = ['none', 'timbre', 'chord', 'controls'] as const;

export type FaceMapping = (typeof FACE_MAPPINGS)[number];

/** Map the legacy boolean `faceEnabled` (pre-#64) onto the tri-state mapping: a
 * saved `true` becomes `timbre` (the old behaviour), `false`/absent → `none`. The
 * single source of truth for this migration, shared by the store persist migrate,
 * the preset preprocess, and the store-controls snapshot fallback. */
export function legacyFaceToMapping(faceEnabled: boolean | undefined): FaceMapping {
  return faceEnabled ? 'timbre' : 'none';
}

// ---- Face (MediaPipe Face Landmarker blendshapes) ------------------------

/**
 * One frame of face data: the 52 MediaPipe blendshape scores (each 0..1),
 * keyed by name (e.g. `mouthSmileLeft`, `jawOpen`, `browInnerUp`). Produced by
 * the browser `webcam-face` node or by `scripts/video_to_face.py`.
 */
export interface FaceFrame extends FrameTiming {
  present: boolean;
  blendshapes: Record<string, number>;
  /** Normalized (x, y in 0..1) face mesh landmark points in the source frame, with
   *  MediaPipe's relative `z` (depth) preserved. All 478 points are forwarded (the
   *  irises are 468-477); the mesh overlay reads x/y, and the geometric feature
   *  catalog (#119) reads x/y/z + the irises. Optional — the blendshape-only
   *  expression nodes ignore it, and the offline blendshape fixture omits it. */
  landmarks?: { x: number; y: number; z?: number }[];
  /** Head orientation (degrees) decoded from MediaPipe's facial transformation
   *  matrix — present only when the live source enables that output (issue #76).
   *  The offline blendshape fixture has no matrix, so this is absent there. */
  headPose?: HeadPose;
}

// ---- Head pose (from the MediaPipe facial transformation matrix, #76) ------

/**
 * Head orientation in DEGREES, decoded from MediaPipe FaceLandmarker's facial
 * transformation matrix. Zero on every axis = facing the camera square-on. The
 * absolute sign of each axis depends on MediaPipe's camera convention and is
 * deliberately not asserted here — the downstream `face-controls` node maps each
 * to a normalized control with a per-axis gain that can be negative, so the felt
 * direction is tunable without touching this decode.
 */
export interface HeadPose {
  /** Left/right turn about the vertical axis (Y). */
  yaw: number;
  /** Up/down nod about the lateral axis (X). */
  pitch: number;
  /** Ear-to-shoulder tilt about the view axis (Z). */
  roll: number;
}

export const ZERO_HEAD_POSE: HeadPose = { yaw: 0, pitch: 0, roll: 0 };

const RAD2DEG = 180 / Math.PI;

const clampUnit = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * Decompose a MediaPipe FaceLandmarker facial transformation matrix into head
 * yaw/pitch/roll (degrees). `data` is the 16-element, COLUMN-MAJOR 4x4 rigid
 * transform (canonical face → detected face) FaceLandmarker returns when
 * `outputFacialTransformationMatrixes` is enabled; only the upper-left 3x3
 * rotation block is read (column-major: `M[row][col] = data[col*4 + row]`).
 *
 * The rotation is decomposed under the intrinsic Tait–Bryan **Y-X-Z** order
 * (yaw about Y, then pitch about X, then roll about Z — the natural order for a
 * head) using the standard closed form (identical to three.js `Euler` order
 * `'YXZ'`), with a gimbal-lock fold when pitch approaches ±90°.
 *
 * Pure and headlessly unit-testable: a matrix built from known (yaw, pitch,
 * roll) via the matching Y-X-Z composition round-trips back to those angles.
 * Returns {@link ZERO_HEAD_POSE} for a malformed (too-short) matrix so a caller
 * can never index out of range.
 */
export function matrixToHeadPose(data: number[] | Float32Array | undefined): HeadPose {
  if (!data || data.length < 11) return { ...ZERO_HEAD_POSE };
  // Column-major element access: m(row, col) = data[col * 4 + row].
  const m11 = data[0];
  const m21 = data[1];
  const m31 = data[2];
  const m22 = data[5];
  const m13 = data[8];
  const m23 = data[9];
  const m33 = data[10];
  const pitch = Math.asin(-clampUnit(m23));
  let yaw: number;
  let roll: number;
  if (Math.abs(m23) < 0.9999999) {
    yaw = Math.atan2(m13, m33);
    roll = Math.atan2(m21, m22);
  } else {
    // Gimbal lock (looking straight up/down): roll and yaw are degenerate; fold
    // the free rotation into yaw and zero the roll.
    yaw = Math.atan2(-m31, m11);
    roll = 0;
  }
  // Normalize signed zero (`asin(-0)` → `-0`) so a square-on face reads a clean 0.
  const deg = (rad: number): number => (rad === 0 ? 0 : rad * RAD2DEG);
  return { yaw: deg(yaw), pitch: deg(pitch), roll: deg(roll) };
}

/** Normalized expression controls derived from blendshapes, all 0..1. */
export interface FaceFeatures {
  present: boolean;
  /** Smile amount (mouth corners up). */
  smile: number;
  /** Jaw drop / open mouth. */
  mouthOpen: number;
  /** Eyebrows raised. */
  browRaise: number;
  /** Eyebrows furrowed/lowered. */
  browFurrow: number;
  /** Both eyes closed (blink). */
  eyeBlink: number;
}

export const ABSENT_FACE: FaceFeatures = {
  present: false,
  smile: 0,
  mouthOpen: 0,
  browRaise: 0,
  browFurrow: 0,
  eyeBlink: 0,
};

/**
 * Orthogonal, deliberately-controllable face/head axes (issue #76) — the
 * *control* surface that complements emotion classification for the `controls`
 * face mode. Each is chosen to be easy to produce on purpose AND reliably
 * detected. Head axes are bipolar (0 = neutral, facing the camera); mouth/brow/
 * pucker are unipolar; smile↔frown is bipolar. All clamped to their range.
 * Produced by the `face-controls` feature node from a {@link FaceFrame}.
 */
export interface FaceControls {
  present: boolean;
  /** Head turn left/right, -1..1 (from {@link HeadPose.yaw}). */
  headYaw: number;
  /** Head nod down/up, -1..1 (from {@link HeadPose.pitch}). */
  headPitch: number;
  /** Head tilt ear-to-shoulder, -1..1 (from {@link HeadPose.roll}). */
  headRoll: number;
  /** Jaw drop / open mouth, 0..1 (the most reliable blendshape channel). */
  mouthOpen: number;
  /** Smile (+) ↔ frown (-), -1..1 (bipolar mouth-corner geometry). */
  smileFrown: number;
  /** Both brows raised, 0..1. */
  browRaise: number;
  /** Lips puckered / funneled ("ooo"), 0..1 (a reliable discrete pose). */
  lipPucker: number;
}

export const ABSENT_FACE_CONTROLS: FaceControls = {
  present: false,
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  mouthOpen: 0,
  smileFrown: 0,
  browRaise: 0,
  lipPucker: 0,
};

/**
 * Lifecycle + detection status of the lazy `webcam-face` model, surfaced so the
 * UI can give the player feedback (issue #65): is the model loading, ready, or
 * did it fail to load, and is a face currently in frame.
 */
export type FaceStatusPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface FaceStatus {
  phase: FaceStatusPhase;
  /** A face is currently detected in frame (only meaningful while `ready`). */
  faceDetected: boolean;
}

export const ABSENT_FACE_STATUS: FaceStatus = { phase: 'idle', faceDetected: false };
