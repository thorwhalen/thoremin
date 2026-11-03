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
  /** The residual sum of squares (weighted by `weights` when given). */
  rss: number;
  /** Σ w (x - mean x)²: the spread the slope stands on (w = 1 unweighted). */
  sxx: number;
  /** The number of points fitted. */
  n: number;
}

export interface LineOptions {
  /** Where x is measured from (the caller's choice, for conditioning). Default 0. */
  origin?: number;
  /** A weight per point (weighted least squares: a local fit, #945). Default 1 for each. Must
   *  have the points' length; a negative or non-finite weight, or none positive, gives null. */
  weights?: readonly number[];
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
  const ws = options.weights;
  if (ws && (ws.length !== n || ws.some((w) => !(w >= 0) || !Number.isFinite(w)))) return null;
  const w = (k: number) => (ws ? ws[k] : 1);
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < n; k++) {
    sw += w(k);
    sx += w(k) * (xs[k] - origin);
    sy += w(k) * ys[k];
  }
  if (!(sw > 0)) return null;
  const mx = sx / sw;
  const my = sy / sw;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - origin - mx;
    sxx += w(k) * dx * dx;
    sxy += w(k) * dx * (ys[k] - my);
  }
  // No spread, or one so large its square overflows: either way no line to fit.
  if (!(sxx > 0) || !Number.isFinite(sxx)) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let rss = 0;
  for (let k = 0; k < n; k++) rss += w(k) * (ys[k] - (intercept + slope * (xs[k] - origin))) ** 2;
  return { intercept, slope, rss, sxx, n };
}
