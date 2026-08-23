/**
 * The projection view's maths (#163 §7-§8) — lay the still-points out in 2-D, and keep a
 * live cursor in the SAME layout.
 *
 * ## Why UMAP, and why one path
 *
 * t-SNE is non-parametric: it has no out-of-sample transform, so placing a live point
 * means re-running it (or training a parametric variant). UMAP does have one —
 * `umap-js` exposes `fit(data)` and then `transform(newData)` into the same embedding.
 * So the offline layout of the recorded take and the live cursor are one mechanism:
 *
 * 1. **Offline**: `fit()` the take's still-points → a 2-D layout.
 * 2. **Live**: `transform()` the current feature vector each poll → the cursor, in
 *    the same embedding. The same code, not a rewrite.
 *
 * `transform()` runs at human frequency (the trainer's ~30 Hz poll, never the
 * audio/tick path) and is never awaited in a tick.
 *
 * ## The inputs are the model's distances
 *
 * UMAP is fed the take re-expressed in the model's own metric — the chosen features,
 * each multiplied by its weight (noise units × nuisance down-weighting) — so what is
 * close in the picture is what the classifier calls close. Raw units would put head
 * pose (degrees) on a scale of its own and the picture would lie.
 *
 * ## Determinism
 *
 * umap-js takes a `random` source; with the seeded one here the layout of a given take
 * is reproducible, which is what makes the tests possible and keeps a re-fit from
 * shuffling the picture under a player's selection.
 *
 * ## Categories are NOT computed here
 *
 * A label selects POINTS; the category's centroid is computed over their original
 * vectors in full feature space by `Session.modelFor(clusters)`. A 2-D centroid would
 * be meaningless to the classifier — this is the single easiest thing to get wrong
 * (#163 §8) and this module deliberately has no way to do it.
 *
 * License: umap-js is Apache-2.0 (the LICENSE file in the package — the npm field
 * says MIT; the file wins), a JavaScript reimplementation of UMAP (BSD-3) by Google;
 * its dependency ml-levenberg-marquardt is MIT. All permissive.
 */
import { UMAP } from 'umap-js';
import type { FeatureVector, FeatureWeights, StillPoint } from './types';

export type Point2 = [number, number];

export interface ProjectionOptions {
  /** UMAP's neighbourhood size. Clamped to `n - 1`. */
  nNeighbors?: number;
  minDist?: number;
  /** Seed for the deterministic random source. */
  seed?: number;
  /** Optimisation epochs; fewer is faster and coarser. */
  nEpochs?: number;
}

/**
 * `nEpochs` MUST be a multiple of 3. umap-js runs `transform()` for `nEpochs / 3`
 * epochs and stops when its integer epoch counter EQUALS that number — a value that is
 * not a whole number is never reached and `transform()` spins forever, synchronously,
 * in the page. (Found the hard way: 200 hung; 300 runs 100.) {@link fitProjection}
 * rounds any caller-supplied value up to a multiple of 3 for the same reason.
 */
const DEFAULTS = { nNeighbors: 15, minDist: 0.1, seed: 17, nEpochs: 300 };

/** Round `n` up to a multiple of 3 (see the note on `nEpochs`). */
export function safeEpochs(n: number): number {
  const k = Math.max(3, Math.ceil(n));
  return k % 3 === 0 ? k : k + (3 - (k % 3));
}

/** The smallest take a projection is attempted for (UMAP needs a neighbourhood). */
export const MIN_POINTS_FOR_PROJECTION = 5;

export interface Projection {
  /** One [x, y] per still-point, in the order given to `fitProjection`. */
  layout: Point2[];
  /** The layout's bounding box, for a view to map into pixels. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  /** Place a live vector in the same embedding. */
  transform(vector: FeatureVector): Point2;
}

/** A small, fast, seeded PRNG (mulberry32) — umap-js's `random` must be in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A vector in the model's metric: the chosen features, weighted; missing → 0. */
export function toMetricRow(vector: FeatureVector, features: readonly string[], weights: FeatureWeights): number[] {
  return features.map((f) => {
    const x = vector[f];
    return Number.isFinite(x) ? x * (weights[f] ?? 1) : 0;
  });
}

