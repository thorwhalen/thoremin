/**
 * Scripted body POSES with every arm segment pointed independently (#383): the default pose names
 * are tested on takes of each vocabulary pose (arms up, hands together, a lean, a conductor's
 * ready, ...), which the graph's own synthetic skeleton (`makeBodyKeypoints`: straight arms swung
 * in the frontal plane) cannot all draw.
 *
 * The torso, head and legs are `makeBodyKeypoints`'s (its lean and knee bend); the arms are then
 * re-placed from a direction per segment in the torso's own frame (`out` away from the midline,
 * `up` along the torso, `fwd` the way it faces), in world metres, and projected back to the
 * image. `legs: false` hides the legs (visibility 0, as a seated player's under a desk): the
 * vector node's mask then drops every leg feature. Deterministic jitter, as the scripted body's.
 */
import { BLM, BODY_LANDMARK_COUNT, makeBodyKeypoints, type BodyFrame, type Keypoint } from '@thoremin/sdk/nodes/domain';
import { bodyFrameVector } from '@thoremin/sdk/features/modalities/body';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** A segment's direction in the torso frame (any length; normalised). */
export interface SegmentDir {
  out: number;
  up: number;
  fwd: number;
}

/** One arm: the upper arm's and the forearm's direction. */
export interface ArmPose {
  upper: SegmentDir;
  fore: SegmentDir;
}

export interface PoseSpec {
  left: ArmPose;
  right: ArmPose;
  /** Sideways lean of the torso, degrees, positive toward the PLAYER's left. */
  lean?: number;
  /** Knee bend 0 (straight) .. 1 (deep squat). */
  kneeBend?: number;
  /** Whether the legs are in view (false: a seated player's legs hidden). Default true. */
  legs?: boolean;
  /** Sitting on a chair, legs in view: thighs forward, shins down (knees at about 90 degrees). */
  seated?: boolean;
}

const d = (out: number, up: number, fwd: number): SegmentDir => ({ out, up, fwd });
const straight = (dir: SegmentDir): ArmPose => ({ upper: dir, fore: dir });

/** Arm building blocks. */
export const ARM = {
  down: straight(d(0.08, -1, 0)),
  up: straight(d(0.15, 1, 0)),
  out: straight(d(1, 0, 0)),
  /** Hands meeting in front of the chest: upper arm down and forward, forearm across. */
  together: { upper: d(0.1, -0.7, 0.45), fore: d(-0.95, 0.1, 0.35) },
  /** A conductor's ready: elbows low and out, forearms up in front. */
  ready: { upper: d(0.35, -0.75, 0.5), fore: d(0.1, 0.6, 0.8) },
  /** Held high and forward (a fermata): the whole arm raised in front. */
  raised: straight(d(0.2, 0.8, 0.55)),
  /** Swept out to the side at shoulder height, a little behind (the end of a cut-off). */
  swept: straight(d(1, -0.1, -0.15)),
  /** A conductor's ready with the forearms level, pointing ahead. */
  readyLevel: { upper: d(0.3, -0.85, 0.4), fore: d(0.1, 0.05, 1) },
  /** Held high, wide and forward (a broad fermata). */
  raisedWide: straight(d(0.7, 0.5, 0.5)),
  /** Pointing straight ahead at shoulder height (outside every vocabulary). */
  forward: straight(d(0.05, 0, 1)),
} as const satisfies Record<string, ArmPose>;

/** The vocabulary poses (and a few outside it), by the name a default should give them. */
export const POSES = {
  rest: { left: ARM.down, right: ARM.down },
  'arms up': { left: ARM.up, right: ARM.up },
  'left arm up': { left: ARM.up, right: ARM.down },
  'right arm up': { left: ARM.down, right: ARM.up },
  'arms out': { left: ARM.out, right: ARM.out },
  'hands together': { left: ARM.together, right: ARM.together },
  'lean left': { left: ARM.down, right: ARM.down, lean: 18 },
  'lean right': { left: ARM.down, right: ARM.down, lean: -18 },
  crouch: { left: ARM.down, right: ARM.down, kneeBend: 0.9 },
  ready: { left: ARM.ready, right: ARM.ready },
  fermata: { left: ARM.raised, right: ARM.raised },
  'cut-off': { left: ARM.swept, right: ARM.swept },
  /** The conductor's poses as other players hold them. */
  'ready (one hand)': { left: ARM.down, right: ARM.ready },
  'ready (level)': { left: ARM.readyLevel, right: ARM.readyLevel },
  'fermata (wide)': { left: ARM.raisedWide, right: ARM.raisedWide },
  /** A rest with a slight lean (still a rest), and a lean too small to name. */
  'rest (slight lean)': { left: ARM.down, right: ARM.down, lean: 3 },
  'small lean': { left: ARM.down, right: ARM.down, lean: 10 },
  /** Outside every vocabulary: both arms pointing at the camera. */
  'arms forward': { left: ARM.forward, right: ARM.forward },
  /** Outside every vocabulary: one arm up, the other out. */
  'up and out': { left: ARM.up, right: ARM.out },
} as const satisfies Record<string, PoseSpec>;

