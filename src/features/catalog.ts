/**
 * The feature catalog facade — the single import surface for the whole lab.
 *
 * Assembles the face catalog and the (side-relative) hand catalog into a flat,
 * ordered registry of every scalar feature id + its group, and provides the
 * context builders that turn a raw {@link FaceFrame} / {@link Hand} into the pure
 * per-source context each feature's `compute` consumes. This is where the
 * "affordances first, data-driven" rule lands: adding a feature is appending a
 * `FeatureDef` in the sub-catalogs; nothing here changes.
 */
import { kp, LM, BLM, type BodyFrame, type Hand, type HandsFrame, type FaceFrame } from '@/nodes/domain';
import { dist3, type Vec3 } from './math';
import { iod as iodOf, type FaceLandmarks } from './landmarks';
import { FACE_FEATURES } from './face_catalog';
import { HAND_PAIR_FEATURES, HAND_SIDE_FEATURES } from './hand_catalog';
import { BODY_FEATURES } from './body_catalog';
import type { BodyCtx, BodyHistorySample, Controllability, FaceCtx, FeatureSource, HandCtx, Invariance } from './types';

export type { BodyCtx, BodyHistorySample, Controllability, FaceCtx, HandCtx, TwoHandCtx, FeatureDef, FeatureSource, FeatureVector } from './types';
export { FACE_FEATURES } from './face_catalog';
export { HAND_SIDE_FEATURES, HAND_PAIR_FEATURES } from './hand_catalog';
export { BODY_FEATURES } from './body_catalog';

/** The two hands, in display order. */
export const HAND_SIDES = ['left', 'right'] as const;
export type HandSide = (typeof HAND_SIDES)[number];

/** A resolved, fully-qualified feature entry (the flat registry the lab renders). */
export interface FlatFeature {
  id: string;
  group: string;
  source: FeatureSource;
  range?: readonly [number, number];
  /** Angular feature on a circle (see FeatureDef.circular): the normalizer maps it
   *  against its declared range verbatim instead of an adaptive envelope. */
  circular?: boolean;
  /** Declared confound profile (see FeatureDef.invariantTo): absent = unassessed,
   *  [] = invariant to nothing listed. */
  invariantTo?: readonly Invariance[];
  controllability?: Controllability;
  description?: string;
}

/** Ordered group metadata: id → human label, in display order, per source. */
export interface FeatureGroupInfo {
  id: string;
  label: string;
  source: FeatureSource;
}

const FACE_GROUPS: [string, string][] = [
  ['face.blendshape.jaw', 'Jaw (blendshape)'],
  ['face.blendshape.mouth', 'Mouth (blendshape)'],
  ['face.blendshape.brow', 'Brow (blendshape)'],
  ['face.blendshape.eye', 'Eye (blendshape)'],
  ['face.blendshape.gaze', 'Gaze (blendshape)'],
  ['face.blendshape.cheek', 'Cheek (blendshape)'],
  ['face.blendshape.nose', 'Nose (blendshape)'],
  ['face.geom.eye', 'Eye geometry'],
  ['face.geom.mouth', 'Mouth geometry'],
  ['face.geom.brow', 'Brow geometry'],
  ['face.geom.nose', 'Nose geometry'],
  ['face.geom.cheek', 'Cheek geometry'],
  ['face.geom.jaw', 'Jaw geometry'],
  ['face.gaze', 'Gaze (mesh)'],
  ['face.head', 'Head pose'],
  ['face.symmetry', 'Symmetry'],
  ['face.au', 'Action units'],
];

const HAND_GROUPS: [string, string][] = [
  ['hand.position.raw', 'Raw positions'],
  ['hand.finger.flexion', 'Finger flexion'],
  ['hand.finger.spread', 'Finger spread'],
  ['hand.palm.orientation', 'Palm orientation'],
  ['hand.whole', 'Whole hand'],
  ['hand.distances.pinch', 'Distances'],
  ['hand.twohand.relational', 'Two-hand'],
];

/** The body groups (#186): angles, positions, kinematics, shape, Laban effort, relations. */
const BODY_GROUPS: [string, string][] = [
  ['body.angle', 'Joint angles'],
  ['body.pos', 'Body positions'],
  ['body.kin', 'Body kinematics'],
  ['body.shape', 'Body shape'],
  ['body.effort', 'Laban effort'],
  ['body.rel', 'Body relations'],
];

/** The group id for user-defined derived (formula) features. */
export const DERIVED_GROUP = 'derived';

