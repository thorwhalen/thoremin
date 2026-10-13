/**
 * A model from a model (#330): retrain on your own face starting from an existing
 * categorizer, which is faster than starting from nothing, and carry its names across.
 *
 * Two paths, because they answer two different situations:
 *
 * - **Merge** ({@link mergeSession}): the player keeps the existing categories and adds a
 *   short new session. Each new held pose joins its nearest category, the centroids move
 *   toward where the new poses actually are, and the poses are re-assigned against the
 *   moved centroids, a few times (a deterministic k-means refinement seeded by the existing
 *   model; categories never appear or disappear). Ids and labels are kept, so bindings keyed
 *   by id keep working with no carrying at all. What the existing model contributes is the
 *   `seed`:
 *   - `samples` (default): every stored sample stays a member. Right for MORE data from the
 *     same player: the new session refines the old one.
 *   - `centroids`: each category contributes only its centroid, as one sample marked with
 *     cue {@link SEED_CUE}. Right when the model came from SOMEONE ELSE and does not transfer
 *     (the case #330 names): the new player's poses dominate within a pass, and the old
 *     model only says which category is which. A category the new session never reached
 *     keeps its seed centroid, so it is not lost. Every other stored sample is dropped,
 *     including ones in no category: a someone-else model's evidence is not the player's.
 * - **From scratch, names carried** ({@link carryLabels}): the player re-records and
 *   re-carves, and the new categories are named after the old ones by a one-to-one
 *   assignment on centroid distance (the label matcher, `match.ts`, with the old names as
 *   the label pool). Bindings then follow the names through `carryBindings` (`bind.ts`).
 *
 * In `reject` mode a new pose beyond the reject radius of every category joins none: it is
 * kept as a sample (evidence the player gave) but belongs to no category. The merged
 * categorizer's reject radius is the existing one, raised if needed so the model still
 * accepts its own members (the `trainModel` floor), never lowered.
 */
import { trainModel } from './classify';
import { weightedDistance } from './cluster';
import {
  NO_REJECT_RADIUS,
  PersonalCategorizerSchema,
  toSample,
  type CategorizerSample,
  type PersonalCategorizer,
} from './categorizer';
import { matchLabels, type LabelMatch } from './match';
import type { FeatureVector, StillPoint, TrainedModel } from './types';

/** The cue of a sample that stands for a seed model's category centroid. */
export const SEED_CUE = 'seed';

export interface MergeOptions {
  /** What the existing categorizer contributes; see the module doc. */
  seed?: 'samples' | 'centroids';
  /** Assignment passes at most (stops early once nothing moves). */
  iterations?: number;
  /** The merged categorizer's name (default: the base's). */
  name?: string;
}

export const MERGE_DEFAULTS = { seed: 'samples', iterations: 5 } as const;

export interface MergeResult {
  categorizer: PersonalCategorizer;
  /** Per new point: the index (into `categories`) of the category it joined, or -1. */
  assigned: number[];
  /** Ids of the categories no new point joined. */
  untouched: string[];
  /** Assignment passes run. */
  passes: number;
  /** True when the last pass moved nothing: every new pose sits in the category whose
   *  merged centroid is nearest (or beyond the reject radius of all). False when the
   *  `iterations` cap stopped it first. */
  converged: boolean;
}

/** Mean over `features` of the finite values of `vectors`; a feature with none is left out. */
function centroidOf(vectors: readonly FeatureVector[], features: readonly string[]): FeatureVector {
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
    if (n > 0) out[f] = sum / n;
  }
  return out;
}

/**
 * Merge a new session's held poses into an existing categorizer. The base is not modified.
 * Distances use the base's feature space and weights (one unit system for old and new).
 */
