/**
 * The body as a carve modality (#382 = #385 E9): "Your poses", the personal categorizer tool on
 * the player's held body POSES (#387 B8: static poses only; a wave or a clap is a different
 * classifier). The same take, carve, sorting, live test, file and command bindings as faces and
 * hand shapes; what is body-specific is here, in one object.
 *
 * - **The space** is B1's (`../body_groups.ts`): joint angles, segment directions in the torso's
 *   own frame, body-relative positions and shape ratios, nothing that says where the player
 *   stands. Claiming its groups composes the body branch (feature demand), so the pose model runs
 *   only while a pose tool reads it.
 * - **In view** is a share of the categorizer's TRAINED features ({@link BODY_POSE_MIN_COVERAGE}
 *   of them): the vector node drops what the visibility mask hides, and a reading that has lost
 *   most of what the categories were taught on "cannot see you" instead of guessing.
 * - **Nuisances** are demonstrated after the rest (design §4.3): closer and further, a step to
 *   each side, a slight turn. What still moves meanwhile is down-weighted.
 * - **The mirror** (#387 B10: off by default, chosen per categorizer) is a canonical side: with
 *   it on, `project` turns every vector into the one of {itself, its mirror image} whose left side
 *   is the more raised and outward (`mirrorAsymmetry`), so "left arm up" and "right arm up" are
 *   the same vector everywhere after the read: the take, the carve, the live test, the bindings.
 * - **The picture** is a stick figure drawn from the segment directions ({@link poseSkeleton}),
 *   kept per sample in the file (#387 C7: a stick figure by default, camera stills opt-in).
 * - **No general model** yet: default names by context (#387 B9) are B3 (#383); until then a
 *   category is `pose n`.
 */
import type { CarveModality, ModalityOptions, ModalityWords, NuisanceCueSpec, Skeleton } from '../../enroll/modality';
import type { FeatureVector } from '../../enroll/types';
import { BODY_FEATURES } from '../body_catalog';
import { BODY_POSE_FEATURE_IDS, BODY_POSE_GROUPS, BODY_POSE_MIN_COVERAGE, bodyPoseCollects } from '../body_groups';
import { BODY_MIRROR, mirrorBodyVector } from '../body_mirror';
import { buildBodyCtx } from '../catalog';
import type { BodyFrame } from '../../nodes/domain';
import { bodyWords } from './body_words';

const POSE = new Set(BODY_POSE_FEATURE_IDS);
const keep = (key: string): boolean => POSE.has(key);

const BODY_WORDS: ModalityWords = {
  one: 'pose',
  many: 'poses',
  part: 'body',
  slug: 'poses',
  category: 'pose',
  neutral: 'neutral',
  fallback: (i) => `pose ${i + 1}`,
  rest: 'Stand (or sit) facing the camera, relaxed, arms at your sides, and keep still.',
};

/** The nuisances a pose take demonstrates, in order (design §4.3). Each lasts long enough for a
 *  slow movement there and back. */
export const BODY_NUISANCE_CUES: readonly NuisanceCueSpec[] = [
  {
    key: 'distance',
    name: 'Closer and further',
    instruction: 'Keep the rest pose and walk a little closer to the camera, then back.',
    rationale: 'Shows what changes with distance alone, so it never decides a pose.',
    axes: ['scale'],
    ms: 4000,
  },
  {
    key: 'aside',
    name: 'A step aside',
    instruction: 'Keep the rest pose and take a step to one side, then to the other, and back.',
    rationale: 'Where you stand in the picture is not a pose.',
    axes: ['position'],
    ms: 4000,
  },
  {
    key: 'turn',
    name: 'A slight turn',
    instruction: 'Keep the rest pose and turn a little to one side, then the other, and face the camera again.',
    rationale: 'A small turn should not change which pose you are in.',
    axes: ['yaw'],
    ms: 4000,
  },
];

/** The weight a feature's left-minus-right difference has in {@link mirrorAsymmetry}: degrees
 *  are taken per 90, torso lengths as they are, so neither unit outvotes the other. */
const ASYMMETRY_UNIT = (id: string): number => (id.startsWith('body.dir.') || id.startsWith('body.angle.') ? 90 : 1);

/** The pose space's left features with their right twins (`BODY_MIRROR`'s side swaps). */
const SIDE_PAIRS: readonly (readonly [string, string])[] = BODY_POSE_FEATURE_IDS.filter((id) => id.split('.').includes('left'))
  .map((id) => [id, BODY_MIRROR[id]?.to] as const)
  .filter((p): p is readonly [string, string] => typeof p[1] === 'string' && p[1] !== p[0] && POSE.has(p[1]));

/**
 * How much more raised and outward the player's LEFT side is than the right (positive) or less
 * (negative), over the paired features both sides have. The mirror image has the opposite sign,
 * so it decides which of the two is the canonical one. Exactly symmetric: 0.
 */
export function mirrorAsymmetry(vector: FeatureVector): number {
  let a = 0;
  for (const [l, r] of SIDE_PAIRS) {
    const x = vector[l];
    const y = vector[r];
    if (Number.isFinite(x) && Number.isFinite(y)) a += (x - y) / ASYMMETRY_UNIT(l);
  }
  return a;
}

/** The vector or its mirror image, whichever has the left side the more raised (idempotent: a
 *  canonical vector is its own canonical form). */
export function canonicalPose(vector: FeatureVector): FeatureVector {
  return mirrorAsymmetry(vector) < 0 ? mirrorBodyVector(vector) : vector;
}

function project(merged: FeatureVector, options?: ModalityOptions): FeatureVector {
  return options?.mirror ? canonicalPose(merged) : merged;
}

