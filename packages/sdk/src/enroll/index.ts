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
 * | Bind | `bind.ts` | a category's entry fires its command; the saved model + bindings schema |
 * | Units | `noise.ts` | every distance in multiples of a feature's own jitter — unit-free |
 * | Cues | `cue.ts` | what the player is asked to do, as a Zod-schema'd collection (#163) |
 * | Sufficiency | `sufficiency.ts` | the strategy seam that says when a cue has ENOUGH |
 * | Runner | `runner.ts` | steps a routine through its cues, driven by the verdicts |
 * | Take | `session.ts` | holds the samples per cue, produces a model, re-cuts cheaply |
 * | Name | `match.ts` | default names one-to-one from a general model (Hungarian), else a fallback (#330) |
 * | Show | `exemplars.ts` | each category's medoid, then members toward its edge (#330) |
 * | Save | `categorizer.ts` | the versioned file: samples as the SSOT, the model derived, migrations (#330) |
 * | Reuse | `from_model.ts` | merge a new session into a model; carry names to a fresh carve (#330) |
 * | Watch | `bars.ts` | live feature bars in noise units from the rest; the online carve's separating features (#385) |
 * | Sort | `sorting.ts` | one editable carve: moves as pins, a re-cut honouring them, merge, split, delete (#385 E4) |
 *
 * ## The one architectural rule
 *
 * Everything is defined over a **`FeatureVector`** (`Record<featureId, number>`), never
 * over a `FaceFrame`. The feature catalog already emits that shape from face *and* hands
 * through one contract, so this is a face trainer, a hand trainer, and a trainer for
 * whatever is added to the catalog next — on day one. Nothing here imports MediaPipe, the
 * DAG, React or the audio layer.
 */
export {
  createStillPointSampler,
  meanAbsDistance,
  noiseDistance,
  type SamplerOptions,
  type StillPointSampler,
} from './sampler';
export {
  applyWeights,
  createNoiseEstimator,
  effectiveSigma,
  scaleWeights,
  type NoiseEstimator,
  type NoiseOptions,
  type NoiseSnapshot,
  type ScaleOptions,
} from './noise';
export {
  buildConstrainedForest,
  buildHierarchy,
  cutAt,
  cutForest,
  forestRange,
  suggestForestK,
  suggestK,
  weightedDistance,
  type ConstraintOptions,
  type Forest,
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
  trainNeutral,
  NEUTRAL_DEFAULTS,
  type CategoryTracker,
  type ClassifyOptions,
  type TrackerOptions,
  type TrainOptions,
  type NeutralOptions,
} from './classify';
export {
  CueCollectsSchema,
  CuePairingSchema,
  CueProductSchema,
  CueRecordSchema,
  CueSchema,
  CueSpecSchema,
  INVARIANCE_AXES,
  InvarianceSchema,
  PAIRING_SURFACES,
  RoutineRecordSchema,
  RoutineSpecSchema,
  SufficiencySchema,
  clickPlan,
  cueFeatures,
  cueFromRecord,
  resolveRoutine,
  routineFeatures,
  routineGroups,
  samplingFor,
  type Click,
  type Cue,
  type CuePairing,
  type CueProduct,
  type CueRecord,
  type CueSampling,
  type CueSpec,
  type CueSpecInput,
  type RoutineRecord,
  type RoutineSpec,
  type Sufficiency,
} from './cue';
export {
  CANNOT_REASONS,
  DEFAULT_NUDGES,
  defaultSufficiency,
  distinctPoints,
  excursionOf,
  type SufficiencyEvaluator,
  type SufficiencyInput,
  type Verdict,
} from './sufficiency';
export {
  RUNNER_PHRASES,
  createRunner,
  cueCoverage,
  type CueOutcome,
  type Runner,
  type RunnerEvent,
  type RunnerOptions,
  type RunnerState,
  type RunnerStatus,
} from './runner';
export { createSession, type Session, type SessionOptions } from './session';
export {
  SEQUENCE_PHRASES,
  SequenceRecordSchema,
  SequenceSpecSchema,
  SequenceTargetSchema,
  createSequenceRunner,
  sayFor,
  sequenceDurationMs,
  sequenceLength,
  sequenceOf,
  type SequenceEvent,
  type SequencePhase,
  type SequenceRecord,
  type SequenceRunner,
  type SequenceRunnerOptions,
  type SequenceSpec,
  type SequenceSpecInput,
  type SequenceState,
  type SequenceTarget,
  type TargetCheck,
  type TargetOutcome,
  type TargetResult,
  type TargetVerdict,
} from './sequence';
export {
  MIN_POINTS_FOR_PROJECTION,
  fitProjection,
  safeEpochs,
  seededRandom,
  selectInRect,
  thinLayout,
  toMetricRow,
  type Point2,
  type Projection,
  type ProjectionOptions,
  type Representative,
} from './projection';
export {
  BoundCategoriesSchema,
  CATEGORY_EDGE_DEFAULTS,
  CategoryBindingSchema,
  TrainedModelSchema,
  carryBindings,
  categoryName,
  createCategoryEdge,
  hasReading,
  toCategoryScores,
  type BoundCategories,
  type CategoryBinding,
  type CategoryEdge,
  type CategoryEdgeOptions,
  type CategoryReading,
  type CategoryStep,
} from './bind';
export { categoryKey } from './types';
export type {
  Category,
  Classification,
  FeatureVector,
  FeatureWeights,
  NuisanceProfile,
  StillPoint,
  TrainedModel,
} from './types';
export {
  LABEL_MATCH_DEFAULTS,
  applyLabels,
  assignMax,
  matchLabels,
  type LabelMatch,
  type LabelMatchOptions,
  type MatchableCategory,
} from './match';
export {
  EXEMPLAR_DEFAULTS,
  exemplarsByCategory,
  selectExemplars,
  type Exemplar,
  type ExemplarOptions,
} from './exemplars';
export {
  CATEGORIZER_FORMAT,
  CATEGORIZER_MIGRATIONS,
  CATEGORIZER_VERSION,
  NO_REJECT_RADIUS,
  MAX_CATEGORIZER_SAMPLES,
  MAX_CATEGORIZER_FEATURES,
  MAX_SAMPLE_SUPPORT,
  NEUTRAL_BIN,
  ASIDE_BIN,
  PersonalCategorizerSchema,
  categorizerFromModel,
  categorizerMode,
  strangersFor,
  memberIndices,
  neutralSampleIndices,
  sampleIndex,
  migrateCategorizerV1,
  migrateCategorizerV2,
  v1SampleId,
  exportCategorizer,
  importCategorizer,
  modelFromCategorizer,
  toSample,
  type CategorizerMeta,
  type CategorizerMigration,
  type CategorizerMode,
  type CategorizerSample,
  type CategorizerStrangers,
  type MigrateV1Options,
  type SampleInput,
  type ImportOptions,
  type ImportResult,
  type PersonalCategorizer,
} from './categorizer';
export {
  MERGE_DEFAULTS,
  SEED_CUE,
  carryLabels,
  mergeSession,
  type CarryLabelsOptions,
  type MergeOptions,
  type MergeResult,
} from './from_model';
export {
  CARVE_DEFAULTS,
  createCarver,
  neutralIndices,
  type CarvableSession,
  type CarveOptions,
  type Carver,
} from './carve';
export {
  FOREST_CACHE_SIZE,
  NEW_CATEGORY,
  anchorNames,
  consistentPins,
  deleteHolds,
  freshCategoryId,
  medoidOf,
  mergeCategories,
  moveHolds,
  nameCategory,
  pinnedCategories,
  pinsHold,
  placeOf,
  recut,
  recutBounds,
  recutRange,
  sampleIds,
  splitCategory,
  type MoveOptions,
  type Place,
  type RecutOptions,
  type RecutRange,
  type SortResult,
} from './sorting';
