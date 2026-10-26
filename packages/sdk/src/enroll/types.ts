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
import type { Invariance } from '../features/types';

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
  /**
   * When the hold began, in the caller's clock — on the live path the tap's stamp,
   * i.e. engine-clock MILLISECONDS (`ctx.time * 1000`, same origin as the recorder's
   * `t0` in seconds). Subtract the take's `t0` for an offset into a recording.
   */
  t: number;
  /**
   * The id of the cue that produced it (#163). A cue can be re-run independently, the
   * projection can colour points by cue, and a category that is mostly one cue's
   * points has a ready-made name suggestion.
   */
  cue: string;
}

/** One frame of a {@link Trace}: the whole live vector, and when (the caller's clock, ms). */
export interface TraceSample {
  vector: FeatureVector;
  t: number;
}

/**
 * One repetition of a named dynamic gesture (#751): the run of frames the motion segmenter
 * cut out of a take, from a window before the motion began to its last moving frame.
 *
 * The complement of a {@link StillPoint}: a still-point is what the player HELD, a trace is
 * what they DID between holds. Its frames carry the full vector, as a still-point does; which
 * features a gesture is matched on is the matcher's choice, made later (`dynamic-gestures.md`).
 */
export interface Trace {
  /** Stable within a take (`<cueId>#<n>`, n from 1): what dropping or flagging one
   *  repetition refers to, as a hold id does for a still-point. */
  id: string;
  /** The gesture's name, from the cue that asked for it ("wave"). */
  gesture: string;
  /** The id of the cue that captured it. */
  cue: string;
  samples: TraceSample[];
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
   * Indices (into the still-point pool the model was trained from) of its members,
   * ascending. This is a category's IDENTITY across re-cuts: `id` is positional and
   * `cat-2` at k=3 is not `cat-2` at k=4, but a name a player typed belongs to a set
   * of held poses, and a category with the same member set is the same category.
   * See {@link categoryKey}.
   */
  members: number[];
  /**
   * Which cues its member still-points came from (cue id -> count). Filled by the
   * session; a host may offer the dominant cue as the category's starting name.
   */
  cues?: Record<string, number>;
  /**
   * How big a face it takes to count as this category (#385 E7: the per-category size, a live
   * tuning, never trained): every distance to its centroid is multiplied by it before any
   * comparison (against the other categories, Neutral and the reject radius). Above 1 the face
   * must go further; below 1 a smaller one reaches it. Absent = 1.
   */
  scale?: number;
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
   * boundary. Set by demonstration (the baseline cue) rather than by a magic number.
   */
  rejectRadius: number;
  /**
   * The taught null class (#385 E5): prototypes of the holds the player put in Neutral ("this
   * face means nothing"). A vector nearest one of them reads as no category (`categoryId: null`,
   * {@link Classification.neutral}), whatever the reject radius says. Several prototypes because a
   * null class is heterogeneous (a resting face and a look at the keyboard are both "nothing");
   * absent or empty, nothing is taught and only the reject radius says "none of these". Ids are
   * `neutral-1..n`; `members` index the same pool as the categories'.
   */
  neutral?: Category[];
  /**
   * Whether a live distance is renormalised over the trained features present (#458): set from
   * the modality (`CarveModality.renormalize`, the body's poses), absent for faces and hands,
   * which classify bit for bit as before. See `presentDistance`.
   */
  renormalize?: boolean;
}

/** The stable key of a category across re-cuts: its member set. */
export function categoryKey(category: Pick<Category, 'members'>): string {
  return category.members.join(',');
}

/** What the classifier says about one live vector. */
export interface Classification {
  /** The winning category id, or `null` for no-man's-land. */
  categoryId: string | null;
  /**
   * Soft membership per category id. Summing to 1 across the categories, less the share of the
   * taught Neutral class ({@link Classification.neutralMembership}) when the model has one.
   *
   * The primary output, deliberately. A hard category is a step function, and step
   * functions are not expressive — both XMM and GVF output continuously for that
   * reason. Discrete triggers read `categoryId`; continuous mappings read this.
   */
  memberships: Record<string, number>;
  /** Weighted distance to the nearest CATEGORY's centroid: what the reject test reads. */
  distance: number;
  /** True when the vector fell outside `rejectRadius` (and Neutral was not nearer). */
  rejected: boolean;
  /** True when the taught Neutral class is nearest: no category, by the player's own example
   *  (#385 E5). Never true together with `rejected`. Absent for a model with no Neutral. */
  neutral?: boolean;
  /** The taught Neutral class's share of the soft memberships (0 without one). */
  neutralMembership?: number;
}
