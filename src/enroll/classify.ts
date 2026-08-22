/**
 * Training and classification (#160) — turning a cut hierarchy into a model, and a live
 * vector into a category.
 *
 * ## Three decisions here, each from a specific finding
 *
 * **1. Soft membership is the primary output.** A hard per-frame category is a step
 * function, and step functions are not expressive — this is why both XMM and GVF output
 * continuously. `categoryId` is still produced for discrete triggers (the #129 gesture
 * dispatcher can consume it directly), but a continuous mapping should read
 * `memberships` and get smooth motion between poses for free.
 *
 * **2. No-man's-land is a real region, set by demonstration.** Without a reject option
 * every frame is classified as *something*, so the instrument asserts a category while
 * the player scratches their nose. The reject radius comes from the rest step — "this is
 * what nothing looks like" — rather than a magic constant, because the open-set
 * literature's consistent finding is that thresholds are task-specific and tuning is the
 * crucial part.
 *
 * **3. Rejection is hysteretic, and it HOLDS rather than silences.** Entering no-man's-
 * land is harder than staying in a category (the same dwell/hysteresis pattern this repo
 * already uses for handedness and expression), and the classifier reports the last good
 * category while unsure. An instrument that drops to silence whenever the classifier
 * hesitates is unplayable — silence is the host's decision to make explicitly, not a
 * side effect of an uncertain frame.
 */
import { weightedDistance } from './cluster';
import type {
  Category,
  Classification,
  FeatureVector,
  FeatureWeights,
  TrainedModel,
} from './types';

/** Mean of a set of vectors over `features`, skipping non-finite entries per feature. */
function meanVector(
  vectors: readonly FeatureVector[],
  features: readonly string[],
): FeatureVector {
  const out: FeatureVector = {};
  for (const f of features) {
    let sum = 0;
    let n = 0;
    for (const v of vectors) {
      const x = v[f];
      if (!Number.isFinite(x)) continue;
      sum += x;
      n += 1;
    }
    out[f] = n === 0 ? 0 : sum / n;
  }
  return out;
}

export interface TrainOptions {
  /**
   * Vectors from the REST step. Their spread sets the reject radius: whatever distance
   * the player's own resting state wanders over is, by demonstration, "not a category".
   */
  restVectors?: readonly FeatureVector[];
  /** Multiplier on the demonstrated rest spread. Larger = more forgiving. */
  rejectScale?: number;
  /** Fallback reject radius when no rest demonstration was given. */
  defaultRejectRadius?: number;
  /**
   * Fraction of the TRAINING points the reject radius must accept. The model is not
   * allowed to be tighter than this, whatever the rest take says — see `trainModel`.
   */
  acceptQuantile?: number;
}

const TRAIN_DEFAULTS = { rejectScale: 2.5, defaultRejectRadius: 0.6, acceptQuantile: 0.9 };

/**
 * Build a {@link TrainedModel} from clustered still-points.
 *
 * `clusters` is the output of `cutAt` — arrays of indices into `vectors`. Empty clusters
 * are dropped rather than kept as degenerate categories.
 */
export function trainModel(
  vectors: readonly FeatureVector[],
  clusters: readonly (readonly number[])[],
  features: readonly string[],
  weights: FeatureWeights,
  options: TrainOptions = {},
): TrainedModel {
  const o = { ...TRAIN_DEFAULTS, ...options };
  const categories: Category[] = [];
  clusters.forEach((idxs, i) => {
    if (idxs.length === 0) return;
    const members = idxs.map((j) => vectors[j]);
    const centroid = meanVector(members, features);
    const radius =
      members.reduce((s, m) => s + weightedDistance(m, centroid, features, weights), 0) /
      members.length;
    categories.push({
      id: `cat-${i + 1}`,
      label: '',
      centroid,
      size: idxs.length,
      radius,
    });
  });

  let rejectRadius = o.defaultRejectRadius;
  const rest = options.restVectors ?? [];
  if (rest.length >= 5) {
    const restCentroid = meanVector(rest, features);
    const spread =
      rest.reduce((s, v) => s + weightedDistance(v, restCentroid, features, weights), 0) /
      rest.length;
    rejectRadius = Math.max(spread * o.rejectScale, 1e-3);
  }

  // A model must never reject the data it was trained on. A rest take that was genuinely
  // still gives a spread near zero, and a reject radius derived from it alone would throw
  // out most of the player's own vocabulary the moment they used it — the model would be
  // born unable to recognise itself, which reads to a player as "the trainer did nothing".
  // So floor the radius at the distance that accepts `acceptQuantile` of the training
  // points. Flooring on the TIGHTEST category radius (the obvious guess) does not work:
  // it is unrelated to how far the broadest category's members actually sit.
  const memberDistances: number[] = [];
  clusters.forEach((idxs, i) => {
    const c = categories.find((x) => x.id === `cat-${i + 1}`);
    if (!c) return;
    for (const j of idxs) memberDistances.push(weightedDistance(vectors[j], c.centroid, features, weights));
  });
  if (memberDistances.length > 0) {
    memberDistances.sort((a, b) => a - b);
    const q = Math.min(
      memberDistances.length - 1,
      Math.floor(o.acceptQuantile * (memberDistances.length - 1)),
    );
    rejectRadius = Math.max(rejectRadius, memberDistances[q] * 1.05);
  }

  return { categories, weights, features: [...features], rejectRadius };
}