/** All feature groups, in display order (face, hand, body groups, then derived). */
export const FEATURE_GROUPS: readonly FeatureGroupInfo[] = [
  ...FACE_GROUPS.map(([id, label]): FeatureGroupInfo => ({ id, label, source: 'face' })),
  ...HAND_GROUPS.map(([id, label]): FeatureGroupInfo => ({ id, label, source: 'hand' })),
  ...BODY_GROUPS.map(([id, label]): FeatureGroupInfo => ({ id, label, source: 'body' })),
  { id: DERIVED_GROUP, label: 'Derived (formula)', source: 'face' },
];

/** Turn a dotted feature id into a formula-safe variable name (dots → underscores),
 *  so `face.geom.mouth.openness` is referenceable as `face_geom_mouth_openness`
 *  without tripping the formula compiler's member-access rejection. */
export function safeName(id: string): string {
  return id.replace(/\./g, '_');
}

/** Group ids, in display order. */
export const FEATURE_GROUP_IDS: readonly string[] = FEATURE_GROUPS.map((g) => g.id);

/**
 * A one-line human summary of a group's declared confound profile (#131), for
 * the Lab's group-picker tooltips: what the group's features are invariant to,
 * and — the actionable half — what will contaminate them. Derived from the
 * per-feature `invariantTo` labels; undefined when the group has no assessed
 * features (no claim is better than a made-up one).
 */
export function groupInvarianceSummary(groupId: string): string | undefined {
  const assessed = ALL_FEATURES.filter((f) => f.group === groupId && f.invariantTo !== undefined);
  if (!assessed.length) return undefined;
  const axes: Invariance[] = ['scale', 'position', 'yaw', 'pitch', 'roll'];
  const shared = axes.filter((a) => assessed.every((f) => f.invariantTo!.includes(a)));
  const contaminating = axes.filter((a) => !shared.includes(a));
  const inv = shared.length ? `invariant to ${shared.join(', ')}` : 'invariant to none of the confound axes';
  // "not invariant ACROSS the group", not "contaminated by": in a mixed group an
  // axis outside the shared set may still be fine for individual members.
  const bad = contaminating.length
    ? ` — not invariant across the group to: ${contaminating.join(', ')} (correct with residual(x, z) in a formula)`
    : ' — fully confound-invariant as labeled';
  const partial = assessed.length < ALL_FEATURES.filter((f) => f.group === groupId).length ? ' (some features unassessed)' : '';
  return `${inv}${bad}${partial}`;
}

/** A sensible default set of DISPLAYED/computed groups: high-signal, readable
 *  channels, so the lab opens with a useful (not overwhelming) grid. The raw
 *  blendshape families, raw hand positions, and two-hand groups are opt-in. */
export const DEFAULT_LAB_GROUPS: readonly string[] = [
  'face.geom.eye',
  'face.geom.mouth',
  'face.geom.brow',
  'face.head',
  'face.au',
  'hand.finger.flexion',
  'hand.finger.spread',
  'hand.whole',
  DERIVED_GROUP,
];

/** The full flat registry: face ids as-authored, hand side features expanded per
 *  hand into `hand.{side}.{id}`, pair features keyed `hand.{id}`. Display order. */
export const ALL_FEATURES: readonly FlatFeature[] = buildAllFeatures();

function buildAllFeatures(): FlatFeature[] {
  const out: FlatFeature[] = [];
  for (const f of FACE_FEATURES) {
    out.push({ id: f.id, group: f.group, source: f.source, range: f.range, circular: f.circular, invariantTo: f.invariantTo, controllability: f.controllability, description: f.description });
  }
  for (const side of HAND_SIDES) {
    for (const f of HAND_SIDE_FEATURES) {
      out.push({ id: `hand.${side}.${f.id}`, group: f.group, source: f.source, range: f.range, circular: f.circular, invariantTo: f.invariantTo, controllability: f.controllability, description: f.description });
    }
  }
  for (const f of HAND_PAIR_FEATURES) {
    out.push({ id: `hand.${f.id}`, group: f.group, source: f.source, range: f.range, circular: f.circular, invariantTo: f.invariantTo, controllability: f.controllability, description: f.description });
  }
  for (const f of BODY_FEATURES) {
    out.push({ id: f.id, group: f.group, source: f.source, range: f.range, circular: f.circular, invariantTo: f.invariantTo, controllability: f.controllability, description: f.description });
  }
  return out;
}

/** Fast lookup: feature id → its flat entry. */
export const FEATURE_BY_ID: Readonly<Record<string, FlatFeature>> = Object.fromEntries(
  ALL_FEATURES.map((f) => [f.id, f]),
);

