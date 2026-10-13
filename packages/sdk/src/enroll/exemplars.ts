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
import { weightedDistance } from './cluster';
import type { Category, FeatureVector, TrainedModel } from './types';

export interface ExemplarOptions {
  /** How many exemplars to return (at most the category's size). */
  count?: number;
  /** The distance quantile the spread reaches (0..1); see the module doc. */
  edge?: number;
}

export const EXEMPLAR_DEFAULTS = { count: 4, edge: 0.9 } as const;

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

  // Medoid: smallest total distance to the other members; ties to the lower index.
  let medoid = members[0];
  let best = Infinity;
  for (const j of members) {
    let total = 0;
    for (const k of members) if (k !== j) total += dist(vectors[j], vectors[k]);
    if (total < best - 1e-12) {
      best = total;
      medoid = j;
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

/** Exemplars for every category of a model, by category id. */
export function exemplarsByCategory(
  model: TrainedModel,
  vectors: readonly FeatureVector[],
  options: ExemplarOptions = {},
): Record<string, Exemplar[]> {
  return Object.fromEntries(model.categories.map((c) => [c.id, selectExemplars(model, c, vectors, options)]));
}
