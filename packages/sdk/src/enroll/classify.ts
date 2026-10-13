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
 * the player scratches their nose. The reject radius comes from the baseline cue —
 * "this is what nothing looks like" — rather than a magic constant, because the open-set
 * literature's consistent finding is that thresholds are task-specific and tuning is the
 * crucial part.
 *
 * **3. Rejection is hysteretic, and it HOLDS rather than silences.** Entering no-man's-
 * land is harder than staying in a category (the same dwell/hysteresis pattern this repo
 * already uses for handedness and expression), and the classifier reports the last good
 * category while unsure. An instrument that drops to silence whenever the classifier
 * hesitates is unplayable — silence is the host's decision to make explicitly, not a
 * side effect of an uncertain frame.
 *
 * **4. Neutral is a class the player teaches, and it does not hold (#385 E5).** "This face
 * means nothing" is said by example: the holds in a categorizer's Neutral bin are trained as
 * prototypes of a null class ({@link trainNeutral}), and a vector nearest one of them reads as
 * no category. That is a reading, not a hesitation, so the tracker treats it as a class like
 * any other (entry hysteresis, then null), never as a rejection to hold through. The reject
 * radius stays what it was: the open-set rule for a face nobody taught.
 */
import { buildHierarchy, cutAt, weightedDistance } from './cluster';
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
   * Vectors from the BASELINE (rest) cue. Their spread sets the reject radius: whatever
   * distance the player's own resting state wanders over is, by demonstration, "not a
   * category".
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

/** What `trainModel` uses when not told otherwise (a re-cut with no rest take starts from the
 *  same default reject radius, #385 E4). */
export const TRAIN_DEFAULTS = { rejectScale: 2.5, defaultRejectRadius: 0.6, acceptQuantile: 0.9 };

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
      members: [...idxs].sort((a, b) => a - b),
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

/** How {@link trainNeutral} shapes the null class. */
export const NEUTRAL_DEFAULTS = {
  /** The most prototypes the null class is split into. */
  maxPrototypes: 4,
  /** Two groups of Neutral holds are kept apart when they merge farther apart than this many
   *  times the median category radius: farther apart than a category is wide, they are two
   *  different "nothings" (a resting face, a look at the keyboard), and one centroid between
   *  them would sit where neither is. */
  splitScale: 2,
  /** ...and never closer than this (noise units, as a session's distances are): categories of
   *  one hold each have radius 0, which would otherwise split even a tight cloud. */
  minSplitHeight: 1,
  /** The split is decided on at most this many Neutral holds, evenly strided (the hierarchy is
   *  cubic in them); every hold then joins its nearest group. So the cost is bounded and one
   *  more hold never changes the shape of the class. */
  splitSample: 120,
  /** A group with fewer holds than this, or than {@link minShare} of Neutral, is folded into
   *  the nearest larger one: a single face dragged into Neutral by mistake must not become a
   *  prototype of its own, which would silence every face nearer to it than to its category. */
  minHolds: 2,
  minShare: 0.1,
} as const;

export interface NeutralOptions {
  maxPrototypes?: number;
  splitScale?: number;
  minSplitHeight?: number;
  splitSample?: number;
  minHolds?: number;
  minShare?: number;
}

/**
 * The taught null class: the Neutral holds `idxs` (into `vectors`) as up to
 * {@link NEUTRAL_DEFAULTS.maxPrototypes} prototypes, split where the holds sit farther apart
 * than the `categories` are wide, with no prototype made of a stray hold or two. Ids
 * `neutral-1..n`, ordered by their first member; empty when `idxs` is.
 */
export function trainNeutral(
  vectors: readonly FeatureVector[],
  idxs: readonly number[],
  features: readonly string[],
  weights: FeatureWeights,
  categories: readonly Pick<Category, 'radius'>[],
  options: NeutralOptions = {},
): Category[] {
  const o = { ...NEUTRAL_DEFAULTS, ...options };
  if (idxs.length === 0) return [];
  const dist = (a: FeatureVector, b: FeatureVector) => weightedDistance(a, b, features, weights);
  let groups: number[][] = [[...idxs]];
  const smallest = Math.max(o.minHolds, Math.ceil(o.minShare * idxs.length));
  if (idxs.length >= 2 * smallest && categories.length > 0 && o.maxPrototypes > 1) {
    const radii = categories.map((c) => c.radius).sort((a, b) => a - b);
    const height = Math.max(o.minSplitHeight, o.splitScale * radii[Math.floor((radii.length - 1) / 2)]);
    const stride = Math.max(1, idxs.length / Math.max(1, o.splitSample));
    const sample = Array.from({ length: Math.min(idxs.length, o.splitSample) }, (_, i) => idxs[Math.floor(i * stride)]);
    const hierarchy = buildHierarchy(sample.map((j) => vectors[j]), features, weights);
    // Cutting at `height` leaves one cluster per merge above it (heights are ascending).
    const k = Math.min(o.maxPrototypes, 1 + hierarchy.heights.filter((h) => h > height).length);
    if (k > 1) {
      let centres = cutAt(hierarchy, k).map((g) => meanVector(g.map((j) => vectors[sample[j]]), features));
      // Every hold joins its nearest group; then groups too small to be a "nothing" of their own
      // are folded into the nearest remaining one, until every group is big enough.
      for (;;) {
        const assigned: number[][] = centres.map(() => []);
        for (const j of idxs) {
          let best = 0;
          for (let c = 1; c < centres.length; c++) if (dist(vectors[j], centres[c]) < dist(vectors[j], centres[best])) best = c;
          assigned[best].push(j);
        }
        const sizes = assigned.map((g) => g.length);
        const worst = sizes.indexOf(Math.min(...sizes));
        if (centres.length === 1 || sizes[worst] >= smallest) {
          groups = assigned.filter((g) => g.length > 0);
          break;
        }
        centres = centres.filter((_, c) => c !== worst);
      }
    }
  }
  return groups
    .map((g) => [...g].sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0])
    .map((members, i) => {
      const centroid = meanVector(members.map((j) => vectors[j]), features);
      const radius = members.reduce((acc, j) => acc + dist(vectors[j], centroid), 0) / members.length;
      return { id: `neutral-${i + 1}`, label: '', centroid, size: members.length, radius, members };
    });
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
  const minD = dists[best];
  const neutral = model.neutral ?? [];
  const nDists = neutral.map((c) => weightedDistance(vector, c.centroid, model.features, model.weights));
  const minN = nDists.reduce((a, d) => Math.min(a, d), Infinity);

  // Softmax over negative distance. Subtracting the minimum first keeps the exponent in
  // range — without it a large distance underflows every term to 0 and the normalization
  // divides by zero, which is how a "smooth" mapping produces NaN and silences the synth.
  // The Neutral prototypes take their share of the mass, so a resting face leaves every
  // category's membership low rather than spreading 1 across them.
  const floor = Math.min(minD, minN);
  const temperature = Math.max(1e-6, o.temperature);
  const exps = dists.map((d) => Math.exp(-(d - floor) / temperature));
  const nExps = nDists.map((d) => Math.exp(-(d - floor) / temperature));
  const total = exps.reduce((a, b) => a + b, 0) + nExps.reduce((a, b) => a + b, 0);
  model.categories.forEach((c, i) => {
    memberships[c.id] = total > 0 ? exps[i] / total : 0;
  });

  if (neutral.length > 0) {
    const neutralMembership = total > 0 ? nExps.reduce((a, b) => a + b, 0) / total : 0;
    // Strictly nearer: a tie goes to the category, as a tie between categories goes to the first.
    if (minN < minD) return { categoryId: null, memberships, distance: minD, rejected: false, neutral: true, neutralMembership };
    const rejected = minD > model.rejectRadius;
    return { categoryId: rejected ? null : model.categories[best].id, memberships, distance: minD, rejected, neutral: false, neutralMembership };
  }
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

/** The tracker's candidate key for the taught Neutral class (never a category id). */
const NEUTRAL_CANDIDATE: unique symbol = Symbol('neutral');

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
  // A candidate is a category id, or the taught Neutral class (which commits as null).
  let candidate: string | typeof NEUTRAL_CANDIDATE | null = null;
  let candidateRun = 0;
  let rejectRun = 0;

  return {
    push(vector) {
      const c = classify(model, vector, o);
      if (c.rejected) {
        rejectRun += 1;
        // A rejected frame does not interrupt a run toward Neutral: both are "none of these",
        // so a face alternating between them still leaves its category.
        if (candidate !== NEUTRAL_CANDIDATE) {
          candidate = null;
          candidateRun = 0;
        }
        if (rejectRun >= o.exitFrames) {
          if (!o.holdOnReject) committed = null;
          return { ...c, categoryId: o.holdOnReject ? committed : null, held: o.holdOnReject && committed !== null };
        }
        // Inside the exit hysteresis: keep reporting the committed category.
        return { ...c, categoryId: committed, rejected: false, held: committed !== null };
      }

      // A Neutral frame does not reset the run toward rejection either (see above).
      if (!c.neutral) rejectRun = 0;
      // The taught Neutral class is a reading like a category's: it is entered through the same
      // hysteresis and commits as null (nothing), and it is never held through.
      const key = c.neutral ? NEUTRAL_CANDIDATE : c.categoryId;
      if (c.neutral ? committed === null : key === committed) {
        candidate = null;
        candidateRun = 0;
        return { ...c, held: false };
      }
      if (key === candidate) candidateRun += 1;
      else {
        candidate = key;
        candidateRun = 1;
      }
      if (candidateRun >= o.enterFrames) {
        committed = candidate === NEUTRAL_CANDIDATE ? null : candidate;
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
