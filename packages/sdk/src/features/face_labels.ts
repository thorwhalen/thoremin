/**
 * The general expression model as a label scorer for personal face categories (#330).
 *
 * A personal categorizer's centroids live in catalog ids (`face.blendshape.*`), the
 * general model in MediaPipe blendshape names. {@link blendshapesOf} is the bridge, and
 * {@link generalFaceLabeling} packages the general model as the matcher's inputs
 * (`enroll/match.ts`): the seven scored emotions as the label pool, their activations as
 * the score, and their default firing thresholds as the per-label bar. A category is
 * called "happy" by default only if the general model would fire "happy" on its centroid.
 */
import { BLENDSHAPE_NAME_BY_FEATURE } from './face_catalog';
import {
  DEFAULT_EXPRESSION_SENSITIVITY,
  EMOTIONS,
  EXPRESSION_PROTOTYPES,
  expressionActivations,
  expressionThresholds,
  type BlendshapeWeights,
  type Emotion,
  type ExpressionSensitivity,
} from '../music/expression';

/** The blendshape-name view of a vector in catalog ids (other features are ignored). */
export function blendshapesOf(vector: Readonly<Record<string, number>>): BlendshapeWeights {
  const out: BlendshapeWeights = {};
  for (const [id, name] of Object.entries(BLENDSHAPE_NAME_BY_FEATURE)) {
    const x = vector[id];
    if (Number.isFinite(x)) out[name] = x;
  }
  return out;
}

export interface GeneralFaceLabelingOptions {
  /** The prototypes to score with (the shipped FACS-style set by default). */
  prototypes?: Record<Emotion, BlendshapeWeights>;
  /** The sensitivity whose thresholds become the per-label bar. */
  sensitivity?: ExpressionSensitivity;
}

/** The general face model as `matchLabels` options (labels, score, minScore). */
export function generalFaceLabeling(options: GeneralFaceLabelingOptions = {}) {
  const prototypes = options.prototypes ?? EXPRESSION_PROTOTYPES;
  return {
    labels: EMOTIONS,
    score: (centroid: Readonly<Record<string, number>>) => expressionActivations(blendshapesOf(centroid), prototypes),
    minScore: expressionThresholds(options.sensitivity ?? DEFAULT_EXPRESSION_SENSITIVITY),
  };
}
