/**
 * The hand as a carve modality (#385 E8): "Your hand shapes", the personal categorizer tool on
 * one hand's SHAPE (#387 C4: side-relative, so either hand makes the same category, with a
 * per-categorizer choice of hand stored on the file).
 *
 * The feature space is the air guitar's (`handShapeFeatureIds`, chosen by the catalog's declared
 * invariance: every hand feature invariant to scale, position, yaw, pitch and roll, so the
 * flexion, spread, pinch and openness of the hand, which a mirror image also leaves unchanged),
 * under the same SIDE-RELATIVE ids (`index.curl`). So a carved hand sample IS an air guitar
 * vocabulary vector, and a categorizer can be offered to the guitar without a translation.
 *
 * The merged live vector names a hand by side (`hand.left.index.curl`); {@link handModality}'s
 * `project` picks one hand and strips its side, keeping its positions too (`wrist.x`, the
 * fingertips), which crop the still and draw its skeleton, and which no sample keeps. The
 * session resolves cues against the modality's own `space` (side-relative ids), not the catalog's.
 *
 * Its general model is the hand's three rule poses (`src/nodes/features/gesture_classifier.ts`:
 * open, fist, pinch), as a labeling over a category's centroid; no nuisance (the shape features
 * are scale- and pose-invariant by declaration).
 */
import type { CarveModality, FeatureSpace, ModalityOptions, ModalityWords } from '../../enroll/modality';
import type { GeneralLabeling } from '../../enroll/modality';
import type { FeatureVector } from '../../enroll/types';
import { HAND_SIDE_FEATURES } from '../catalog';
import { handWords } from './hand_words';

/** The axes a hand-shape feature must be declared invariant to. */
export const HAND_SHAPE_INVARIANCES = ['scale', 'position', 'yaw', 'pitch', 'roll'] as const;
const ORIENTATION_GROUP = 'hand.palm.orientation';

export interface HandShapeSelection {
  /** Include the palm-orientation group (camera-locked, chirality-signed). Default false. */
  withOrientation?: boolean;
}

/** The ordered side-relative ids a hand-shape model uses, chosen by declared invariance (the air
 *  guitar's chord shapes and the hand categorizer's space: one list, so they never drift). */
export function handShapeFeatureIds(sel: HandShapeSelection = {}): string[] {
  return HAND_SIDE_FEATURES.filter((f) => {
    const inv = f.invariantTo;
    const shape = inv !== undefined && HAND_SHAPE_INVARIANCES.every((axis) => inv.includes(axis));
    return shape || (sel.withOrientation === true && f.group === ORIENTATION_GROUP);
  }).map((f) => f.id);
}

/** The groups a hand-shape cue collects (the shape ids are all in these). */
export const HAND_SHAPE_GROUPS: readonly string[] = ['hand.finger.flexion', 'hand.finger.spread', 'hand.distances.pinch', 'hand.whole'];
/** The groups claimed while the tool reads the camera: the shape, and the positions a still is
 *  cropped and its skeleton drawn from. */
export const HAND_CLAIM_GROUPS: readonly string[] = [...HAND_SHAPE_GROUPS, 'hand.position.raw'];

const SHAPE_IDS: readonly string[] = handShapeFeatureIds();
const SHAPE = new Set(SHAPE_IDS);
const GROUP_OF = new Map(HAND_SIDE_FEATURES.map((f) => [f.id, f.group] as const));

/** The side-relative registry: every per-hand feature id and its group. */
export const HAND_SPACE: FeatureSpace = {
  ids: HAND_SIDE_FEATURES.map((f) => f.id),
  groupOf: (id) => GROUP_OF.get(id),
};

const SIDE_PREFIX = { left: 'hand.left.', right: 'hand.right.' } as const;
type Side = keyof typeof SIDE_PREFIX;

/** The sides `options.hand` reads, in order of preference (`either`: the right hand when both are
 *  in view, a stated rule rather than a guess at which one the player means). */
