/**
 * The chord-shape featurizer: one fretting hand → one flat feature vector.
 *
 * It is deliberately NOT a new featurizer. The hand catalog (`src/features/hand_catalog.ts`)
 * already computes per-finger joint angles and curls, adjacent-finger spreads, thumb
 * opposition, pinch distances and openness from the world landmarks, and declares what
 * each is invariant to (#131). A guitar chord shape is exactly a configuration of those
 * quantities, so the model eats the same `FeatureVector` the Lab, the trainer and the
 * gesture dispatcher eat, and the trained classifier can later run in the app as one
 * more consumer of the `hand-feature-vector` node with no second implementation to drift.
 *
 * Feature selection is by DECLARED INVARIANCE, not by hand-picked ids: the default takes
 * every hand feature the catalog declares invariant to scale, position, yaw, pitch and
 * roll (flexion, spread, pinch, openness), so a model trained on a front-facing tutorial
 * has a chance on an over-the-shoulder clip. `withOrientation` adds the palm-orientation
 * group (invariant to scale and position only) for a camera-locked variant.
 *
 * Ids are SIDE-RELATIVE (`index.curl`, not `hand.left.index.curl`): a chord shape is the
 * same shape on either hand, and the fretting hand is the left one for most players.
 */
import { buildHandCtx, HAND_SIDE_FEATURES, type FeatureVector } from '@/features/catalog';
import type { Hand, HandsFrame } from '@/nodes/domain';
import type { FrettingHandPick } from './lib_sources';

const SHAPE_INVARIANCES = ['scale', 'position', 'yaw', 'pitch', 'roll'] as const;
const CAMERA_LOCKED_INVARIANCES = ['scale', 'position'] as const;

export interface FeatureSelection {
  /** Include the palm-orientation group (camera-locked variant). Default false. */
  withOrientation?: boolean;
}

/** The ordered feature ids the chord model uses, chosen by declared invariance. */
export function chordShapeFeatureIds(sel: FeatureSelection = {}): string[] {
  const need = sel.withOrientation ? CAMERA_LOCKED_INVARIANCES : SHAPE_INVARIANCES;
  return HAND_SIDE_FEATURES.filter((f) => {
    const inv = f.invariantTo;
    return inv !== undefined && need.every((axis) => inv.includes(axis));
  }).map((f) => f.id);
}

/**
 * Featurize one hand. Every selected id is present; a feature the catalog cannot
 * compute this frame is `NaN` (the model's standardizer imputes it), never dropped, so
 * vectors stay fixed-dimensional.
 */
export function chordShapeVector(hand: Hand, frame: HandsFrame, sel: FeatureSelection = {}): FeatureVector {
  const ids = new Set(chordShapeFeatureIds(sel));
  const ctx = buildHandCtx(hand, frame, { mirrorX: false, side: 'left' });
  const out: FeatureVector = {};
  for (const f of HAND_SIDE_FEATURES) {
    if (!ids.has(f.id)) continue;
    const v = f.compute(ctx);
    out[f.id] = Number.isFinite(v) ? v : NaN;
  }
  return out;
}

/** Mean image-x of a hand's keypoints (for the positional pick). */
function meanX(hand: Hand): number {
  let s = 0;
  for (const k of hand.keypoints) s += k.x;
  return hand.keypoints.length ? s / hand.keypoints.length : NaN;
}

/** Pick the fretting hand out of a frame, or `undefined` when it is not there. */
export function frettingHand(frame: HandsFrame, pick: FrettingHandPick): Hand | undefined {
  const hands = frame.hands.filter((h) => h.keypoints.length >= 21);
  if (hands.length === 0) return undefined;
  if (pick.by === 'handedness') return hands.find((h) => h.handedness === pick.label);
  if (hands.length === 1) return hands[0];
  const sorted = [...hands].sort((a, b) => meanX(a) - meanX(b));
  return pick.side === 'min' ? sorted[0] : sorted[sorted.length - 1];
}
