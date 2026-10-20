/**
 * The body on the DAG's edges (#186): the BlazePose 33-point landmark indices and bones, a
 * frame of body landmarks and its schema, the body models and status, and the synthetic
 * body geometry. Part of the domain types (`../domain.ts` re-exports it).
 */
import { z } from 'zod';
import type { LoadStatus } from '@thoremin/lazy';
import { FrameTimingSchema, type FrameTiming } from './frame_timing';
import { KeypointSchema, type Keypoint } from './hands';

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
export interface BodyFrame extends FrameTiming {
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
  ...FrameTimingSchema,
});

/** What a body source emits when nobody is in frame (never `undefined`). */
export const EMPTY_BODY_FRAME: BodyFrame = {
  width: 640,
  height: 480,
  present: false,
  landmarks: [],
  visibility: [],
};

/** The two live-capable PoseLandmarker variants (`heavy` is ~30 MB and ~5 fps in a
 *  browser, so it is not offered). The one definition the dial schema, the store
 *  snapshot and the `webcam-body` node all read. */
export const BODY_MODELS = ['lite', 'full'] as const;

export type BodyModel = (typeof BODY_MODELS)[number];

/** The body model's lifecycle on the `status` port: the shared lazy-loading
 *  vocabulary (#188, `packages/lazy/src/status.ts`) — `active` while a body is detected. */
export type BodyStatus = LoadStatus;

export const ABSENT_BODY_STATUS: BodyStatus = { phase: 'off', message: 'Body tracking off' };

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
  /** A step: the left foot moved this many torso lengths toward frame right and the
   *  right foot as far the other way (negative crosses them back). 0 when absent. */
  step?: number;
}

/**
 * Build a plausible upright 33-point skeleton facing the camera. Used by the
 * synthetic body source and by tests, so the body pipeline never needs a camera.
 * Geometry is in pixels (y down); `world` metres are derived by scaling the same
 * layout to a 0.5 m torso about the hip midpoint (hip-centred, z = 0), which is
 * what MediaPipe's world landmarks approximate for a frontal pose.
 */
export function makeBodyKeypoints(spec: SyntheticBodySpec): { landmarks: Keypoint[]; world: Keypoint[] } {
  const { width, height, cx, cy, torso, leftArm, rightArm, kneeBend, lean, step = 0 } = spec;
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
  // offset outward, feet rise), keeping the feet under the hips, each foot shifted
  // by half the step.
  const leg = (side: 1 | -1, hip: number, knee: number, ankle: number, heel: number, foot: number) => {
    const b = clamp(kneeBend);
    const h = pts[hip];
    const kx = h.x + side * b * 0.3 * torso;
    const ky = h.y + 0.75 * torso * (1 - 0.35 * b);
    const ax = h.x + side * 0.5 * step * torso;
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
