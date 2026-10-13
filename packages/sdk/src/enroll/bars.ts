/**
 * Live feature bars (#385 E2): what the camera reads, in the units the carver uses, for a
 * panel that shows a player their own features while they explore and make categories.
 *
 * The Lab's meters are min-max normalised and show dozens of features; a player making faces
 * needs a handful, scaled so that a bar that barely moves is a feature the carver cannot use
 * either. So every value here is in NOISE UNITS (a displacement divided by the feature's own
 * frame-to-frame jitter, `noise.ts`), measured from the player's REST (the rest cue's mean),
 * or, before a rest exists, from a slow running baseline.
 *
 * Which features get a bar is the one judgement, and it changes with what is known:
 *
 * - **Before there are two categories** (exploring, the first holds): the features that moved
 *   most from the reference recently, a decaying peak of the absolute value.
 * - **Once the holds so far carve into two or more categories**: the features that separate
 *   them, the between-category over within-category variance ratio (a one-way F ratio) in
 *   noise units, the within variance floored at one noise unit squared (the frame jitter: a
 *   category of one hold has no spread of its own, and a ratio over nothing would be infinite).
 *
 * The holds are carved online by the same average-linkage hierarchy the take is carved with
 * (`cluster.ts`), cut at its suggested k; each category so far is a tick on every bar, at its
 * centroid. Categories are numbered by their earliest hold, so "#1" stays the first face made.
 *
 * Shown bars are sticky: a feature replaces a shown one only when it scores `swapRatio` times
 * more, so the list does not reshuffle under the player at frame rate.
 *
 * Pure and modality-free: no React, no DOM, no catalog. A host gives it the feature ids to
 * consider, the noise unit and the reference (`LiveBarsContext`), pushes frames, and reads a
 * snapshot at UI rate.
 */
import { buildHierarchy, cutAt, suggestK } from './cluster';
import type { FeatureVector } from './types';

export const BARS_DEFAULTS = {
  /** Bars shown. */
  count: 6,
  /** Bars shown with "more". */
  more: 12,
  /** How long a movement keeps its feature ranked (the decaying peak's time constant), ms. */
  recentMs: 10000,
  /** The running baseline's time constant before a rest exists, ms. */
  baselineMs: 2000,
  /** A feature displaces a shown one only when it scores this many times more. */
  swapRatio: 1.5,
  /** The most categories the online carve proposes. */
  maxK: 8,
  /** Two categories closer than this (RMS noise units, the sampler's own "same pose" bar)
   *  are one: repeats of a face never split into two. */
  minGap: 3,
  /** How often the online carve is redone between new holds (the noise units drift), ms. */
  recarveMs: 1000,
} as const;

/** Words that only namespace an id (`face.blendshape.mouth.smileLeft`). */
const NAMESPACE_WORDS = new Set(['blendshape', 'geom']);

/** A feature id in words, for a bar's label: `face.blendshape.mouth.smileLeft` -> "mouth smile
 *  left", `face.head.yaw` -> "head yaw". The source (the first segment) is dropped. */
export function featureWords(id: string): string {
  const words: string[] = [];
  for (const seg of id.split('.').slice(1)) {
    if (NAMESPACE_WORDS.has(seg)) continue;
    for (const w of seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/\s+/)) {
      if (w && words.at(-1) !== w) words.push(w);
    }
  }
  return words.join(' ') || id;
}

/** `x` in noise units from `ref`, or null when either is missing or the unit is unknown. */
export function noiseUnit(x: number | undefined, ref: number | undefined, sigma: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(ref) || !(sigma > 0)) return null;
  return ((x as number) - (ref as number)) / sigma;
}

/**
 * The holds so far, carved online: the average-linkage hierarchy over the holds, distances in
 * noise units over `ids`, cut at the suggested k, but never between two groups closer than
 * `minGap` (RMS noise units: the sampler's "same pose" bar, so repeats of one face stay one).
 * With no feature in units yet, everything is one group. Clusters are arrays of hold indices,
 * ordered by their earliest hold.
 */
