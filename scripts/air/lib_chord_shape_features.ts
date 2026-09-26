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
 * has a chance on an over-the-shoulder clip. Those are all angles and span-normalized
 * distances, which a mirror image leaves unchanged, so a left-handed player's fretting
 * hand (the physical right) yields the same vector as a right-handed player's.
 * `withOrientation` adds the palm-orientation group for a camera-locked variant; those
 * features are signed, so they flip for the mirrored hand and the lefty source must be
 * excluded or mirrored when they are on.
 *
 * Ids are SIDE-RELATIVE (`index.curl`, not `hand.left.index.curl`): a chord shape is the
 * same shape on either hand. Without world landmarks (synthetic sources, old fixtures)
 * the catalog falls back to image coordinates and the yaw/pitch invariance degrades to
 * in-plane invariance; real footage decoded by `video_to_landmarks.py` carries them.
 */
import { buildHandCtx, HAND_SIDE_FEATURES, type FeatureVector } from '@/features/catalog';
import type { Hand, HandsFrame } from '@/nodes/domain';
import type { FrettingHandPick } from './lib_sources';

const SHAPE_INVARIANCES = ['scale', 'position', 'yaw', 'pitch', 'roll'] as const;
const ORIENTATION_GROUP = 'hand.palm.orientation';

export interface FeatureSelection {
  /** Include the palm-orientation group (camera-locked, chirality-signed). Default false. */
  withOrientation?: boolean;
}

/** The ordered feature ids the chord model uses, chosen by declared invariance. */
export function chordShapeFeatureIds(sel: FeatureSelection = {}): string[] {
  return HAND_SIDE_FEATURES.filter((f) => {
    const inv = f.invariantTo;
    const shape = inv !== undefined && SHAPE_INVARIANCES.every((axis) => inv.includes(axis));
    return shape || (sel.withOrientation === true && f.group === ORIENTATION_GROUP);
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

/**
 * Pick the fretting hand out of a frame, or `undefined` when it is not there.
 *
 * With a positional pick and two hands, the one further toward the chosen side wins.
 * With ONE hand it is accepted only if it sits on that half of the frame: a waist-up
 * shot where the neck hides the fretting hand still shows the strumming hand, and a
 * lone hand on the wrong side is that one, not a chord. A phantom second detection
 * (#144) on the far side of the frame still loses to the real hand on the chosen side.
 */
export function frettingHand(frame: HandsFrame, pick: FrettingHandPick): Hand | undefined {
  const hands = frame.hands.filter((h) => h.keypoints.length >= 21);
  if (hands.length === 0) return undefined;
  if (pick.by === 'handedness') return hands.find((h) => h.handedness === pick.label);
  const sorted = [...hands].sort((a, b) => meanX(a) - meanX(b));
  const chosen = pick.side === 'min' ? sorted[0] : sorted[sorted.length - 1];
  if (hands.length > 1) return chosen;
  const mid = frame.width / 2;
  const x = meanX(chosen);
  const onSide = pick.side === 'min' ? x < mid : x > mid;
  return onSide ? chosen : undefined;
}

/**
 * The featurize seam for the dataset join: a frame → the fretting hand's chord-shape
 * vector, or `undefined` when no usable hand is there. Flute (two hands + face) and
 * bass (hand + body-relative position) will pass their own function here.
 */
export const chordShapeFeaturizer =
  (pick: FrettingHandPick, sel: FeatureSelection = {}) =>
  (frame: HandsFrame): FeatureVector | undefined => {
    const hand = frettingHand(frame, pick);
    return hand ? chordShapeVector(hand, frame, sel) : undefined;
  };