/** The stick figure's proportions, in torso lengths (the synthetic body's, close to an adult's). */
export const POSE_FIGURE = {
  shoulderHalf: 0.42,
  hipHalf: 0.3,
  neck: 0.25,
  head: 0.22,
  upperArm: 0.55,
  forearm: 0.5,
  thigh: 0.75,
  shank: 0.72,
  /** Decimal places a stored point keeps. */
  decimals: 3,
} as const;

const SIDE_SIGN = { left: -1, right: 1 } as const;

/**
 * The stick figure of a pose vector, from its segment directions in the torso frame: each segment
 * drawn as its projection on the torso's frontal plane (`out` sideways, `up` up; a limb pointing
 * at the camera is drawn short, as a photograph would show it). The torso is upright by
 * construction (the directions are measured in its frame). A limb whose directions are missing
 * (out of view) is left out; null when no limb can be drawn.
 */
export function poseSkeleton(vector: FeatureVector, figure: typeof POSE_FIGURE = POSE_FIGURE): Skeleton | null {
  const round = (x: number) => Number(x.toFixed(figure.decimals));
  const out: Record<string, readonly [number, number]> = {};
  const put = (name: string, x: number, y: number) => {
    out[name] = [round(x), round(y)];
  };
  put('hip', 0, 0);
  put('neck', 0, 1);
  put('head', 0, 1 + figure.neck + figure.head);
  const deg = (x: number) => (x * Math.PI) / 180;
  /** The segment's frontal-plane direction, or null when either elevation is missing. */
  const dir = (seg: string, side: 'left' | 'right'): [number, number] | null => {
    const o = vector[`body.dir.${seg}.${side}.out`];
    const u = vector[`body.dir.${seg}.${side}.up`];
    if (!Number.isFinite(o) || !Number.isFinite(u)) return null;
    return [SIDE_SIGN[side] * Math.sin(deg(o)), Math.sin(deg(u))];
  };
  let limbs = 0;
  for (const side of ['left', 'right'] as const) {
    const s = SIDE_SIGN[side];
    const shoulder: [number, number] = [s * figure.shoulderHalf, 1];
    const hip: [number, number] = [s * figure.hipHalf, 0];
    put(`shoulder.${side}`, ...shoulder);
    put(`hip.${side}`, ...hip);
    const chain = (root: [number, number], segs: readonly (readonly [string, number, string])[]) => {
      let at = root;
      for (const [seg, len, joint] of segs) {
        const d = dir(seg, side);
        if (!d) return;
        at = [at[0] + len * d[0], at[1] + len * d[1]];
        put(`${joint}.${side}`, ...at);
        limbs += 1;
      }
    };
    chain(shoulder, [
      ['upperArm', figure.upperArm, 'elbow'],
      ['forearm', figure.forearm, 'wrist'],
    ]);
    chain(hip, [
      ['thigh', figure.thigh, 'knee'],
      ['shank', figure.shank, 'ankle'],
    ]);
  }
  return limbs > 0 ? out : null;
}

/** The figure's lines, joint names in order (a renderer draws each as a polyline). */
export const POSE_FIGURE_LINES: readonly (readonly string[])[] = [
  ['shoulder.left', 'shoulder.right'],
  ['hip.left', 'hip.right'],
  ['neck', 'hip'],
  ['neck', 'head'],
  ['shoulder.left', 'elbow.left', 'wrist.left'],
  ['shoulder.right', 'elbow.right', 'wrist.right'],
  ['hip.left', 'knee.left', 'ankle.left'],
  ['hip.right', 'knee.right', 'ankle.right'],
];

export const bodyModality: CarveModality = {
  id: 'body',
  words: BODY_WORDS,
  groups: BODY_POSE_GROUPS,
  collects: () => bodyPoseCollects(),
  project,
  /** The pose keys, or null when none is finite (no body in view). */
  read(vector: FeatureVector, options?: ModalityOptions): FeatureVector | null {
    const p = project(vector, options);
    let seen = false;
    const out: FeatureVector = {};
    for (const [k, x] of Object.entries(p)) {
      if (!keep(k)) continue;
      out[k] = x;
      if (Number.isFinite(x)) seen = true;
    }
    return seen ? out : null;
  },
  keep,
  // Torso-normalised and torso-framed already: no distance proxy to learn.
  nuisance: {},
  describe: bodyWords,
  minCoverage: BODY_POSE_MIN_COVERAGE,
  nuisanceCues: BODY_NUISANCE_CUES,
  skeleton: (vector) => poseSkeleton(vector),
};

/** Options for {@link bodyFrameVector}: as the live `body-feature-vector` node reads a frame. */
export interface BodyFrameVectorOptions {
  /** Mirror x (the selfie view). Default true, as the node. */
  mirrorX?: boolean;
  /** The visibility mask. Default 0.5, as the node. */
  minVisibility?: number;
}

/**
 * The merged vector's body keys for one still frame (every body feature that needs no history), as
 * the live vector carries them: what a scripted body is pushed through the pose categorizer as.
 * Kinematics and effort need a history and come out NaN, which a pose never reads.
 */
export function bodyFrameVector(frame: BodyFrame, options: BodyFrameVectorOptions = {}): FeatureVector {
  const ctx = buildBodyCtx(frame, { mirrorX: options.mirrorX ?? true, dtS: Number.NaN, history: [], minVisibility: options.minVisibility ?? 0.5 });
  const out: FeatureVector = {};
  for (const f of BODY_FEATURES) {
    const v = f.compute(ctx);
    if (Number.isFinite(v)) out[f.id] = v;
  }
  return out;
}
