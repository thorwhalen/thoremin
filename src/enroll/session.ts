/**
 * The enrollment session (#160) — the facade that runs the ritual and produces a model.
 *
 * This is the one stateful object a host holds. It owns the per-step capture (a
 * still-point sampler for the pose steps, raw accumulation for the spread steps), and
 * turns the accumulated take into a {@link TrainedModel} on demand.
 *
 * **`retrain(k)` is deliberately cheap and repeatable.** It re-cuts the already-built
 * hierarchy — it does not recluster. That is what makes "specify the number of
 * categories before *or afterwards*" real: the player drags a slider from 3 to 6 to 4
 * and each move is a tree cut over the same recording, not a retrain. `build()` (the
 * expensive part) happens once when the take finishes.
 *
 * Nothing here touches React, the DAG, MediaPipe or audio. The host pushes feature
 * vectors in and reads a model out.
 */
import { buildHierarchy, cutAt, suggestK, type Hierarchy } from './cluster';
import { trainModel } from './classify';
import {
  combineWeights,
  nuisanceProfile,
  rankFeatures,
  selectByInvariance,
  weightsFromNuisance,
  weightsFromSelection,
} from './invariance';
import { createStillPointSampler, type StillPointSampler } from './sampler';
import { ENROLLMENT_STEPS, canTrain, stepById, stepCoverage } from './ritual';
import type {
  FeatureVector,
  FeatureWeights,
  StepId,
  StillPoint,
  TrainedModel,
} from './types';

export interface SessionOptions {
  /** Cap on how many features the model uses. See `rankFeatures` for why a cap exists. */
  maxFeatures?: number;
  /** Honour declared `invariantTo` in addition to the demonstrated nuisance profile. */
  useDeclaredInvariance?: boolean;
  /** Passed through to the sampler. */
  speedThreshold?: number;
  dwellMs?: number;
}

/** Per-step progress, for the coverage meter. */
export interface StepProgress {
  id: StepId;
  samples: number;
  coverage: number;
}

export interface EnrollmentSession {
  /** Start (or restart) one step. Re-running a step discards only that step's samples. */
  beginStep(id: StepId): void;
  /** Feed a live feature vector. No-op when no step is active. */
  push(vector: FeatureVector, tMs: number): void;
  /** Finish the active step. */
  endStep(): void;
  /** Progress for every step. */
  progress(): StepProgress[];
  /** Whether enough has been captured to train. */
  ready(): boolean;
  /** Build the hierarchy from the vocabulary take. Call once when the take finishes. */
  build(): void;
  /** The k the merge-gap heuristic suggests. A SUGGESTION — see `suggestK`. */
  suggestedK(): number;
  /** Re-cut the built hierarchy into `k` categories and return the model. Cheap. */
  retrain(k: number): TrainedModel;
  /** The still-points captured for a step (for display / debugging). */
  pointsFor(id: StepId): StillPoint[];
  /** The features the model is using, best-first. */
  features(): string[];
  /** The weights distances are measured under. */
  weights(): FeatureWeights;
  reset(): void;
}

const DEFAULTS = { maxFeatures: 24, useDeclaredInvariance: false };

export function createEnrollmentSession(options: SessionOptions = {}): EnrollmentSession {
  const o = { ...DEFAULTS, ...options };

  /** Still-points per step (the 'still-points' steps). */
  const points = new Map<StepId, StillPoint[]>();
  /** Raw frames per step (the 'continuous' steps — rest and nuisance). */
  const raw = new Map<StepId, FeatureVector[]>();

  let active: StepId | null = null;
  let sampler: StillPointSampler | null = null;

  let hierarchy: Hierarchy = { heights: [], size: 0 };
  let chosenFeatures: string[] = [];
  let chosenWeights: FeatureWeights = {};

  const samplesFor = (id: StepId): number =>
    (points.get(id)?.length ?? 0) + (raw.get(id)?.length ?? 0);

  return {
    beginStep(id) {
      active = id;
      const step = stepById(id);
      points.delete(id);
      raw.delete(id);
      if (step?.sampling === 'still-points') {
        sampler = createStillPointSampler({
          step: id,
          ...(o.speedThreshold !== undefined ? { speedThreshold: o.speedThreshold } : {}),
          ...(o.dwellMs !== undefined ? { dwellMs: o.dwellMs } : {}),
        });
        points.set(id, []);
      } else {
        sampler = null;
        raw.set(id, []);
      }
    },

    push(vector, tMs) {
      if (!active) return;
      if (sampler) {
        const p = sampler.push(vector, tMs);
        if (p) points.get(active)!.push(p);
      } else {
        raw.get(active)!.push(vector);
      }
    },

    endStep() {
      active = null;
      sampler = null;
    },

    progress: () =>
      ENROLLMENT_STEPS.map((s) => ({
        id: s.id,
        samples: samplesFor(s.id),
        coverage: stepCoverage(s, samplesFor(s.id)),
      })),

    ready: () =>
      canTrain(Object.fromEntries(ENROLLMENT_STEPS.map((s) => [s.id, samplesFor(s.id)]))),

    build() {
      const vocab = (points.get('vocabulary') ?? []).map((p) => p.vector);
      if (vocab.length === 0) {
        hierarchy = { heights: [], size: 0 };
        chosenFeatures = [];
        chosenWeights = {};
        return;
      }

      // 1. Demonstrated invariance: what moved while nothing should have.
      const nuisance = raw.get('nuisance') ?? [];
      const profile = nuisanceProfile(nuisance, stepById('nuisance')?.axes ?? []);
      let weights = weightsFromNuisance(profile);

      // 2. Declared invariance (#131), optional and OFF by default: it silences every
      //    feature that has not been assessed, which is most of the catalog, so turning
      //    it on without saying so would quietly shrink the model.
      if (o.useDeclaredInvariance) {
        const all = Object.keys(vocab[0] ?? {});
        const sel = selectByInvariance(stepById('nuisance')?.axes ?? [], all);
        weights = combineWeights(weights, weightsFromSelection([...sel.keep, ...sel.unassessed], all));
      }

      // 3. Rank by signal-after-weighting and keep the top slice.
      chosenFeatures = rankFeatures(vocab, weights, o.maxFeatures);
      chosenWeights = weights;
      hierarchy = buildHierarchy(vocab, chosenFeatures, weights);
    },

    suggestedK: () => suggestK(hierarchy),

    retrain(k) {
      const vocab = (points.get('vocabulary') ?? []).map((p) => p.vector);
      const clusters = cutAt(hierarchy, k);
      return trainModel(vocab, clusters, chosenFeatures, chosenWeights, {
        restVectors: raw.get('rest') ?? [],
      });
    },

    pointsFor: (id) => (points.get(id) ?? []).slice(),
    features: () => chosenFeatures.slice(),
    weights: () => ({ ...chosenWeights }),

    reset() {
      points.clear();
      raw.clear();
      active = null;
      sampler = null;
      hierarchy = { heights: [], size: 0 };
      chosenFeatures = [];
      chosenWeights = {};
    },
  };
}