export function mergeSession(
  base: PersonalCategorizer,
  points: readonly Pick<StillPoint, 'vector' | 't' | 'cue'>[],
  options: MergeOptions = {},
): MergeResult {
  const seed = options.seed ?? MERGE_DEFAULTS.seed;
  const iterations = Math.max(1, Math.floor(options.iterations ?? MERGE_DEFAULTS.iterations));
  const valid = PersonalCategorizerSchema.parse(base);
  const { features, weights } = valid;
  const dist = (a: FeatureVector, b: FeatureVector) => weightedDistance(a, b, features, weights);

  // One centroid convention throughout (a feature no member has is left OUT, not filled
  // with 0), so the first pass and the later ones measure the same way, and a seed
  // centroid never stores a 0 the player never showed.
  const baseCentroids = valid.categories.map((c) => centroidOf(c.members.map((j) => valid.samples[j].vector), features));
  // The fixed part of each category: its stored samples, or its centroid as one sample.
  const baseSamples: CategorizerSample[] =
    seed === 'samples' ? valid.samples.map((s) => ({ ...s, vector: { ...s.vector } })) : baseCentroids.map((c) => toSample({ vector: c, t: 0, cue: SEED_CUE }));
  const anchors: number[][] = seed === 'samples' ? valid.categories.map((c) => [...c.members]) : valid.categories.map((_, i) => [i]);
  const fresh = points.map(toSample);
  const reject = valid.mode === 'reject' ? valid.rejectRadius! : Infinity;

  let centroids = baseCentroids;
  let assigned = fresh.map(() => -1);
  let passes = 0;
  let converged = false;
  while (passes < iterations) {
    const next = fresh.map((p) => {
      let best = -1;
      let bestD = Infinity;
      centroids.forEach((c, i) => {
        const d = dist(p.vector, c);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return bestD <= reject ? best : -1;
    });
    const moved = passes === 0 || next.some((a, i) => a !== assigned[i]);
    passes += 1;
    if (!moved) {
      converged = true; // the centroids below are already those of this assignment
      break;
    }
    assigned = next;
    centroids = anchors.map((idx, i) =>
      centroidOf([...idx.map((j) => baseSamples[j].vector), ...fresh.filter((_, p) => assigned[p] === i).map((p) => p.vector)], features),
    );
  }

  const offset = baseSamples.length;
  const members = anchors.map((idx, i) => [...idx, ...assigned.flatMap((a, p) => (a === i ? [offset + p] : []))].sort((a, b) => a - b));
  const samples = [...baseSamples, ...fresh];
  let rejectRadius: number | undefined;
  if (valid.mode === 'reject') {
    // Never lower the tuned radius; raise it if the merged members need it (the floor).
    const floor = trainModel(
      samples.map((s) => s.vector),
      members,
      features,
      weights,
      { defaultRejectRadius: valid.rejectRadius },
    ).rejectRadius;
    rejectRadius = Math.max(valid.rejectRadius!, floor);
  }
  const categorizer = PersonalCategorizerSchema.parse({
    ...valid,
    name: options.name ?? valid.name,
    samples,
    categories: valid.categories.map((c, i) => ({ ...c, members: members[i] })),
    ...(rejectRadius !== undefined ? { rejectRadius } : {}),
  });
  const untouched = valid.categories.filter((_, i) => !assigned.includes(i)).map((c) => c.id);
  return { categorizer, assigned, untouched, passes, converged };
}

export interface CarryLabelsOptions {
  /** A new category takes an old name only if their centroids are within this distance
   *  (in the NEW model's units). Default: the new model's reject radius, or unbounded in
   *  partition mode. */
  maxDistance?: number;
  /** Name for a new category no old one matches, by position. */
  fallback?: (index: number) => string;
}

/**
 * Name the categories of a freshly trained model after an old model's, one-to-one, by
 * nearest centroid (the old names are the label pool, the score falls with distance).
 * Categories the player already named keep their names. Returns the matches; apply them
 * with `applyLabels`, then carry bindings by name with `carryBindings`.
 */
export function carryLabels(
  from: Pick<TrainedModel, 'categories'>,
  to: Pick<TrainedModel, 'categories' | 'features' | 'weights' | 'rejectRadius'>,
  options: CarryLabelsOptions = {},
): LabelMatch[] {
  const named = from.categories.filter((c) => c.label.trim());
  const maxDistance = options.maxDistance ?? (to.rejectRadius >= NO_REJECT_RADIUS ? Infinity : to.rejectRadius);
  // Similarity in (0, 1]: 1 at the same centroid. A label with a duplicated old name is
  // scored by its nearest bearer.
  const similarity = (d: number) => 1 / (1 + d);
  return matchLabels(to.categories, {
    labels: named.map((c) => c.label.trim()),
    score: (centroid) => {
      // A Map, not a `{}`: an old name such as `constructor` would read as present (#338).
      const out = new Map<string, number>();
      for (const c of named) {
        const s = similarity(weightedDistance(centroid, c.centroid, to.features, to.weights));
        const l = c.label.trim();
        out.set(l, Math.max(out.get(l) ?? 0, s));
      }
      return Object.fromEntries(out);
    },
    minScore: Number.isFinite(maxDistance) ? similarity(maxDistance) : Number.MIN_VALUE,
    ...(options.fallback ? { fallback: options.fallback } : {}),
  });
}
