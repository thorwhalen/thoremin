/**
 * Domain types flowing on the DAG's edges, plus helpers to synthesize hand
 * landmark geometry (used by the synthetic source and by tests, so we never
 * need a camera to exercise the feature/mapping/synthesis stages).
 *
 * Landmark indices follow MediaPipe Hands (21 points). We also tolerate named
 * keypoints (as emitted by @tensorflow-models/hand-pose-detection).
 */
import { z } from 'zod';
import type { SoundId } from '@/music/sounds';

export interface Keypoint {
  x: number;
  y: number;
  z?: number;
  /** MediaPipe/TFJS keypoint name, e.g. 'index_finger_tip'. Optional. */
  name?: string;
}

export type Handedness = 'Left' | 'Right';

export interface Hand {
  handedness: Handedness;
  /** 21 keypoints in pixel coordinates of the source frame. */
  keypoints: Keypoint[];
  /**
   * 21 keypoints in MediaPipe *world* coordinates (metres, origin at the hand's
   * geometric centre). Roughly camera-pose-invariant, so distances between them are
   * scale- AND rotation-robust — the basis for the invariant finger→thumb features.
   * Optional: absent for the synthetic source / older detectors (2D fallback then).
   */
  worldKeypoints?: Keypoint[];
  score?: number;
}

/** One frame of detected hands, carrying the source frame dimensions. */
export interface HandsFrame {
  width: number;
  height: number;
  hands: Hand[];
}

/**
 * Runtime shape of a {@link HandsFrame}, for `PortSpec.schema` on the source
 * slot's output port (#104). The interfaces above stay the SSOT for the TYPE;
 * this mirrors them for the values, which is the half a compiler cannot check —
 * a generator or replay source that emits a malformed frame, or nothing at all,
 * would otherwise surface far downstream as a wrong note rather than an error.
 * `KeypointSchema` is `.passthrough()` so a detector that carries extra fields
 * is not rejected for being richer than we modelled.
 */
export const KeypointSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    z: z.number().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export const HandSchema = z.object({
  handedness: z.enum(['Left', 'Right']),
  keypoints: z.array(KeypointSchema),
  worldKeypoints: z.array(KeypointSchema).optional(),
  score: z.number().optional(),
});

export const HandsFrameSchema = z.object({
  width: z.number(),
  height: z.number(),
  hands: z.array(HandSchema),
});

