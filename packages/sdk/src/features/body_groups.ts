/**
 * The body POSE feature space (#381, body-movement B1): which body features a pose
 * category is measured in, beside `faceCollects()` for faces, and how much of that space
 * a frame actually shows.
 *
 * A pose is a held shape, so the space is the static, body-relative part of the catalog
 * (design §4.2 in `docs/research/body-conducting-and-pose-categories.md`):
 *
 *  - **In:** joint angles, segment directions in the torso frame, the body-relative
 *    positions (a wrist's rise above its shoulder) and the shape ratios (extension,
 *    openness, stance, height).
 *  - **Out, by group:** kinematics, Laban effort and the pulse (motion, not shape; they
 *    belong to dynamic gestures), and the `body.rel` booleans. A boolean's resting jitter
 *    is exactly zero, so in noise units its first flip is an unbounded distance that
 *    would dominate every carve. They stay in the catalog for the Lab and for a
 *    hand-written labeler, where a threshold is exactly right.
 *  - **Out, by id:** every feature of a claimed group that is not invariant to where the
 *    player stands (absolute frame positions, the centre of mass, sway). Derived from the
 *    catalog's own `invariantTo` labels, so a new absolute feature is left out without
 *    an edit here.
 *
 * Pure and modality-specific: the enrolment core (`../enroll`) stays modality-free, and the
 * body's choice lives here with the body catalog it reads, as the face's does.
 */
import type { FeatureVector } from './types';
import { BODY_FEATURES } from './body_catalog';

/** The body groups a pose take records (see the module header for what is left out). */
export const BODY_POSE_GROUPS: readonly string[] = ['body.angle', 'body.dir', 'body.pos', 'body.shape'];

/** Features of the claimed groups that encode WHERE the player is, not the pose: every one
 *  whose declared invariances do not include `position`. */
export const BODY_POSE_OMIT: readonly string[] = BODY_FEATURES.filter(
  (f) => BODY_POSE_GROUPS.includes(f.group) && !(f.invariantTo ?? []).includes('position'),
).map((f) => f.id);

/** A body pose cue's `collects`: the given groups (all of {@link BODY_POSE_GROUPS} by
 *  default) minus {@link BODY_POSE_OMIT}. */
export const bodyPoseCollects = (groups: readonly string[] = BODY_POSE_GROUPS): { groups: string[]; omit: string[] } => ({
  groups: [...groups],
  omit: [...BODY_POSE_OMIT],
});

/** The ids of the pose space, in catalog order. */
export const BODY_POSE_FEATURE_IDS: readonly string[] = BODY_FEATURES.filter(
  (f) => BODY_POSE_GROUPS.includes(f.group) && !BODY_POSE_OMIT.includes(f.id),
).map((f) => f.id);

/**
 * The fraction of `ids` this vector has a finite value for, 0..1 (1 for an empty list).
 * The vector node drops what the visibility mask hides, so for a body this is how much of
 * the player the camera sees, measured in the features a categorizer was trained on.
 */
export function featureCoverage(vector: FeatureVector, ids: readonly string[]): number {
  if (!ids.length) return 1;
  let present = 0;
  for (const id of ids) if (Number.isFinite(vector[id])) present += 1;
  return present / ids.length;
}

/** {@link featureCoverage} over the whole pose space. */
export const bodyPoseCoverage = (vector: FeatureVector): number => featureCoverage(vector, BODY_POSE_FEATURE_IDS);

/** The design's proposed bar under which a pose reading should say "cannot see you" rather
 *  than guess (design §4.3, "say 80 %"). Exported for the body modality (B2) to adopt or
 *  replace; nothing in B1 enforces it. */
export const BODY_POSE_MIN_COVERAGE = 0.8;
