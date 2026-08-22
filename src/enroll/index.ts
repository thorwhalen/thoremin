/**
 * Trainer / enrollment (#160) — learn a player's OWN control categories from a short
 * guided recording, instead of asking them to hit categories a population model chose.
 *
 * The problem this exists for is not a tuning failure. Being unable to reliably hit a
 * shipped expression category is **identity bias** — a named, measured, subject-dependent
 * gap in facial expression recognition — and the field's answer is personalization. The
 * usual blocker on personalization is that subject-specific labels are unavailable in the
 * wild; that blocker simply does not apply to an instrument whose player is sitting at the
 * camera and willing to spend a minute making faces at it. Labels are free here.
 *
 * Full evidence and citations: `docs/research/trainer-mode.md`.
 *
 * ## The pipeline, each stage its own module
 *
 * | stage | module | what it does |
 * |---|---|---|
 * | Sample | `sampler.ts` | velocity-gate the live vector; keep poses actually HELD |
 * | Condition | `invariance.ts` | down-weight what moved during a nuisance demo; consume #131's declarations |
 * | Carve | `cluster.ts` | agglomerative hierarchy; cut at k — **before or after** |
 * | Reject | `classify.ts` | no-man's-land by demonstration, hysteretic, holds rather than silences |
 * | Ritual | `ritual.ts` | the four guided steps, as data |
 * | Facade | `session.ts` | runs the ritual, produces a model, re-cuts cheaply |
 *
 * ## The one architectural rule
 *
 * Everything is defined over a **`FeatureVector`** (`Record<featureId, number>`), never
 * over a `FaceFrame`. The feature catalog already emits that shape from face *and* hands
 * through one contract, so this is a face trainer, a hand trainer, and a trainer for
 * whatever is added to the catalog next — on day one. Nothing here imports MediaPipe, the
 * DAG, React or the audio layer.
 */
export { createStillPointSampler, meanAbsDistance, type SamplerOptions, type StillPointSampler } from './sampler';
export {
  buildHierarchy,
  cutAt,
  suggestK,
  weightedDistance,
  type Hierarchy,
  type TreeNode,
} from './cluster';
export {
  combineWeights,
  nuisanceProfile,
  rankFeatures,
  selectByInvariance,
  weightsFromNuisance,
  weightsFromSelection,
  type InvarianceSelection,
  type WeightOptions,
} from './invariance';
export {
  classify,
  createCategoryTracker,
  trainModel,
  type CategoryTracker,
  type ClassifyOptions,
  type TrackerOptions,
  type TrainOptions,
} from './classify';
export {
  ENROLLMENT_STEPS,
  canTrain,
  stepById,
  stepCoverage,
  type EnrollmentStep,
  type StepProduct,
} from './ritual';
export {
  createEnrollmentSession,
  type EnrollmentSession,
  type SessionOptions,
  type StepProgress,
} from './session';
export type {
  Category,
  Classification,
  FeatureVector,
  FeatureWeights,
  NuisanceProfile,
  StepId,
  StillPoint,
  TrainedModel,
} from './types';
