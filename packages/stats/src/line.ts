/**
 * The ordinary least-squares line, written once (#392).
 *
 * Why the centred form: callers fit stamps in milliseconds since page load (values near a
 * million) against frame indices, and the raw-sums determinant `n Σx² - (Σx)²` cancels
 * badly there; subtracting the means first does not. The fit returns the residual sum of
 * squares and the index spread rather than one summary of them, because callers state
 * their own: an RMS over `n`, an sd over `n - 2`, a degeneracy threshold.
 *
 * Pure: no DOM, no clock, no dependency.
 */

/** `y ≈ intercept + slope · (x - origin)`. */
export interface LineFit {
  /** The line at `x = origin`. */
  intercept: number;
  /** y per unit of x. */
  slope: number;
  /** The residual sum of squares. */
  rss: number;
  /** Σ (x - mean x)²: the spread the slope stands on. */
  sxx: number;
  /** The number of points fitted. */
  n: number;
}

export interface LineOptions {
  /** Where x is measured from (the caller's choice, for conditioning). Default 0. */
  origin?: number;
}

/**
 * Least-squares line of `ys` on `xs`. Null with fewer than two points, arrays of different
 * lengths, or no spread in x (or one whose square overflows); a non-finite `ys` gives a non-finite fit, for the caller's
 * own rule to refuse.
 */
export function olsLine(xs: readonly number[], ys: readonly number[], options: LineOptions = {}): LineFit | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const origin = options.origin ?? 0;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < n; k++) {
    sx += xs[k] - origin;
    sy += ys[k];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - origin - mx;
    sxx += dx * dx;
    sxy += dx * (ys[k] - my);
  }
  // No spread, or one so large its square overflows: either way no line to fit.
  if (!(sxx > 0) || !Number.isFinite(sxx)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (let k = 0; k < n; k++) rss += (ys[k] - (intercept + slope * (xs[k] - origin))) ** 2;
  return { intercept, slope, rss, sxx, n };
}