function sidesFor(options?: ModalityOptions): readonly Side[] {
  const hand = options?.hand ?? 'either';
  return hand === 'left' ? ['left'] : hand === 'right' ? ['right'] : ['right', 'left'];
}

/** Whether `vector` names a hand by side (a merged vector), rather than side-relative. */
function isMerged(vector: FeatureVector): boolean {
  for (const k of Object.keys(vector)) if (k.startsWith(SIDE_PREFIX.left) || k.startsWith(SIDE_PREFIX.right)) return true;
  return false;
}

/** One hand's keys, side stripped; null when none of its shape features is finite. */
function sideOf(merged: FeatureVector, side: Side): FeatureVector | null {
  const prefix = SIDE_PREFIX[side];
  const out: FeatureVector = {};
  let seen = false;
  for (const [k, x] of Object.entries(merged)) {
    if (!k.startsWith(prefix)) continue;
    const id = k.slice(prefix.length);
    out[id] = x;
    if (SHAPE.has(id) && Number.isFinite(x)) seen = true;
  }
  return seen ? out : null;
}

function project(merged: FeatureVector, options?: ModalityOptions): FeatureVector {
  if (!isMerged(merged)) return merged;
  for (const side of sidesFor(options)) {
    const one = sideOf(merged, side);
    if (one) return one;
  }
  return {};
}

const keep = (key: string): boolean => SHAPE.has(key);

/** The thresholds of the hand's rule poses, on the catalog's own scales (openness: fingertip
 *  reach over palm span, about 2.6 open and 1.0 in a fist on the recorded hands; a thumb-index
 *  pinch distance over palm span, about 1.3 open and under 0.4 pinched). */
export const HAND_POSE_RULES = {
  openFrom: 1.6,
  openFull: 2.4,
  fistFrom: 1.8,
  fistFull: 1.2,
  pinchFrom: 0.6,
  pinchFull: 0.2,
  minScore: 0.5,
} as const;

/** The general model's poses (`gesture_classifier`'s three). */
export const HAND_POSES = ['open', 'fist', 'pinch'] as const;

const ramp = (x: number, from: number, full: number): number => {
  if (!Number.isFinite(x)) return 0;
  const t = (x - from) / (full - from);
  return Math.max(0, Math.min(1, t));
};

/** The rule poses as a labeling over a category's centroid (the names a fresh carve proposes). */
export function generalHandLabeling(rules: typeof HAND_POSE_RULES = HAND_POSE_RULES): GeneralLabeling {
  return {
    labels: HAND_POSES,
    score: (c) => {
      const pinch = ramp(c['pinch.thumbIndex'], rules.pinchFrom, rules.pinchFull);
      return {
        open: ramp(c.openness, rules.openFrom, rules.openFull) * (1 - pinch),
        fist: ramp(c.openness, rules.fistFrom, rules.fistFull) * (1 - pinch),
        pinch,
      };
    },
    minScore: rules.minScore,
  };
}

const HAND_WORDS: ModalityWords = {
  one: 'hand shape',
  many: 'hand shapes',
  part: 'hand',
  slug: 'hand-shapes',
  category: 'shape',
  neutral: 'neutral',
  fallback: (i) => `shape ${i + 1}`,
  rest: 'Hold one hand up to the camera, relaxed and a little open, and keep it there.',
};

export const handModality: CarveModality = {
  id: 'hand',
  words: HAND_WORDS,
  groups: HAND_CLAIM_GROUPS,
  collects: () => ({
    groups: [...HAND_SHAPE_GROUPS],
    // The ids of those groups that are not shape (size, tilt, the wrist-flexion proxy): where
    // the hand is and how it is turned is not what it does.
    omit: HAND_SPACE.ids.filter((id) => HAND_SHAPE_GROUPS.includes(GROUP_OF.get(id) ?? '') && !SHAPE.has(id)),
  }),
  project,
  space: HAND_SPACE,
  /** One hand's shape keys, side-relative, or null when no hand is in view. */
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
  general: () => generalHandLabeling(),
  nuisance: {},
  describe: handWords,
};
