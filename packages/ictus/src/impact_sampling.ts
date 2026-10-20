/**
 * The impact predictor's sampling statistics: the expected next sample gap (the commit
 * deadline) and the online jitter estimate. Moved out of `impact.ts`, which re-exports
 * what it exported.
 */
import { median, quantile } from '@thoremin/stats';

/** Residuals kept for the jitter estimate. */
export const JITTER_WINDOW = 16;

/** Recent sample gaps the commit deadline is read from, and the quantile it reads: the
 *  deadline expects the next sample no sooner than most recent ones came. */
export const GAP_WINDOW = 8;

const GAP_QUANTILE = 0.9;

/** The `q` quantile of the recent gaps by nearest rank (a real gap, rounding the rank up),
 *  NaN with none. */
function gapQuantile(gaps: readonly number[], q: number): number {
  return quantile(gaps, q, { index: 'nearestRank' });
}

/** The expected next gap: the `GAP_QUANTILE` quantile of the last `GAP_WINDOW` gaps
 *  (NaN with none). With regular sampling this is the gap itself. */
export function expectedGap(gaps: readonly number[]): number {
  return gapQuantile(gaps, GAP_QUANTILE);
}

/**
 * The online jitter estimate: the MEDIAN of the last few residuals of a sample against
 * the median of its neighbours. The residual is zero on any monotone run and non-zero
 * only at a local extremum, so on a clean stroke it is non-zero exactly twice per
 * stroke — at the top and at the bottom, where a sharp surface impact makes it as
 * large as a frame's travel — while tracker noise makes it non-zero on most samples.
 * A mean (the detector's convention) is pulled up by the two kinks; the median of a
 * window that mostly holds the monotone run between them is not, so a clean V is not
 * mistaken for a noisy signal (which would gate every stroke out as tremor).
 */
export class JitterEstimator {
  private readonly ring: number[] = [];
  private i = 0;
  push(resid: number): void {
    if (this.ring.length < JITTER_WINDOW) this.ring.push(resid);
    else this.ring[this.i] = resid;
    this.i = (this.i + 1) % JITTER_WINDOW;
  }
  /** How many residuals have been seen (the warm-up gate reads it). */
  count(): number {
    return this.ring.length === JITTER_WINDOW ? JITTER_WINDOW : this.ring.length;
  }
  /** NaN until the first residual. */
  value(): number {
    return median(this.ring, { even: 'mean' });
  }
  reset(): void {
    this.ring.length = 0;
    this.i = 0;
  }
}
