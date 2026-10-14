/**
 * Which held poses show a category best (#330): the frames a player sees for each
 * category before naming it.
 *
 * ## Medoid first, then a spread toward the edge
 *
 * The first exemplar is the MEDOID: the member with the smallest total distance to the
 * other members. Not the member nearest the centroid: a centroid is a mean, and the mean
 * of a broad category can sit between two sub-poses no frame actually shows, while the
 * medoid is always a real, typical held pose.
 *
 * Exact is quadratic in the category's size, so past {@link EXEMPLAR_DEFAULTS}`.exactUpTo`
 * members the medoid is estimated (#398): every member's total distance is taken against an
 * evenly strided subsample of `references` members (the same members every run, in member
 * order), which is linear in the size, and the smallest total wins. A category that small
 * shows no difference; a larger one gets a typical member, not necessarily the exact medoid.
 *
 * The rest are chosen to show the category's EXTENT, not to repeat its centre: members
 * sorted by distance from the centroid, sampled at evenly spaced ranks from just past the
 * centre to `edge` (a quantile, 0.9 by default). The most eccentric few percent are left
 * out by that quantile on purpose: the far tail of a category is where a mis-held or
 * half-transitioned frame lands, and showing it as "what this category looks like" would
 * mislead the player about what they are naming.
 *
 * Distances are the model's weighted distances, so with a session-trained model (weights
 * folded with 1/sigma) they are in NOISE UNITS (`noise.ts`): "3.2" means three noise-widths
 * from the centre, for every feature alike.
 *
 * Pure, over indices: the host maps an index to a still-point's time and grabs the frame.
 */
import { pointDistance, weightedDistance } from './cluster';
import type { Category, FeatureVector, TrainedModel } from './types';

export interface ExemplarOptions {
  /** How many exemplars to return (at most the category's size). */
  count?: number;
  /** The distance quantile the spread reaches (0..1); see the module doc. */
  edge?: number;
  /** The largest category whose medoid is exact (all pairs); a larger one is estimated. */
  exactUpTo?: number;
  /** How many members an estimated medoid is measured against. */
  references?: number;
}

export const EXEMPLAR_DEFAULTS = { count: 4, edge: 0.9, exactUpTo: 300, references: 64 } as const;

export interface Exemplar {
  /** Index into the vectors the category's `members` index. */
  index: number;
  /** Weighted distance from the category's centroid (noise units for a session model). */
  distance: number;
  /** `medoid` for the first, `spread` for the rest. */
  role: 'medoid' | 'spread';
}

/**
 * The exemplars of one category: its medoid, then members at increasing distance from
 * its centroid. `vectors` is the pool `category.members` indexes (the session's still-
 * points, or a categorizer's samples).
 */
export function selectExemplars(
  model: Pick<TrainedModel, 'features' | 'weights'>,
  category: Pick<Category, 'centroid' | 'members'>,
  vectors: readonly FeatureVector[],
  options: ExemplarOptions = {},
): Exemplar[] {
  const finiteOr = (x: number | undefined, d: number) => (x !== undefined && Number.isFinite(x) ? x : d);
  const count = Math.max(0, Math.floor(finiteOr(options.count, EXEMPLAR_DEFAULTS.count)));
  const edge = Math.min(1, Math.max(0, finiteOr(options.edge, EXEMPLAR_DEFAULTS.edge)));
  const members = category.members.filter((j) => vectors[j] !== undefined);
  if (count === 0 || members.length === 0) return [];
  const dist = (a: FeatureVector, b: FeatureVector) => weightedDistance(a, b, model.features, model.weights);
  const fromCentre = new Map(members.map((j) => [j, dist(vectors[j], category.centroid)]));

  // Medoid: smallest total distance to the other members; ties to the lower index. Each pair
  // is measured once (the distance is symmetric bit for bit) and summed in member order (#420).
  // Past `exactUpTo` members it is estimated against a strided subsample instead (#398).
  const L = members.length;
  const between = pointDistance(members.map((j) => vectors[j]), model.features, model.weights);
  const exactUpTo = Math.max(0, Math.floor(finiteOr(options.exactUpTo, EXEMPLAR_DEFAULTS.exactUpTo)));
  const references = Math.max(1, Math.floor(finiteOr(options.references, EXEMPLAR_DEFAULTS.references)));
  const totals = L <= exactUpTo ? exactTotals(L, between) : sampledTotals(L, between, references);
  let medoid = members[0];
  let best = Infinity;
  for (let a = 0; a < L; a++) {
    if (totals[a] < best - 1e-12) {
      best = totals[a];
      medoid = members[a];
    }
  }
  const out: Exemplar[] = [{ index: medoid, distance: fromCentre.get(medoid)!, role: 'medoid' }];

  // The others by distance from the centre (ties to the lower index), medoid excluded.
  const rest = members
    .filter((j) => j !== medoid)
    .sort((a, b) => fromCentre.get(a)! - fromCentre.get(b)! || a - b);
  const want = Math.min(count - 1, rest.length);
  if (want <= 0) return out;
  // Evenly spaced ranks from just past the centre (`lo`) to the `edge` quantile (`last`).
  // `last - lo >= want - 1`, so the rounded ranks strictly increase: no member twice.
  const last = Math.max(want - 1, Math.round(edge * (rest.length - 1)));
  const lo = Math.min(last - (want - 1), Math.round(last / want));
  for (let s = 0; s < want; s++) {
    const r = want === 1 ? last : lo + Math.round((s * (last - lo)) / (want - 1));
    const j = rest[r];
    out.push({ index: j, distance: fromCentre.get(j)!, role: 'spread' });
  }
  return out;
}

/** Each member's total distance to every other member (all pairs, each measured once). */
function exactTotals(L: number, between: (a: number, b: number) => number): Float64Array {
  const pair = new Float64Array(L * L);
  for (let a = 0; a < L; a++) {
    for (let b = a + 1; b < L; b++) {
      const d = between(a, b);
      pair[a * L + b] = d;
      pair[b * L + a] = d;
    }
  }
  const totals = new Float64Array(L);
  for (let a = 0; a < L; a++) {
    let total = 0;
    for (let b = 0; b < L; b++) if (b !== a) total += pair[a * L + b];
    totals[a] = total;
  }
  return totals;
}

/** Each member's total distance to `references` evenly strided members (itself contributes 0). */
function sampledTotals(L: number, between: (a: number, b: number) => number, references: number): Float64Array {
  const refs = Array.from({ length: Math.min(references, L) }, (_, i) => Math.floor((i * L) / Math.min(references, L)));
  const totals = new Float64Array(L);
  for (let a = 0; a < L; a++) {
    let total = 0;
    for (const r of refs) if (r !== a) total += between(a, r);
    totals[a] = total;
  }
  return totals;
}

/** Exemplars for every category of a model, by category id. */
export function exemplarsByCategory(
  model: TrainedModel,
  vectors: readonly FeatureVector[],
  options: ExemplarOptions = {},
): Record<string, Exemplar[]> {
  return Object.fromEntries(model.categories.map((c) => [c.id, selectExemplars(model, c, vectors, options)]));
}