/** The formula-safe variable names of every catalog feature — the allowed
 *  identifier set for derived-feature formulas (typo protection). */
export const ALL_SAFE_NAMES: ReadonlySet<string> = new Set(ALL_FEATURES.map((f) => safeName(f.id)));

// ---- Context builders ------------------------------------------------------

/** Build the pure face context the face catalog consumes from a raw FaceFrame. */
export function buildFaceCtx(frame: FaceFrame | undefined): FaceCtx {
  const present = !!frame?.present;
  const blendshapes = frame?.blendshapes ?? {};
  const landmarks = frame?.landmarks as FaceLandmarks | undefined;
  const hasLandmarks = !!(landmarks && landmarks.length > 0);
  return {
    present,
    bs: (name: string) => blendshapes[name] ?? 0,
    landmarks,
    hasLandmarks,
    headPose: frame?.headPose,
    iod: hasLandmarks ? iodOf(landmarks) : NaN,
  };
}

/** Options for {@link buildHandCtx}: the selfie mirror + the resolved side label. */
export interface HandCtxOptions {
  mirrorX: boolean;
  side: HandSide;
}

/** Build a single-hand context from a raw {@link Hand} + its source frame. Uses
 *  world landmarks (metric, pose-invariant) when present, else image keypoints. */
export function buildHandCtx(hand: Hand, frame: HandsFrame, opts: HandCtxOptions): HandCtx {
  const world = hand.worldKeypoints;
  const useWorld = !!(world && world.length >= 21);
  const P = (i: number): Vec3 | undefined => kp(hand, i);
  const W = (i: number): Vec3 | undefined => world?.[i];
  const spanA = useWorld ? W(LM.index_mcp) : P(LM.index_mcp);
  const spanB = useWorld ? W(LM.pinky_mcp) : P(LM.pinky_mcp);
  const palmSpan = spanA && spanB ? dist3(spanA, spanB) : NaN;
  return {
    present: true,
    side: opts.side,
    P,
    W,
    useWorld,
    palmSpan,
    mirrorX: opts.mirrorX,
    width: frame.width,
    height: frame.height,
  };
}

/** Options for {@link buildBodyCtx}: the selfie mirror, the seconds since the previous
 *  sample, and the window of previous samples (oldest first). */
export interface BodyCtxOptions {
  mirrorX: boolean;
  dtS: number;
  history: readonly BodyHistorySample[];
}

/** The torso length (shoulder-mid to hip-mid) of a body frame in the given point set. */
function torsoLength(get: (i: number) => Vec3 | undefined): number {
  const ls = get(BLM.left_shoulder);
  const rs = get(BLM.right_shoulder);
  const lh = get(BLM.left_hip);
  const rh = get(BLM.right_hip);
  if (!ls || !rs || !lh || !rh) return NaN;
  const s = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: ((ls.z ?? 0) + (rs.z ?? 0)) / 2 };
  const h = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: ((lh.z ?? 0) + (rh.z ?? 0)) / 2 };
  const d = dist3(s, h);
  return d > 1e-9 ? d : NaN;
}

/** Build the body context the body catalog consumes from a raw {@link BodyFrame}. Uses
 *  world landmarks (metric, hip-centred) when present, else image landmarks. */
export function buildBodyCtx(frame: BodyFrame, opts: BodyCtxOptions): BodyCtx {
  const world = frame.world;
  const useWorld = !!(world && world.length >= 33);
  const P = (i: number): Vec3 | undefined => frame.landmarks[i];
  const W = (i: number): Vec3 | undefined => world?.[i];
  const vis = (i: number): number => frame.visibility[i] ?? 1;
  return {
    present: frame.present,
    P,
    W,
    useWorld,
    torso: torsoLength(useWorld ? W : P),
    torsoImg: torsoLength(P),
    vis,
    mirrorX: opts.mirrorX,
    width: frame.width,
    height: frame.height,
    dtS: opts.dtS,
    history: opts.history,
  };
}

/** Resolve a raw hand's displayed side, applying the selfie handedness swap (the
 *  mirrored webcam reports the opposite hand), mirroring `hand-features`. */
export function resolveSide(handedness: 'Left' | 'Right', mirrorHandedness: boolean): HandSide {
  const swapped = mirrorHandedness ? (handedness === 'Left' ? 'Right' : 'Left') : handedness;
  return swapped === 'Right' ? 'right' : 'left';
}