export interface ClassifyOptions {
  /**
   * Softness of the membership distribution. Smaller = sharper (closer to one-hot),
   * larger = smoother blending between neighbouring categories.
   */
  temperature?: number;
}

const CLASSIFY_DEFAULTS = { temperature: 0.25 };

/**
 * Classify one vector against a model. Pure — no state, no hysteresis; see
 * {@link createCategoryTracker} for the temporal layer.
 */
export function classify(
  model: TrainedModel,
  vector: FeatureVector,
  options: ClassifyOptions = {},
): Classification {
  const o = { ...CLASSIFY_DEFAULTS, ...options };
  const memberships: Record<string, number> = {};
  if (model.categories.length === 0) {
    return { categoryId: null, memberships, distance: Infinity, rejected: true };
  }

  const dists = model.categories.map((c) =>
    weightedDistance(vector, c.centroid, model.features, model.weights),
  );
  let best = 0;
  for (let i = 1; i < dists.length; i++) if (dists[i] < dists[best]) best = i;

  // Softmax over negative distance. Subtracting the minimum first keeps the exponent in
  // range — without it a large distance underflows every term to 0 and the normalization
  // divides by zero, which is how a "smooth" mapping produces NaN and silences the synth.
  const minD = dists[best];
  const exps = dists.map((d) => Math.exp(-(d - minD) / Math.max(1e-6, o.temperature)));
  const total = exps.reduce((a, b) => a + b, 0);
  model.categories.forEach((c, i) => {
    memberships[c.id] = total > 0 ? exps[i] / total : 0;
  });

  const rejected = minD > model.rejectRadius;
  return {
    categoryId: rejected ? null : model.categories[best].id,
    memberships,
    distance: minD,
    rejected,
  };
}

export interface TrackerOptions extends ClassifyOptions {
  /** Consecutive frames a NEW category must win before it takes over. */
  enterFrames?: number;
  /** Consecutive rejected frames before the tracker admits no-man's-land. */
  exitFrames?: number;
  /**
   * Whether no-man's-land HOLDS the previous category (default) or reports null.
   * Holding is the musical default: an instrument that drops out whenever the
   * classifier hesitates is unplayable.
   */
  holdOnReject?: boolean;
}

const TRACKER_DEFAULTS = { enterFrames: 3, exitFrames: 8, holdOnReject: true };

export interface CategoryTracker {
  /** Feed one live vector; returns the stabilized classification. */
  push(vector: FeatureVector): Classification & { held: boolean };
  /** The currently-committed category id. */
  current(): string | null;
  reset(): void;
}

/**
 * The temporal layer over {@link classify}: hysteresis on entry and a longer, separate
 * hysteresis on exit.
 *
 * Asymmetric on purpose. A short `enterFrames` keeps the instrument responsive when the
 * player deliberately changes pose; a longer `exitFrames` means a momentary blink or a
 * hand crossing the face does not evict the category they are holding. Symmetric
 * hysteresis would force one number to serve both, and the right values differ by
 * roughly the ratio you would guess.
 */
export function createCategoryTracker(
  model: TrainedModel,
  options: TrackerOptions = {},
): CategoryTracker {
  const o = { ...TRACKER_DEFAULTS, ...options };
  let committed: string | null = null;
  let candidate: string | null = null;
  let candidateRun = 0;
  let rejectRun = 0;

  return {
    push(vector) {
      const c = classify(model, vector, o);
      if (c.rejected) {
        rejectRun += 1;
        candidate = null;
        candidateRun = 0;
        if (rejectRun >= o.exitFrames) {
          if (!o.holdOnReject) committed = null;
          return { ...c, categoryId: o.holdOnReject ? committed : null, held: o.holdOnReject && committed !== null };
        }
        // Inside the exit hysteresis: keep reporting the committed category.
        return { ...c, categoryId: committed, rejected: false, held: committed !== null };
      }

      rejectRun = 0;
      if (c.categoryId === committed) {
        candidate = null;
        candidateRun = 0;
        return { ...c, held: false };
      }
      if (c.categoryId === candidate) candidateRun += 1;
      else {
        candidate = c.categoryId;
        candidateRun = 1;
      }
      if (candidateRun >= o.enterFrames) {
        committed = candidate;
        candidate = null;
        candidateRun = 0;
        return { ...c, categoryId: committed, held: false };
      }
      // Not yet committed to the new one: keep the old.
      return { ...c, categoryId: committed, held: committed !== null };
    },
    current: () => committed,
    reset() {
      committed = null;
      candidate = null;
      candidateRun = 0;
      rejectRun = 0;
    },
  };
}
