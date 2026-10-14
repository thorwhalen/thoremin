/**
 * The scripted body (#382 = #385 E9): "Your poses" with no camera and no pose model, as the scripted
 * hand is for "Your hand shapes" (`./synthetic_hand.ts`). A player stands at rest, demonstrates the
 * three nuisances the take asks for (closer and further, a step aside, a slight turn), then holds
 * four poses with the rest between them: both arms up, the left arm out, the right arm out, a
 * crouch.
 *
 * The frame is a `BodyFrame` built by the graph's own synthetic skeleton (`makeBodyKeypoints`),
 * with world landmarks (so the segment directions read a turn as the live world set does), turned
 * about the vertical axis for the turn; `bodyFrameVector` turns it into the merged vector's
 * `body.*` keys, the path the live `body-feature-vector` node takes. Deterministic: the jitter is
 * a hash of (frame, landmark).
 */
import { BODY_LANDMARK_COUNT, makeBodyKeypoints, type BodyFrame, type Keypoint } from '@thoremin/sdk/nodes/domain';
import { bodyFrameVector } from '@thoremin/sdk/features/modalities/body';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** One scripted pose: each arm's raise (0 hanging, 0.5 straight out, 1 straight up) and the knee
 *  bend (0 straight, 1 a deep squat). */
export interface SyntheticPose {
  name: string;
  color: string;
  leftArm: number;
  rightArm: number;
  kneeBend: number;
}

export const SYNTHETIC_POSES: readonly SyntheticPose[] = [
  { name: 'rest', color: '#334155', leftArm: 0.04, rightArm: 0.04, kneeBend: 0 },
  { name: 'arms up', color: '#16a34a', leftArm: 0.95, rightArm: 0.95, kneeBend: 0 },
  { name: 'left arm out', color: '#b91c1c', leftArm: 0.5, rightArm: 0.04, kneeBend: 0 },
  { name: 'right arm out', color: '#ca8a04', leftArm: 0.04, rightArm: 0.5, kneeBend: 0 },
  { name: 'crouch', color: '#0891b2', leftArm: 0.2, rightArm: 0.2, kneeBend: 0.9 },
];

export const SYNTHETIC_BODY_TIMELINE = {
  /** The opening rest. */
  restMs: 3500,
  /** Each nuisance the take asks for (the body modality's `nuisanceCues` last as long). */
  nuisanceMs: 4000,
  /** Each held pose (a pose, or the rest between two). */
  holdMs: 1300,
  /** The glide from one pose to the next. */
  glideMs: 250,
  /** Frame-to-frame jitter of each landmark, in torso lengths. */
  jitter: 0.004,
  /** How far the player walks toward the camera (torso grows by this share at the nearest). */
  closer: 0.3,
  /** How far a step aside takes the hips, as a share of the frame's width. */
  aside: 0.15,
  /** The largest turn, radians. */
  turn: 0.2,
} as const;

/** The scripted body's frame: its size, the hips' place in it (0..1) and the torso (pixels). */
export const SYNTHETIC_BODY_FRAME = { width: 640, height: 480, cx: 0.5, cy: 0.55, torso: 110 } as const;

/** The poses after the nuisances, in turn: each pose, then the rest. */
const CYCLE: readonly number[] = [1, 0, 2, 0, 3, 0, 4, 0];
const NUISANCES = ['distance', 'aside', 'turn'] as const;

/** Where the script is at `ms`: a nuisance (`which`, with `u` 0..1 through it), or a pose
 *  (moving `to` from `from`, `mix` through the glide). */
export type SyntheticBodyPhase =
  | { kind: 'pose'; from: number; to: number; mix: number }
  | { kind: 'nuisance'; which: (typeof NUISANCES)[number]; u: number };