export function liveCarve(
  holds: readonly FeatureVector[],
  ids: readonly string[],
  sigma: (id: string) => number,
  maxK: number = BARS_DEFAULTS.maxK,
  minGap: number = BARS_DEFAULTS.minGap,
): number[][] {
  if (holds.length === 0) return [];
  const weights: Record<string, number> = {};
  let measured = 0;
  for (const id of ids) {
    const s = sigma(id);
    weights[id] = s > 0 ? 1 / s : 0;
    if (s > 0) measured++;
  }
  if (measured === 0) return [holds.map((_, i) => i)];
  const tree = buildHierarchy(holds, ids, weights);
  // The tree's heights are Euclidean over the measured features; the gap is an RMS.
  const floor = minGap * Math.sqrt(measured);
  let k = suggestK(tree, { max: maxK });
  // Cutting into k leaves the merge at heights[size - k] undone: k only if that join is wide.
  while (k > 1 && (tree.heights[tree.size - k] ?? Infinity) < floor) k--;
  const clusters = cutAt(tree, k);
  return clusters.map((c) => [...c].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
}

/**
 * Per feature, how well it separates `clusters` of `holds`: the between-cluster variance over
 * the within-cluster variance, in noise units, the within floored at 1 (one jitter squared).
 * Zero for a feature with no unit or fewer than two clusters with a value.
 */
export function separationRatios(
  holds: readonly FeatureVector[],
  clusters: readonly (readonly number[])[],
  ids: readonly string[],
  sigma: (id: string) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const s = sigma(id);
    out[id] = 0;
    if (!(s > 0)) continue;
    const groups = clusters.map((c) => c.map((i) => holds[i]?.[id]).filter((x): x is number => Number.isFinite(x)).map((x) => x / s)).filter((g) => g.length > 0);
    if (groups.length < 2) continue;
    const n = groups.reduce((a, g) => a + g.length, 0);
    const grand = groups.reduce((a, g) => a + g.reduce((p, x) => p + x, 0), 0) / n;
    let between = 0;
    let within = 0;
    for (const g of groups) {
      const m = g.reduce((p, x) => p + x, 0) / g.length;
      between += g.length * (m - grand) ** 2;
      for (const x of g) within += (x - m) ** 2;
    }
    between /= groups.length - 1;
    within = n > groups.length ? within / (n - groups.length) : 0;
    out[id] = between / Math.max(within, 1);
  }
  return out;
}

/**
 * The bars to show: `shown` kept where it still scores, filled with the best of the rest, and a
 * shown feature displaced only by one scoring `swapRatio` times more (the order of `shown` is
 * kept, a newcomer taking the displaced one's place). `pinned` always come first.
 */
export function pickBars(
  scores: Readonly<Record<string, number>>,
  shown: readonly string[],
  options: { count?: number; swapRatio?: number; pinned?: readonly string[] } = {},
): string[] {
  const count = options.count ?? BARS_DEFAULTS.count;
  const swapRatio = options.swapRatio ?? BARS_DEFAULTS.swapRatio;
  const pinned = (options.pinned ?? []).filter((id) => Object.hasOwn(scores, id)).slice(0, count);
  const score = (id: string) => (Object.hasOwn(scores, id) && Number.isFinite(scores[id]) ? scores[id] : 0);
  const free = count - pinned.length;
  const keep = shown.filter((id) => Object.hasOwn(scores, id) && !pinned.includes(id)).slice(0, free);
  const rest = Object.keys(scores)
    .filter((id) => !keep.includes(id) && !pinned.includes(id))
    .sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1));
  while (keep.length < free && rest.length > 0) keep.push(rest.shift()!);
  for (const c of rest) {
    let weakest = -1;
    for (let i = 0; i < keep.length; i++) if (weakest < 0 || score(keep[i]) < score(keep[weakest])) weakest = i;
    if (weakest < 0 || !(score(c) > swapRatio * score(keep[weakest]) && score(c) > 0)) break;
    keep[weakest] = c;
  }
  return [...pinned, ...keep];
}

/** What a host tells the bars about the session at a moment. */
export interface LiveBarsContext {
  /** The features a bar may show (the modality's collected ids). */
  ids: readonly string[];
  /** A feature's noise unit (NaN or 0 while unknown: the bar then has no value). */
  sigma: (id: string) => number;
  /** The rest's mean (raw), or null before a rest exists (the running baseline is used). */
  rest: FeatureVector | null;
  /** The rest's per-feature standard deviation (raw), drawn as the neutral band. */
  restSpread?: Readonly<Record<string, number>> | null;
  /** The holds so far (raw still-point vectors), in the order they were made. */
  holds: readonly FeatureVector[];
}

export interface Bar {
  id: string;
  label: string;
  /** The live value in noise units from the reference, or null (not measured, or no unit yet). */
  value: number | null;
  /** Each category so far, its centroid in noise units (null where it has no value). */
  ticks: readonly (number | null)[];
  /** The rest's standard deviation in noise units (the neutral zone is drawn as plus or minus
   *  this), or null before a rest. */
  band: number | null;
}

export interface LiveBars {
  /** What zero is: the player's rest, or a running baseline before a rest exists. */
  reference: 'rest' | 'running';
  /** How the bars were chosen. */
  ranking: 'movement' | 'separation';
  /** Categories the holds so far carve into. */
  categories: number;
  bars: readonly Bar[];
}

export interface LiveBarsOptions {
  recentMs?: number;
  baselineMs?: number;
  swapRatio?: number;
  maxK?: number;
  minGap?: number;
  recarveMs?: number;
}

