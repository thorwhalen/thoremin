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
import { kp, LM, type Hand, type HandsFrame, type FaceFrame } from '@/nodes/domain';
import { dist3, type Vec3 } from './math';
import { iod as iodOf, type FaceLandmarks } from './landmarks';
import { FACE_FEATURES } from './face_catalog';
import { HAND_PAIR_FEATURES, HAND_SIDE_FEATURES } from './hand_catalog';
import type { Controllability, FaceCtx, FeatureSource, HandCtx } from './types';

export type { Controllability, FaceCtx, HandCtx, TwoHandCtx, FeatureDef, FeatureSource, FeatureVector } from './types';
export { FACE_FEATURES } from './face_catalog';
export { HAND_SIDE_FEATURES, HAND_PAIR_FEATURES } from './hand_catalog';

/** The two hands, in display order. */
export const HAND_SIDES = ['left', 'right'] as const;
export type HandSide = (typeof HAND_SIDES)[number];

/** A resolved, fully-qualified feature entry (the flat registry the lab renders). */
export interface FlatFeature {
  id: string;
  group: string;
  source: FeatureSource;
  range?: readonly [number, number];
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

/** All feature groups, in display order (face groups then hand groups). */
export const FEATURE_GROUPS: readonly FeatureGroupInfo[] = [
  ...FACE_GROUPS.map(([id, label]): FeatureGroupInfo => ({ id, label, source: 'face' })),
  ...HAND_GROUPS.map(([id, label]): FeatureGroupInfo => ({ id, label, source: 'hand' })),
];

/** Group ids, in display order. */
export const FEATURE_GROUP_IDS: readonly string[] = FEATURE_GROUPS.map((g) => g.id);

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
];

/** The full flat registry: face ids as-authored, hand side features expanded per
 *  hand into `hand.{side}.{id}`, pair features keyed `hand.{id}`. Display order. */
export const ALL_FEATURES: readonly FlatFeature[] = buildAllFeatures();

function buildAllFeatures(): FlatFeature[] {
  const out: FlatFeature[] = [];
  for (const f of FACE_FEATURES) {
    out.push({ id: f.id, group: f.group, source: f.source, range: f.range, controllability: f.controllability, description: f.description });
  }
  for (const side of HAND_SIDES) {
    for (const f of HAND_SIDE_FEATURES) {
      out.push({ id: `hand.${side}.${f.id}`, group: f.group, source: f.source, range: f.range, controllability: f.controllability, description: f.description });
    }
  }
  for (const f of HAND_PAIR_FEATURES) {
    out.push({ id: `hand.${f.id}`, group: f.group, source: f.source, range: f.range, controllability: f.controllability, description: f.description });
  }
  return out;
}

/** Fast lookup: feature id → its flat entry. */
export const FEATURE_BY_ID: Readonly<Record<string, FlatFeature>> = Object.fromEntries(
  ALL_FEATURES.map((f) => [f.id, f]),
);

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

/** Resolve a raw hand's displayed side, applying the selfie handedness swap (the
 *  mirrored webcam reports the opposite hand), mirroring `hand-features`. */
export function resolveSide(handedness: 'Left' | 'Right', mirrorHandedness: boolean): HandSide {
  const swapped = mirrorHandedness ? (handedness === 'Left' ? 'Right' : 'Left') : handedness;
  return swapped === 'Right' ? 'right' : 'left';
}
