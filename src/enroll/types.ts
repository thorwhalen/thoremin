/**
 * The enrollment/trainer vocabulary (#160) — the types every other module in
 * `src/enroll/` speaks.
 *
 * ## The one decision this file encodes
 *
 * Everything here is defined over a **`FeatureVector`** (`Record<featureId, number>`),
 * never over a `FaceFrame`. That is the load-bearing choice from the research: the
 * feature catalog already emits a flat, named, normalized scalar vector from face *and*
 * hands through one `compute(ctx) => number` contract, so a trainer written against the
 * vector is a face trainer, a hand trainer, and a trainer for anything added to the
 * catalog later — on day one, with no refactor. Writing it against `FaceFrame` is the
 * single decision that would make it face-only forever.
 *
 * Nothing in `src/enroll/` imports MediaPipe, the DAG, the audio layer, or React. It is
 * a pure library over numbers; the host feeds it vectors and reads back categories.
 */
import type { Invariance } from '@/features/types';

/** A named scalar feature vector — the trainer's only input shape. */
export type FeatureVector = Record<string, number>;

/**
 * One captured still-point: a feature vector the player HELD, plus when they held it.
 *
 * Still-points, not frames. A free-motion stream is dominated by the transitions
 * between expressions, so clustering every frame finds the centre of the motion
 * envelope rather than the expressions themselves. See `sampler.ts`.
 */
export interface StillPoint {
  /** The held feature vector. */
  vector: FeatureVector;
  /** Milliseconds since the recording started. */
  t: number;
  /**
   * The id of the cue that produced it (#163). A cue can be re-run independently, the
   * projection can colour points by cue, and a category that is mostly one cue's
   * points has a ready-made name suggestion.
   */
  cue: string;
}

/**
 * A nuisance profile: how much each feature moved while the player demonstrated
 * something that should NOT count as a change (moving closer to the camera, turning
 * their head). Used to down-weight those directions.
 */
export interface NuisanceProfile {
  /** Per-feature standard deviation observed across the nuisance demonstration. */
  spread: Record<string, number>;
  /** The invariance axes the demonstration was meant to cover, for display. */
  axes: readonly Invariance[];
  /** How many samples it was built from — a profile from 3 frames is not evidence. */
  samples: number;
}

/** Per-feature multiplier applied before any distance is computed. */
export type FeatureWeights = Record<string, number>;

/** One discovered category: a centroid in feature space plus what it was built from. */
export interface Category {
  /** Stable id (`cat-1`, …) — what a binding refers to, so a rename cannot break it. */
  id: string;
  /** Player-facing name. Empty until they name it. */
  label: string;
  /** The mean feature vector of its members. */
  centroid: FeatureVector;
  /** How many still-points formed it. */
  size: number;
  /** Mean weighted distance of its members from the centroid — its tightness. */
  radius: number;
  /**
   * Which cues its member still-points came from (cue id -> count). Filled by the
   * session; a host may offer the dominant cue as the category's starting name.
   */
  cues?: Record<string, number>;
}

/**
 * A trained model: the categories, the weights distances are measured under, and the
 * reject radius. Serializable by construction — it is all plain numbers, so persisting
 * it is a `JSON.stringify` and never a model format.
 */
export interface TrainedModel {
  categories: Category[];
  weights: FeatureWeights;
  /** The features the model actually uses, in a fixed order. */
  features: string[];
  /**
   * Weighted distance beyond which a vector belongs to no category — the no-man's-land
   * boundary. Set by demonstration (the rest step) rather than by a magic number.
   */
  rejectRadius: number;
}

/** What the classifier says about one live vector. */
export interface Classification {
  /** The winning category id, or `null` for no-man's-land. */
  categoryId: string | null;
  /**
   * Soft membership per category id, summing to 1 across categories.
   *
   * The primary output, deliberately. A hard category is a step function, and step
   * functions are not expressive — both XMM and GVF output continuously for that
   * reason. Discrete triggers read `categoryId`; continuous mappings read this.
   */
  memberships: Record<string, number>;
  /** Weighted distance to the winning centroid (before the reject test). */
  distance: number;
  /** True when the vector fell outside `rejectRadius`. */
  rejected: boolean;
}