export interface LiveBarsModel {
  /** Feed the latest frame (null: the part is not in view). */
  push(vector: FeatureVector | null, tMs: number): void;
  /** The bars now, `count` of them (pinned first). */
  snapshot(options?: { count?: number; pinned?: readonly string[] }): LiveBars;
  reset(): void;
}

/** The live bars over a host's context (read at every push and snapshot). */
export function createLiveBars(context: () => LiveBarsContext, options: LiveBarsOptions = {}): LiveBarsModel {
  const recentMs = options.recentMs ?? BARS_DEFAULTS.recentMs;
  const baselineMs = options.baselineMs ?? BARS_DEFAULTS.baselineMs;
  const maxK = options.maxK ?? BARS_DEFAULTS.maxK;
  let baseline: Record<string, number> = {};
  let peaks: Record<string, number> = {};
  let last: FeatureVector | null = null;
  let lastT = Number.NEGATIVE_INFINITY;
  let shown: string[] = [];
  let shownRanking: LiveBars['ranking'] | null = null;
  /** The online carve, cached by the holds it was made from, redone every `recarveMs`. */
  let carve: { holds: readonly FeatureVector[]; n: number; at: number; clusters: number[][] } | null = null;
  const recarveMs = options.recarveMs ?? BARS_DEFAULTS.recarveMs;
  const minGap = options.minGap ?? BARS_DEFAULTS.minGap;

  const reference = (ctx: LiveBarsContext): Readonly<Record<string, number>> => ctx.rest ?? baseline;
  const clustersOf = (ctx: LiveBarsContext): number[][] => {
    const stale = !carve || carve.holds !== ctx.holds || carve.n !== ctx.holds.length || lastT - carve.at >= recarveMs;
    if (stale) carve = { holds: ctx.holds, n: ctx.holds.length, at: lastT, clusters: liveCarve(ctx.holds, ctx.ids, ctx.sigma, maxK, minGap) };
    return carve!.clusters;
  };

  return {
    push(vector, tMs) {
      if (!(tMs > lastT)) return;
      const dt = Number.isFinite(lastT) ? tMs - lastT : 0;
      lastT = tMs;
      last = vector;
      const ctx = context();
      const decay = Math.exp(-dt / recentMs);
      const ref = reference(ctx);
      for (const id of ctx.ids) {
        const z = noiseUnit(vector?.[id], ref[id], ctx.sigma(id));
        const p = (peaks[id] ?? 0) * decay;
        peaks[id] = z === null ? p : Math.max(p, Math.abs(z));
      }
      if (!vector) return;
      const alpha = dt > 0 ? 1 - Math.exp(-dt / baselineMs) : 1;
      for (const id of ctx.ids) {
        const x = vector[id];
        if (!Number.isFinite(x)) continue;
        baseline[id] = Object.hasOwn(baseline, id) ? baseline[id] + alpha * (x - baseline[id]) : x;
      }
    },
    snapshot(opts = {}) {
      const ctx = context();
      const ref = reference(ctx);
      const clusters = clustersOf(ctx);
      const ranking: LiveBars['ranking'] = clusters.length >= 2 ? 'separation' : 'movement';
      const scores = ranking === 'separation' ? separationRatios(ctx.holds, clusters, ctx.ids, ctx.sigma) : Object.fromEntries(ctx.ids.map((id) => [id, peaks[id] ?? 0]));
      if (shownRanking !== ranking) shown = [];
      shownRanking = ranking;
      shown = pickBars(scores, shown, { count: opts.count ?? BARS_DEFAULTS.count, swapRatio: options.swapRatio, pinned: opts.pinned });
      const centroids = clusters.map((c) => {
        const m: Record<string, number> = {};
        for (const id of shown) {
          const xs = c.map((i) => ctx.holds[i]?.[id]).filter((x): x is number => Number.isFinite(x));
          if (xs.length > 0) m[id] = xs.reduce((a, x) => a + x, 0) / xs.length;
        }
        return m;
      });
      const bars = shown.map((id): Bar => {
        const s = ctx.sigma(id);
        const spread = ctx.rest ? ctx.restSpread?.[id] : undefined;
        return {
          id,
          label: featureWords(id),
          value: noiseUnit(last?.[id], ref[id], s),
          ticks: centroids.map((m) => noiseUnit(m[id], ref[id], s)),
          band: Number.isFinite(spread) && s > 0 ? (spread as number) / s : null,
        };
      });
      return { reference: ctx.rest ? 'rest' : 'running', ranking, categories: clusters.length, bars };
    },
    reset() {
      baseline = {};
      peaks = {};
      last = null;
      lastT = Number.NEGATIVE_INFINITY;
      shown = [];
      shownRanking = null;
      carve = null;
    },
  };
}