export type PoseName = keyof typeof POSES;

const FRAME = { width: 640, height: 480, cx: 0.5, cy: 0.55, torso: 110 } as const;
const LEN = { upper: 0.55, fore: 0.5 } as const;
const JITTER = 0.004;
const LEGS = [BLM.left_knee, BLM.right_knee, BLM.left_ankle, BLM.right_ankle, BLM.left_heel, BLM.right_heel, BLM.left_foot_index, BLM.right_foot_index];

function jitterOf(frame: number, key: number): number {
  let h = (frame * 73856093) ^ (key * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3, s = 1): V3 => ({ x: a.x + s * b.x, y: a.y + s * b.y, z: a.z + s * b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => {
  const n = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / n, y: a.y / n, z: a.z / n };
};
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const mid = (a: V3, b: V3): V3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

/** The body frame of a pose (`frame` seeds the jitter). */
export function poseFrame(spec: PoseSpec, frame = 0): BodyFrame {
  const F = FRAME;
  // makeBodyKeypoints leans toward frame RIGHT for a positive lean, where the subject's left
  // shoulder sits (MediaPipe names sides by the subject): the player's left.
  const { landmarks, world } = makeBodyKeypoints({ ...F, leftArm: 0, rightArm: 0, kneeBend: spec.kneeBend ?? 0, lean: ((spec.lean ?? 0) * Math.PI) / 180 });
  const w: V3[] = world.map((q) => ({ x: q.x, y: q.y, z: q.z ?? 0 }));
  const k = 0.5 / F.torso;
  const hx = F.cx * F.width;
  const hy = F.cy * F.height;
  // The torso frame, as the catalog builds it (world set).
  const up = norm(sub(mid(w[BLM.left_shoulder], w[BLM.right_shoulder]), mid(w[BLM.left_hip], w[BLM.right_hip])));
  const across = add(sub(w[BLM.left_shoulder], w[BLM.right_shoulder]), sub(w[BLM.left_hip], w[BLM.right_hip]));
  const left = norm(add(across, up, -dot(across, up)));
  const fwd = cross(left, up);
  const toWorld = (s: SegmentDir, side: 1 | -1): V3 => norm(add(add({ x: 0, y: 0, z: 0 }, left, side * s.out), add({ x: up.x * s.up, y: up.y * s.up, z: up.z * s.up }, fwd, s.fwd)));
  const torsoM = 0.5;
  const arm = (pose: ArmPose, side: 1 | -1, sh: number, el: number, wr: number, hand: readonly number[]) => {
    const e = add(w[sh], toWorld(pose.upper, side), LEN.upper * torsoM);
    const fd = toWorld(pose.fore, side);
    const wrist = add(e, fd, LEN.fore * torsoM);
    w[el] = e;
    w[wr] = wrist;
    hand.forEach((i, n) => (w[i] = add(wrist, fd, 0.04 + 0.01 * n)));
  };
  if (spec.seated) {
    const leg = (hip: number, knee: number, ankle: number, heel: number, foot: number) => {
      const k = add(w[hip], fwd, 0.75 * torsoM);
      const a = add(k, up, -0.72 * torsoM);
      w[knee] = k;
      w[ankle] = a;
      w[heel] = add(a, fwd, -0.04);
      w[foot] = add(a, fwd, 0.1);
    };
    leg(BLM.left_hip, BLM.left_knee, BLM.left_ankle, BLM.left_heel, BLM.left_foot_index);
    leg(BLM.right_hip, BLM.right_knee, BLM.right_ankle, BLM.right_heel, BLM.right_foot_index);
  }
  arm(spec.left, 1, BLM.left_shoulder, BLM.left_elbow, BLM.left_wrist, [BLM.left_pinky, BLM.left_index, BLM.left_thumb]);
  arm(spec.right, -1, BLM.right_shoulder, BLM.right_elbow, BLM.right_wrist, [BLM.right_pinky, BLM.right_index, BLM.right_thumb]);
  const j = JITTER;
  const img: Keypoint[] = landmarks.map((_, i) => ({ x: hx + w[i].x / k + j * F.torso * jitterOf(frame, i * 3), y: hy + w[i].y / k + j * F.torso * jitterOf(frame, i * 3 + 1) }));
  const wj: Keypoint[] = w.map((q, i) => ({ x: q.x + j * 0.5 * jitterOf(frame, i * 3), y: q.y + j * 0.5 * jitterOf(frame, i * 3 + 1), z: q.z + j * 0.5 * jitterOf(frame, i * 3 + 2) }));
  const visibility = new Array(BODY_LANDMARK_COUNT).fill(1);
  if (spec.legs === false) for (const i of LEGS) visibility[i] = 0;
  return { width: F.width, height: F.height, present: true, landmarks: img, world: wj, visibility };
}

/** The merged vector's `body.*` keys of a pose (`frame` seeds the jitter). */
export function poseVector(spec: PoseSpec, frame = 0): FeatureVector {
  return bodyFrameVector(poseFrame(spec, frame));
}