export function syntheticBodyPhase(ms: number): SyntheticBodyPhase {
  const { restMs, nuisanceMs, holdMs, glideMs } = SYNTHETIC_BODY_TIMELINE;
  if (ms < restMs) return { kind: 'pose', from: 0, to: 0, mix: 1 };
  const n = Math.floor((ms - restMs) / nuisanceMs);
  if (n < NUISANCES.length) return { kind: 'nuisance', which: NUISANCES[n], u: (ms - restMs - n * nuisanceMs) / nuisanceMs };
  const t = ms - restMs - NUISANCES.length * nuisanceMs;
  const span = holdMs + glideMs;
  const step = Math.floor(t / span);
  const into = t - step * span;
  return { kind: 'pose', from: step === 0 ? 0 : CYCLE[(step - 1) % CYCLE.length], to: CYCLE[step % CYCLE.length], mix: Math.min(1, into / glideMs) };
}

/** What the scripted body shows at `ms`: a pose's name, or the nuisance under way. */
export function syntheticBodyAt(ms: number): { name: string; color: string } {
  const p = syntheticBodyPhase(ms);
  if (p.kind === 'nuisance') return { name: p.which === 'distance' ? 'closer' : p.which === 'aside' ? 'step aside' : 'turn', color: '#475569' };
  return SYNTHETIC_POSES[p.mix >= 0.5 ? p.to : p.from];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A deterministic jitter in [-1, 1] for (frame, key). */
function jitterOf(frame: number, key: number): number {
  let h = (frame * 73856093) ^ (key * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/** The scripted body's frame at `ms` (`frame` seeds the jitter). */
export function syntheticBodyFrame(ms: number, frame = 0): BodyFrame {
  const T = SYNTHETIC_BODY_TIMELINE;
  const F = SYNTHETIC_BODY_FRAME;
  const p = syntheticBodyPhase(ms);
  const rest = SYNTHETIC_POSES[0];
  let pose = rest;
  let torso: number = F.torso;
  let cx: number = F.cx;
  let yaw = 0;
  if (p.kind === 'pose') {
    const a = SYNTHETIC_POSES[p.from];
    const b = SYNTHETIC_POSES[p.to];
    pose = { ...b, leftArm: lerp(a.leftArm, b.leftArm, p.mix), rightArm: lerp(a.rightArm, b.rightArm, p.mix), kneeBend: lerp(a.kneeBend, b.kneeBend, p.mix) };
  } else {
    // There and back (and, for the step and the turn, to each side): one smooth cycle.
    const wave = Math.sin(2 * Math.PI * p.u);
    if (p.which === 'distance') torso = F.torso * (1 + T.closer * (0.5 - 0.5 * Math.cos(2 * Math.PI * p.u)));
    if (p.which === 'aside') cx = F.cx + T.aside * wave;
    if (p.which === 'turn') yaw = T.turn * wave;
  }
  const { landmarks, world } = makeBodyKeypoints({ width: F.width, height: F.height, cx, cy: F.cy, torso, leftArm: pose.leftArm, rightArm: pose.rightArm, kneeBend: pose.kneeBend, lean: 0 });
  const hx = cx * F.width;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const j = T.jitter;
  const img: Keypoint[] = landmarks.map((q, i) => ({ x: hx + (q.x - hx) * c + j * torso * jitterOf(frame, i * 3), y: q.y + j * torso * jitterOf(frame, i * 3 + 1) }));
  const w: Keypoint[] = world.map((q, i) => {
    const z = q.z ?? 0;
    return { x: q.x * c - z * s + j * 0.5 * jitterOf(frame, i * 3), y: q.y + j * 0.5 * jitterOf(frame, i * 3 + 1), z: q.x * s + z * c + j * 0.5 * jitterOf(frame, i * 3 + 2) };
  });
  return { width: F.width, height: F.height, present: true, landmarks: img, world: w, visibility: new Array(BODY_LANDMARK_COUNT).fill(1) };
}

/** The merged vector's `body.*` keys at `ms`. */
export function syntheticBodyVector(ms: number, frame = 0): FeatureVector {
  return bodyFrameVector(syntheticBodyFrame(ms, frame));
}