/** The four non-thumb fingers, in radial order. */
export const FINGER_NAMES = ['index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];

/** Per-finger thumb closeness, 0 = far from thumb, 1 = touching the thumb.
 *  Rotation/scale-invariant (palm-span-normalized world-landmark distances). */
export type FingerCloseness = Record<FingerName, number>;

/** Per-hand features derived from landmarks, all normalized to [0, 1]. */
export interface SingleHandFeatures {
  present: boolean;
  /** Index-fingertip horizontal position, 0 = left edge, 1 = right edge. */
  x: number;
  /** Index-fingertip vertical position, 0 = top, 1 = bottom. */
  y: number;
  /** Wrist horizontal position, 0 = left, 1 = right (the wrist-tracking source). */
  wristX: number;
  /** Wrist vertical position, 0 = top, 1 = bottom. */
  wristY: number;
  /** Hand openness: 0 = closed fist, 1 = fully spread. */
  openness: number;
  /** Thumb-to-index pinch: 0 = wide apart, 1 = touching. A similar but separately
   *  normalized measure to `fingers.index` (2D, hand-scale reference, its own
   *  thresholds); kept distinct for back-compat with the legacy pinch→vibrato knob. */
  pinch: number;
  /** Per-finger thumb closeness (rotation/scale-invariant), the basis of the
   *  configurable finger→effect routing. */
  fingers: FingerCloseness;
}

export interface HandFeatures {
  left: SingleHandFeatures;
  right: SingleHandFeatures;
}

export const ABSENT_HAND: SingleHandFeatures = {
  present: false,
  x: 0,
  y: 0,
  wristX: 0,
  wristY: 0,
  openness: 0,
  pinch: 0,
  fingers: { index: 0, middle: 0, ring: 0, pinky: 0 },
};

/** Synthesis parameters for one voice. */
export interface VoiceParams {
  /** Stable voice id (0 = right, 1 = left, by convention). */
  id: number;
  present: boolean;
  freq: number;
  gain: number;
  /** Instrument timbre — an id from the {@link SoundId} registry. */
  sound: SoundId;
  /**
   * Live tone brightness, 0 (dark/mellow) .. 1 (open/present). Drives a
   * per-voice low-pass in the synth so gestures (e.g. hand openness) shape
   * timbre expressively. Optional; absent is treated as 1 (fully open).
   */
  brightness?: number;
  /**
   * Live vibrato amount, 0 (none) .. 1 (full). Adds pitch wobble on top of any
   * preset vibrato, so gestures (e.g. pinch) add expression. Optional; absent
   * is treated as 0 (no added vibrato).
   */
  vibrato?: number;
  /**
   * Stereo pan, -1 (hard left) .. +1 (hard right). Lets hand position place the
   * voice in the stereo field. Optional; absent is treated as 0 (centre).
   */
  pan?: number;
}

export interface SynthParams {
  voices: VoiceParams[];
}

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
 * driving the sound (see `faceActive` in webcam_face.ts, #136).
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
export interface FaceFrame {
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

// ---- MediaPipe Hands landmark indices ------------------------------------

export const LM = {
  wrist: 0,
  thumb_cmc: 1,
  thumb_mcp: 2,
  thumb_ip: 3,
  thumb_tip: 4,
  index_mcp: 5,
  index_pip: 6,
  index_dip: 7,
  index_tip: 8,
  middle_mcp: 9,
  middle_pip: 10,
  middle_dip: 11,
  middle_tip: 12,
  ring_mcp: 13,
  ring_pip: 14,
  ring_dip: 15,
  ring_tip: 16,
  pinky_mcp: 17,
  pinky_pip: 18,
  pinky_dip: 19,
  pinky_tip: 20,
} as const;

const NAME_TO_INDEX: Record<string, number> = {
  wrist: 0,
  thumb_tip: 4,
  index_finger_mcp: 5,
  index_finger_tip: 8,
  middle_finger_mcp: 9,
  middle_finger_tip: 12,
  ring_finger_tip: 16,
  pinky_finger_tip: 20,
};

/**
 * Fetch a keypoint by MediaPipe index, falling back to matching by `name` when
 * keypoints are named but possibly reordered.
 */
export function kp(hand: Hand, index: number): Keypoint | undefined {
  const byIndex = hand.keypoints[index];
  if (byIndex) return byIndex;
  // Fallback: find the name that maps to this index.
  const name = Object.keys(NAME_TO_INDEX).find((n) => NAME_TO_INDEX[n] === index);
  if (name) return hand.keypoints.find((k) => k.name === name);
  return undefined;
}

export function dist2d(a: Keypoint, b: Keypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Euclidean distance including z when present (else 2D). Meaningful on *world*
 *  (metric) keypoints, where z is a real depth and the distance is view-invariant. */
export function dist3d(a: Keypoint, b: Keypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

// ---- Synthetic hand geometry ---------------------------------------------

export interface SyntheticHandSpec {
  /** Hand center x in pixels. */
  cx: number;
  /** Hand center y in pixels. */
  cy: number;
  /** Overall hand size in pixels (wrist-to-middle-MCP scales with this). */
  scale: number;
  /** 0 = closed fist (tips near palm), 1 = fully open (tips extended). */
  spread: number;
  /** 0 = thumb & index apart, 1 = pinched together. */
  pinch: number;
  handedness: Handedness;
}

/**
 * Build a plausible 21-point hand pointing "up" (toward smaller y), so the
 * feature extractor produces controlled, monotonic features. Used by the
 * synthetic source and tests.
 *
 * Layout: wrist at (cx, cy), palm/MCP knuckles one `scale` above the wrist,
 * fingertips a further `scale * (0.4 + 0.9*spread)` above the knuckles. The
 * thumb sits to the side and swings toward the index tip as `pinch` -> 1.
 */
export function makeHandKeypoints(spec: SyntheticHandSpec): Keypoint[] {
  const { cx, cy, scale, spread, pinch } = spec;
  const pts: Keypoint[] = new Array(21);
  const set = (i: number, x: number, y: number) => {
    pts[i] = { x, y };
  };

  const knuckleY = cy - scale; // one hand-length up
  const tipReach = scale * (0.4 + 0.9 * Math.max(0, Math.min(1, spread)));
  // Four fingers (index, middle, ring, pinky) fan out horizontally.
  const fingerX = [-0.45, -0.15, 0.15, 0.45].map((f) => cx + f * scale);

  set(LM.wrist, cx, cy);

  // index / middle / ring / pinky: mcp, pip, dip, tip
  const fingerMcp = [LM.index_mcp, LM.middle_mcp, LM.ring_mcp, LM.pinky_mcp];
  const fingerTip = [LM.index_tip, LM.middle_tip, LM.ring_tip, LM.pinky_tip];
  const fingerPip = [LM.index_pip, LM.middle_pip, LM.ring_pip, LM.pinky_pip];
  const fingerDip = [LM.index_dip, LM.middle_dip, LM.ring_dip, LM.pinky_dip];
  for (let f = 0; f < 4; f++) {
    const fx = fingerX[f];
    set(fingerMcp[f], fx, knuckleY);
    set(fingerPip[f], fx, knuckleY - tipReach * 0.45);
    set(fingerDip[f], fx, knuckleY - tipReach * 0.75);
    set(fingerTip[f], fx, knuckleY - tipReach);
  }

  // Thumb: starts out to the (left) side; swings toward the index tip on pinch.
  const indexTip = pts[LM.index_tip];
  const thumbBaseX = cx - 0.7 * scale;
  const thumbBaseY = cy - 0.3 * scale;
  set(LM.thumb_cmc, cx - 0.5 * scale, cy - 0.1 * scale);
  set(LM.thumb_mcp, thumbBaseX, thumbBaseY);
  // ip and tip interpolate from the "open" thumb position toward the index tip.
  const openThumbTip = { x: cx - 0.9 * scale, y: cy - scale * 0.8 };
  const tipX = openThumbTip.x + pinch * (indexTip.x - openThumbTip.x);
  const tipY = openThumbTip.y + pinch * (indexTip.y - openThumbTip.y);
  set(LM.thumb_ip, (thumbBaseX + tipX) / 2, (thumbBaseY + tipY) / 2);
  set(LM.thumb_tip, tipX, tipY);

  return pts;
}

// ---- Body (full-body pose, #186) ---------------------------------------------

/**
 * MediaPipe PoseLandmarker landmark indices (the BlazePose 33-point topology).
 * `BLM` mirrors {@link LM} for hands: the SSOT for "which index is the left
 * wrist" shared by the live `webcam-body` source, the synthetic skeleton, the
 * overlay skeleton and the body feature catalog. Order is MediaPipe's, verbatim.
 */
export const BLM = {
  nose: 0,
  left_eye_inner: 1,
  left_eye: 2,
  left_eye_outer: 3,
  right_eye_inner: 4,
  right_eye: 5,
  right_eye_outer: 6,
  left_ear: 7,
  right_ear: 8,
  mouth_left: 9,
  mouth_right: 10,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_pinky: 17,
  right_pinky: 18,
  left_index: 19,
  right_index: 20,
  left_thumb: 21,
  right_thumb: 22,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32,
} as const;
export type BodyLandmarkName = keyof typeof BLM;

/** The 33 landmark names in index order (the offline pose script emits these). */
export const BODY_LANDMARK_NAMES = Object.keys(BLM) as BodyLandmarkName[];

export const BODY_LANDMARK_COUNT = 33;

/**
 * The skeleton's bones as landmark-index pairs (MediaPipe's `POSE_CONNECTIONS`
 * minus the face triangle), for the overlay and for limb-length features.
 */
export const BODY_BONES: ReadonlyArray<readonly [number, number]> = [
  [BLM.left_shoulder, BLM.right_shoulder],
  [BLM.left_shoulder, BLM.left_elbow],
  [BLM.left_elbow, BLM.left_wrist],
  [BLM.right_shoulder, BLM.right_elbow],
  [BLM.right_elbow, BLM.right_wrist],
  [BLM.left_shoulder, BLM.left_hip],
  [BLM.right_shoulder, BLM.right_hip],
  [BLM.left_hip, BLM.right_hip],
  [BLM.left_hip, BLM.left_knee],
  [BLM.left_knee, BLM.left_ankle],
  [BLM.right_hip, BLM.right_knee],
  [BLM.right_knee, BLM.right_ankle],
  [BLM.left_ankle, BLM.left_heel],
  [BLM.left_heel, BLM.left_foot_index],
  [BLM.right_ankle, BLM.right_heel],
  [BLM.right_heel, BLM.right_foot_index],
  [BLM.left_wrist, BLM.left_index],
  [BLM.right_wrist, BLM.right_index],
  [BLM.nose, BLM.left_eye],
  [BLM.nose, BLM.right_eye],
  [BLM.left_eye, BLM.left_ear],
  [BLM.right_eye, BLM.right_ear],
];

/**
 * One frame of full-body pose (#186). Produced by the browser `webcam-body`
 * source, the camera-free `synthetic-body`, or a `replay-body` of a recorded
 * stream (`scripts/video_to_pose.py`). `landmarks` are the 33 BlazePose points in
 * PIXEL coordinates of the source frame (like a hand's `keypoints`); `world` is
 * MediaPipe's metric, hip-centred set (metres) when the detector supplies it —
 * the basis for scale-free angles and velocities; `visibility` is the per-point
 * likelihood the landmark is in frame and unoccluded (0..1).
 */
export interface BodyFrame {
  width: number;
  height: number;
  present: boolean;
  /** 33 landmarks in pixel coordinates (empty when `present` is false). */
  landmarks: Keypoint[];
  /** 33 landmarks in metres, hip-midpoint origin. Optional (synthetic/older sources). */
  world?: Keypoint[];
  /** Per-landmark visibility 0..1, aligned with `landmarks`. */
  visibility: number[];
}

/** Runtime shape of a {@link BodyFrame}, for the body slot's output port schema. */
export const BodyFrameSchema = z.object({
  width: z.number(),
  height: z.number(),
  present: z.boolean(),
  landmarks: z.array(KeypointSchema),
  world: z.array(KeypointSchema).optional(),
  visibility: z.array(z.number()),
});

/** What a body source emits when nobody is in frame (never `undefined`). */
export const EMPTY_BODY_FRAME: BodyFrame = {
  width: 640,
  height: 480,
  present: false,
  landmarks: [],
  visibility: [],
};

/** Lifecycle + detection status of the live body model (mirrors {@link FaceStatus}). */
export interface BodyStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  bodyDetected: boolean;
}
export const ABSENT_BODY_STATUS: BodyStatus = { phase: 'idle', bodyDetected: false };

/** Fetch a body landmark by index (undefined when absent / out of range). */
export function blm(frame: BodyFrame, index: number): Keypoint | undefined {
  return frame.landmarks[index];
}

export interface SyntheticBodySpec {
  /** Frame size in pixels. */
  width: number;
  height: number;
  /** Hip-midpoint position, normalized 0..1 of the frame. */
  cx: number;
  cy: number;
  /** Torso length (shoulder-mid to hip-mid) in pixels; every other length scales from it. */
  torso: number;
  /** Arm raise 0 (hanging) .. 1 (straight up), per side. */
  leftArm: number;
  rightArm: number;
  /** Knee bend 0 (straight) .. 1 (deep squat), symmetric. */
  kneeBend: number;
  /** Lateral lean of the torso in radians (positive = towards frame right). */
  lean: number;
}

/**
 * Build a plausible upright 33-point skeleton facing the camera. Used by the
 * synthetic body source and by tests, so the body pipeline never needs a camera.
 * Geometry is in pixels (y down); `world` metres are derived by scaling the same
 * layout to a 0.5 m torso about the hip midpoint (hip-centred, z = 0), which is
 * what MediaPipe's world landmarks approximate for a frontal pose.
 */
export function makeBodyKeypoints(spec: SyntheticBodySpec): { landmarks: Keypoint[]; world: Keypoint[] } {
  const { width, height, cx, cy, torso, leftArm, rightArm, kneeBend, lean } = spec;
  const hx = cx * width;
  const hy = cy * height;
  const pts: Keypoint[] = new Array(BODY_LANDMARK_COUNT);
  const set = (i: number, x: number, y: number) => {
    pts[i] = { x, y };
  };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // Torso: hips at (hx, hy); shoulders one torso length up, leaned by `lean`.
  const sx = hx + Math.sin(lean) * torso;
  const sy = hy - Math.cos(lean) * torso;
  const shoulderHalf = 0.42 * torso;
  const hipHalf = 0.3 * torso;
  // Displayed-left of the image is the subject's RIGHT side; MediaPipe names
  // sides by the subject, so right_* sits at smaller x when facing the camera.
  set(BLM.left_shoulder, sx + shoulderHalf, sy);
  set(BLM.right_shoulder, sx - shoulderHalf, sy);
  set(BLM.left_hip, hx + hipHalf, hy);
  set(BLM.right_hip, hx - hipHalf, hy);
  // Head above the shoulder midpoint.
  const headR = 0.22 * torso;
  const nx = sx;
  const ny = sy - 0.55 * torso;
  set(BLM.nose, nx, ny);
  set(BLM.left_eye_inner, nx + 0.25 * headR, ny - 0.3 * headR);
  set(BLM.left_eye, nx + 0.4 * headR, ny - 0.3 * headR);
  set(BLM.left_eye_outer, nx + 0.55 * headR, ny - 0.3 * headR);
  set(BLM.right_eye_inner, nx - 0.25 * headR, ny - 0.3 * headR);
  set(BLM.right_eye, nx - 0.4 * headR, ny - 0.3 * headR);
  set(BLM.right_eye_outer, nx - 0.55 * headR, ny - 0.3 * headR);
  set(BLM.left_ear, nx + headR, ny - 0.1 * headR);
  set(BLM.right_ear, nx - headR, ny - 0.1 * headR);
  set(BLM.mouth_left, nx + 0.3 * headR, ny + 0.4 * headR);
  set(BLM.mouth_right, nx - 0.3 * headR, ny + 0.4 * headR);
  // Arms: upper + forearm each 0.55 torso; `raise` swings the whole arm from
  // hanging (angle 0, pointing down) to straight up (angle pi), outward of the body.
  const arm = (side: 1 | -1, raise: number, shoulder: number, elbow: number, wrist: number, pinky: number, index: number, thumb: number) => {
    const a = clamp(raise) * Math.PI; // 0 = down, pi = up
    const dx = side * Math.sin(a) * 0.55 * torso;
    const dy = Math.cos(a) * 0.55 * torso;
    const s = pts[shoulder];
    const e = { x: s.x + dx, y: s.y + dy };
    const w = { x: e.x + dx, y: e.y + dy };
    set(elbow, e.x, e.y);
    set(wrist, w.x, w.y);
    const hd = 0.12 * torso;
    set(pinky, w.x + side * hd, w.y + dy * 0.2);
    set(index, w.x + side * 0.6 * hd, w.y + dy * 0.25);
    set(thumb, w.x - side * 0.4 * hd, w.y + dy * 0.15);
  };
  arm(1, leftArm, BLM.left_shoulder, BLM.left_elbow, BLM.left_wrist, BLM.left_pinky, BLM.left_index, BLM.left_thumb);
  arm(-1, rightArm, BLM.right_shoulder, BLM.right_elbow, BLM.right_wrist, BLM.right_pinky, BLM.right_index, BLM.right_thumb);
  // Legs: thigh + shin each 0.75 torso; a knee bend folds them (knee forward = +x
  // offset outward, feet rise), keeping the feet under the hips.
  const leg = (side: 1 | -1, hip: number, knee: number, ankle: number, heel: number, foot: number) => {
    const b = clamp(kneeBend);
    const h = pts[hip];
    const kx = h.x + side * b * 0.3 * torso;
    const ky = h.y + 0.75 * torso * (1 - 0.35 * b);
    const ax = h.x;
    const ay = ky + 0.75 * torso * (1 - 0.35 * b);
    set(knee, kx, ky);
    set(ankle, ax, ay);
    set(heel, ax - side * 0.05 * torso, ay + 0.08 * torso);
    set(foot, ax + side * 0.18 * torso, ay + 0.1 * torso);
  };
  leg(1, BLM.left_hip, BLM.left_knee, BLM.left_ankle, BLM.left_heel, BLM.left_foot_index);
  leg(-1, BLM.right_hip, BLM.right_knee, BLM.right_ankle, BLM.right_heel, BLM.right_foot_index);
  // World: the same layout in metres about the hip midpoint (0.5 m torso), y up
  // flipped to MediaPipe's y-down convention is NOT applied — MediaPipe world
  // coordinates keep y increasing downward like the image, so only translate + scale.
  const k = 0.5 / torso;
  const world: Keypoint[] = pts.map((q) => ({ x: (q.x - hx) * k, y: (q.y - hy) * k, z: 0 }));
  return { landmarks: pts, world };
}
