/**
 * Quantiles and medians with the index rule STATED, never implied (#392).
 *
 * Why the rule is an option rather than a choice made here: thoremin's timing code reads
 * order statistics off windows of a few to a few dozen samples, and on a window that small
 * the textbook rules disagree by a whole sample. Each caller picked its rule for a reason
 * (a low quantile that must land ON a real gap, a deadline read by nearest rank, a report
 * that interpolates), and its tests pin the numbers that rule gives. So one function, the
 * rule named at every call site, and no rule silently swapped for another.
 *
 * Pure: no DOM, no clock, no dependency.
 */

/**
 * How a quantile `q` of `n` ascending samples picks its value. With `pos = q (n - 1)`:
 *
 * - `interpolate` — linear between the samples either side of `pos` (Hyndman and Fan's
 *   type 7, R's and NumPy's default). The default.
 * - `floor` — the sample at `floor(pos)`: always a real sample, never above the quantile.
 * - `round` — the sample at `Math.round(pos)` (half up): the nearest real sample.
 * - `ceil` — the sample at `ceil(pos)`: always a real sample, never below the quantile
 *   (with `q = 0.5`, the upper median).
 * - `nearestRank` — the classical nearest rank, the sample at `ceil(q n) - 1`.
 */
export type QuantileIndex = 'interpolate' | 'floor' | 'round' | 'ceil' | 'nearestRank';

export interface QuantileOptions {
  /** The index rule; see {@link QuantileIndex}. Default `interpolate`. */
  index?: QuantileIndex;
}

/** Which middle an even-sized sample's median takes: their `mean` (the default), or the
 *  `lower` or `upper` of the two (a real sample either way). */
export type MedianEven = 'mean' | 'lower' | 'upper';

export interface MedianOptions {
  /** See {@link MedianEven}. Default `mean`. */
  even?: MedianEven;
}

const ascending = (a: number, b: number): number => a - b;
const clampUnit = (q: number): number => Math.min(1, Math.max(0, q));

/** An ascending copy (the input is never sorted in place). */
export function sortedCopy(xs: readonly number[]): number[] {
  return [...xs].sort(ascending);
}

/**
 * The `q` quantile of an ASCENDING-sorted array, `q` clamped into [0, 1], by the stated
 * index rule (default `interpolate`). NaN for an empty array.
 */
export function quantileSorted(sorted: readonly number[], q: number, options: QuantileOptions = {}): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const index = options.index ?? 'interpolate';
  const qc = clampUnit(q);
  const pick = (i: number): number => sorted[Math.min(n - 1, Math.max(0, i))];
  const pos = qc * (n - 1);
  switch (index) {
    case 'floor':
      return pick(Math.floor(pos));
    case 'round':
      return pick(Math.round(pos));
    case 'ceil':
      return pick(Math.ceil(pos));
    case 'nearestRank':
      return pick(Math.ceil(qc * n) - 1);
    case 'interpolate': {
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    }
  }
}

/** {@link quantileSorted} of an unsorted sample (sorts a copy). */
export function quantile(xs: readonly number[], q: number, options: QuantileOptions = {}): number {
  return quantileSorted(sortedCopy(xs), q, options);
}

/** The median of an unsorted sample (sorts a copy); an even-sized one takes the middle
 *  `options.even` names (default their mean). NaN for an empty sample. */
export function median(xs: readonly number[], options: MedianOptions = {}): number {
  const s = sortedCopy(xs);
  const n = s.length;
  if (n === 0) return NaN;
  const m = n >> 1;
  if (n % 2) return s[m];
  const even = options.even ?? 'mean';
  if (even === 'upper') return s[m];
  if (even === 'lower') return s[m - 1];
  return (s[m - 1] + s[m]) / 2;
}

/** The median of three values, branch-free (the despiking filter of a sample stream). */
export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}
