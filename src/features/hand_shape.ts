/**
 * The hand-shape featurizer (#249): one hand → one flat feature vector of the quantities
 * a held hand SHAPE is made of, chosen by the catalog's declared invariance.
 *
 * Born in the footage pipeline (`scripts/air/lib_chord_shape_features.ts`, the guitar
 * chord-shape model of `docs/research/air-instruments.md` §6) and moved here when the air
 * guitar needed the same vector live: one implementation, so the model the footage
 * measured and the model a player enrols can never drift apart.
 *
 * It is deliberately NOT a new featurizer. The hand catalog already computes per-finger
 * joint angles and curls, adjacent-finger spreads, thumb opposition, pinch distances and
 * openness, and declares what each is invariant to (#131). The default takes every hand
 * feature invariant to scale, position, yaw, pitch and roll (flexion, spread, pinch,
 * openness): angles and span-normalised distances, which a mirror image also leaves
 * unchanged, so either hand yields the same vector for the same shape. `withOrientation`
 * adds the palm-orientation group for a camera-locked variant (signed, so it flips with
 * the hand).
 *
 * Ids are SIDE-RELATIVE (`index.curl`, not `hand.left.index.curl`): a shape is the same
 * shape on either hand. Pure and Node-safe.
 */
import { buildHandCtx, HAND_SIDE_FEATURES, type FeatureVector } from './catalog';
import type { Hand, HandsFrame } from '@/nodes/domain';

const SHAPE_INVARIANCES = ['scale', 'position', 'yaw', 'pitch', 'roll'] as const;
const ORIENTATION_GROUP = 'hand.palm.orientation';

export interface FeatureSelection {
  /** Include the palm-orientation group (camera-locked, chirality-signed). Default false. */
  withOrientation?: boolean;
}

/** The ordered feature ids a shape model uses, chosen by declared invariance. */
export function chordShapeFeatureIds(sel: FeatureSelection = {}): string[] {
  return HAND_SIDE_FEATURES.filter((f) => {
    const inv = f.invariantTo;
    const shape = inv !== undefined && SHAPE_INVARIANCES.every((axis) => inv.includes(axis));
    return shape || (sel.withOrientation === true && f.group === ORIENTATION_GROUP);
  }).map((f) => f.id);
}

/**
 * Featurize one hand. Every selected id is present; a feature the catalog cannot compute
 * this frame is `NaN` (a model imputes or skips it), never dropped, so vectors stay
 * fixed-dimensional.
 */
/** The selected ids as a set, built once per selection (this runs every camera frame). */
const idSets = new Map<boolean, ReadonlySet<string>>();
const idSetFor = (sel: FeatureSelection): ReadonlySet<string> => {
  const key = sel.withOrientation === true;
  let ids = idSets.get(key);
  if (!ids) idSets.set(key, (ids = new Set(chordShapeFeatureIds(sel))));
  return ids;
};

export function chordShapeVector(hand: Hand, frame: HandsFrame, sel: FeatureSelection = {}): FeatureVector {
  const ids = idSetFor(sel);
  const ctx = buildHandCtx(hand, frame, { mirrorX: false, side: 'left' });
  const out: FeatureVector = {};
  for (const f of HAND_SIDE_FEATURES) {
    if (!ids.has(f.id)) continue;
    const v = f.compute(ctx);
    out[f.id] = Number.isFinite(v) ? v : NaN;
  }
  return out;
}
