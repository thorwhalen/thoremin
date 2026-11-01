/**
 * Dynamic time warping with a Sakoe-Chiba band (#752): the distance between two multivariate
 * series that may run at different speeds.
 *
 * Generic on purpose: the window matcher (`matcher.ts`) uses it to compare a live segment with
 * a gesture's templates, and the trace quality of #753 uses it to compare a gesture's
 * repetitions with one another (agreement, separation). Nothing here knows about features.
 *
 * Symmetric in its arguments only for series of EQUAL length: the band is measured in columns,
 * so with unequal lengths swapping `a` and `b` changes which cells it admits. Resample both to
 * one length first (`series.ts` does) when the order of the arguments must not matter.
 *
 * ## The rule
 *
 * Rows are time steps, columns are dimensions. The local cost of pairing row `i` of `a` with
 * row `j` of `b` is the RMS difference over the dimensions finite in both (a dimension a series
 * never measured says nothing, rather than poisoning every cell); a pair sharing no finite
 * dimension costs `Infinity`. The warping path may move one step in `a`, in `b` or in both;
 * the diagonal step counts its cost twice (the symmetric step pattern), so every path from the
 * first cell to the last weighs exactly `n + m` and dividing by `n + m` is an average: two series
 * a constant `d` apart read `d`, and a long series does not look far only because it is long.
 *
 * The path stays within a Sakoe-Chiba band centred on the grid's diagonal: at row `i`, the
 * columns from `floor(i * m / n - r)` to `ceil(i * m / n + r)`, where `r` is `band` times the
 * longer length. The rounding is outward, so a band admits up to one column more on each side
 * than `r` says. For series of different lengths `r` is raised to the least width a centred
 * band needs for any path to exist, `ceil(max / min) - 1` (the diagonal advances `m / n`
 * columns per row), so no band is ever too narrow to answer.
 *
 * O(n * r) time, O(m) memory.
 */

/** A series: one row per time step, one column per dimension. */
export type Rows = readonly (readonly number[])[];

export interface DtwOptions {
  /** The band's half-width as a fraction of the longer series (0: the diagonal only, 1: no band). */
  band: number;
}

/** RMS difference over the dimensions finite in both rows; `Infinity` when none is shared. */
function rowCost(x: readonly number[], y: readonly number[]): number {
  let sum = 0;
  let n = 0;
  const d = Math.min(x.length, y.length);
  for (let k = 0; k < d; k++) {
    const u = x[k];
    const v = y[k];
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    sum += (u - v) ** 2;
    n += 1;
  }
  return n === 0 ? Infinity : Math.sqrt(sum / n);
}

/** The banded DTW distance between `a` and `b` (see the module header). Empty input: `Infinity`. */
export function dtwDistance(a: Rows, b: Rows, { band }: DtwOptions): number {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return Infinity;
  const longer = Math.max(n, m);
  const r = Math.max(Math.ceil(Math.max(0, band) * longer), Math.ceil(longer / Math.min(n, m)) - 1);
  let prev = new Float64Array(m + 1).fill(Infinity);
  let curr = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    curr.fill(Infinity);
    // The band is centred on the diagonal of the n-by-m grid, not on i = j.
    const centre = (i * m) / n;
    const lo = Math.max(1, Math.floor(centre - r));
    const hi = Math.min(m, Math.ceil(centre + r));
    for (let j = lo; j <= hi; j++) {
      if (prev[j - 1] === Infinity && prev[j] === Infinity && curr[j - 1] === Infinity) continue;
      const c = rowCost(a[i - 1], b[j - 1]);
      curr[j] = Math.min(prev[j - 1] + 2 * c, prev[j] + c, curr[j - 1] + c);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] / (n + m);
}
