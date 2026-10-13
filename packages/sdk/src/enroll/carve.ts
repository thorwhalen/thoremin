/**
 * Carving a session's pool into k categories, in one of the two ways a categorizer can be
 * (#330, the maintainer's point 2), and re-carving at any k without recording again.
 *
 * - **`partition`**: every still-point the player held is carved, a resting face included,
 *   so k counts the neutral face too (expressions + 1). Every face reads as some category.
 * - **`reject`**: the still-points that sit inside the player's own rest cloud are set aside
 *   as NEUTRAL first, and only the rest is carved, so k counts the expressions alone. The
 *   trained model rejects what is far from every category, which is how neutral reads as
 *   "none of these" at play time.
 *
 * Neutral is decided by demonstration, the way the classifier's reject radius is: the rest
 * frames' spread around their own mean, in the session's noise units, times
 * {@link CARVE_DEFAULTS.neutralScale} (the same 2.5 `trainModel` applies to the rest spread).
 * With fewer than {@link CARVE_DEFAULTS.minRestFrames} rest frames nothing is set aside and
 * the carver says so (`neutralKnown: false`), rather than guessing a radius.
 *
 * The hierarchy over the carved points is built once per carver; `modelAt(k)` is a cut and a
 * `modelFor`, cheap enough for a slider. Modality-free: a hand session carves the same way.
 */
import { buildHierarchy, cutAt, suggestK, weightedDistance } from './cluster';
import type { CategorizerMode } from './categorizer';
import type { Session } from './session';
import type { FeatureVector, TrainedModel } from './types';

export const CARVE_DEFAULTS = {
  /** Multiplier on the rest spread that bounds "neutral" (matches `trainModel`'s rejectScale). */
  neutralScale: 2.5,
  /** Fewer rest frames than this and no point is called neutral. */
  minRestFrames: 5,
  /** The largest k `suggestedK` proposes. */
  maxSuggestedK: 8,
} as const;

export interface CarveOptions {
  mode: CategorizerMode;
  /** The rest (baseline) frames, raw: what "neutral" is, by demonstration. */
  restVectors?: readonly FeatureVector[];
  neutralScale?: number;
  minRestFrames?: number;
  maxSuggestedK?: number;
}

/** What a carver needs of a built session. */
export type CarvableSession = Pick<Session, 'points' | 'features' | 'weights' | 'modelFor'>;

export interface Carver {
  readonly mode: CategorizerMode;
  /** Indices into `session.points()` set aside as neutral (always empty in `partition`). */
  readonly neutral: readonly number[];
  /** Indices into `session.points()` that are carved. */
  readonly carved: readonly number[];
  /** Whether there was a rest take to decide neutral by (`reject` only; true in `partition`). */
  readonly neutralKnown: boolean;
  /** The k the merge gaps suggest, over the carved points (0 when nothing is carved). A suggestion. */
  suggestedK(): number;
  /** The largest k there is: the number of carved points. */
  maxK(): number;
  /** The model at `k` (clamped to 1..maxK). Ids are `cat-1..cat-k`; members index the session's points. */
  modelAt(k: number): TrainedModel;
}

function mean(vectors: readonly FeatureVector[], features: readonly string[]): FeatureVector {
  const out: FeatureVector = {};
  for (const f of features) {
    let s = 0;
    let n = 0;
    for (const v of vectors) {
      const x = v[f];
      if (Number.isFinite(x)) {
        s += x;
        n++;
      }
    }
    if (n > 0) out[f] = s / n;
  }
  return out;
}

/**
 * The indices of `vectors` inside the rest cloud: within `scale` times the rest frames' mean
 * distance from their own centroid, under `features`/`weights`. `null` when there are too few
 * rest frames to say.
 */
export function neutralIndices(
  vectors: readonly FeatureVector[],
  restVectors: readonly FeatureVector[],
  features: readonly string[],
  weights: Readonly<Record<string, number>>,
  { scale = CARVE_DEFAULTS.neutralScale, minRestFrames = CARVE_DEFAULTS.minRestFrames }: { scale?: number; minRestFrames?: number } = {},
): number[] | null {
  if (restVectors.length < minRestFrames || features.length === 0) return null;
  const centroid = mean(restVectors, features);
  const w = weights as Record<string, number>;
  const spread = restVectors.reduce((s, v) => s + weightedDistance(v, centroid, features, w), 0) / restVectors.length;
  const radius = Math.max(spread * scale, 1e-3);
  const out: number[] = [];
  vectors.forEach((v, i) => {
    if (weightedDistance(v, centroid, features, w) <= radius) out.push(i);
  });
  return out;
}

/** A carver over a BUILT session (`session.build()` has run). */
export function createCarver(session: CarvableSession, options: CarveOptions): Carver {
  const o = { ...CARVE_DEFAULTS, ...options };
  const vectors = session.points().map((p) => p.vector);
  const features = session.features();
  const weights = session.weights();

  let neutral: number[] = [];
  let neutralKnown = true;
  if (o.mode === 'reject') {
    const found = neutralIndices(vectors, o.restVectors ?? [], features, weights, { scale: o.neutralScale, minRestFrames: o.minRestFrames });
    neutralKnown = found !== null;
    neutral = found ?? [];
  }
  const isNeutral = new Set(neutral);
  const carved = vectors.map((_, i) => i).filter((i) => !isNeutral.has(i));
  const hierarchy = buildHierarchy(
    carved.map((i) => vectors[i]),
    features,
    weights,
  );

  return {
    mode: o.mode,
    neutral,
    carved,
    neutralKnown,
    suggestedK: () => (carved.length === 0 ? 0 : suggestK(hierarchy, { max: o.maxSuggestedK })),
    maxK: () => carved.length,
    modelAt(k) {
      if (carved.length === 0) return session.modelFor([]);
      const kk = Math.min(carved.length, Math.max(1, Math.round(Number.isFinite(k) ? k : 1)));
      return session.modelFor(cutAt(hierarchy, kk).map((cluster) => cluster.map((j) => carved[j])));
    },
  };
}