/**
 * Fit the layout. Throws when there are fewer than {@link MIN_POINTS_FOR_PROJECTION}
 * points or no features — a view must check first and say so, not draw nothing.
 */
export function fitProjection(
  points: readonly StillPoint[],
  features: readonly string[],
  weights: FeatureWeights,
  options: ProjectionOptions = {},
): Projection {
  const o = { ...DEFAULTS, ...options };
  if (points.length < MIN_POINTS_FOR_PROJECTION) {
    throw new Error(`projection: need at least ${MIN_POINTS_FOR_PROJECTION} held poses, have ${points.length}`);
  }
  if (features.length === 0) throw new Error('projection: the model has no features — build() first');
  const rows = points.map((p) => toMetricRow(p.vector, features, weights));
  // umap-js's transform() ALSO consumes `random` (search init + negative sampling), and
  // a mulberry32 closure mutates on every draw — so a second transform of the SAME held
  // pose would land somewhere else, and the live cursor would jitter. Re-seed before
  // each transform so an identical vector always maps to the same point. (fit runs first
  // and consumes the seeded sequence; the reset is only for the transform path.)
  let rng = seededRandom(o.seed);
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors: Math.max(2, Math.min(o.nNeighbors, points.length - 1)),
    minDist: o.minDist,
    nEpochs: safeEpochs(o.nEpochs),
    random: () => rng(),
  });
  const layout = umap.fit(rows).map(([x, y]) => [x, y] as Point2);
  const xs = layout.map((p) => p[0]);
  const ys = layout.map((p) => p[1]);
  const bounds = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  return {
    layout,
    bounds,
    transform(vector) {
      rng = seededRandom(o.seed); // stable: a held pose maps to the same point every poll
      const [p] = umap.transform([toMetricRow(vector, features, weights)]);
      return [p[0], p[1]];
    },
  };
}

// ---- Thinning: representative points that grow with the count they stand for -------

export interface Representative {
  /** Position (the mean of its members' layout positions). */
  x: number;
  y: number;
  /** Indices of the points it stands for. */
  members: number[];
}

/**
 * Bin the layout on a grid of `cells` × `cells` and merge each bin's points into one
 * representative — the cheapest form of the cluster-based visual abstraction the
 * literature uses against overdraw. Below `cap` points, nothing is merged (every
 * point is its own representative). The cap is a parameter on purpose.
 */
export function thinLayout(layout: readonly Point2[], opts: { cap?: number; cells?: number } = {}): Representative[] {
  const cap = opts.cap ?? 200;
  if (layout.length <= cap) return layout.map(([x, y], i) => ({ x, y, members: [i] }));
  const cells = opts.cells ?? 32;
  const xs = layout.map((p) => p[0]);
  const ys = layout.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(1e-9, Math.max(...xs) - minX);
  const h = Math.max(1e-9, Math.max(...ys) - minY);
  const bins = new Map<number, number[]>();
  layout.forEach(([x, y], i) => {
    const cx = Math.min(cells - 1, Math.floor(((x - minX) / w) * cells));
    const cy = Math.min(cells - 1, Math.floor(((y - minY) / h) * cells));
    const key = cy * cells + cx;
    const b = bins.get(key);
    if (b) b.push(i);
    else bins.set(key, [i]);
  });
  return [...bins.values()].map((members) => ({
    x: members.reduce((s, i) => s + layout[i][0], 0) / members.length,
    y: members.reduce((s, i) => s + layout[i][1], 0) / members.length,
    members,
  }));
}

/** Indices of the layout points inside an axis-aligned rectangle (a drag-select). */
export function selectInRect(layout: readonly Point2[], rect: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minY = Math.min(rect.y0, rect.y1);
  const maxY = Math.max(rect.y0, rect.y1);
  const out: number[] = [];
  layout.forEach(([x, y], i) => {
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) out.push(i);
  });
  return out;
}
