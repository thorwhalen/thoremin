/**
 * Phase unwrapping — the one thing you must do to an ANGLE before handing it to a
 * statistic that assumes a straight line (#144, #150).
 *
 * Four catalog features are marked `circular: true` and declared over `[-pi, pi]`:
 * `hand.palm.yaw`, `hand.palm.roll`, `hand.tilt`, `hand.pair.tilt`. Every one is an
 * `atan2`, so its endpoints are the SAME physical pose and a crossing between them is a
 * coordinate artifact, not motion. #144 established this after measuring 5.69 rad
 * single-frame "jumps" that were nothing but +-pi wraps, and removed the artifact from
 * the normalizer by mapping circular features against their declared range.
 *
 * The normalizer was not the only consumer. Any LINEAR estimator fed the raw angle sees
 * the same 2*pi step as a real excursion:
 *
 *  - the rolling correlation matrix (#150) folds it into an EW covariance AND both
 *    variances, which is worse than a wrong number — measured on a slowly rotating wrist
 *    against an unrelated slow sine, r goes from +1.00 to -0.93 on the wrap frame and
 *    stays near -0.9 for hundreds of frames. The performer reads a strong anti-correlation
 *    that does not exist, and "which confound is actually biting" is the one question that
 *    view exists to answer.
 *  - #131's `residual(x, z)` / `deconfound(...)` regress x on z linearly, so a wrapping z
 *    injects a step into the correction applied to a live musical signal. Those helpers
 *    take NUMBERS, not feature ids, and so cannot know their argument is angular — which
 *    is exactly why `unwrap()` is exposed to the formula language rather than applied
 *    behind the user's back.
 *
 * The correction is the standard one: add whole periods so each sample lands within half
 * a period of the previous one, turning a wrapped angle back into the continuous signal
 * it came from. Its single assumption is that the true change between two consecutive
 * SAMPLES is under half a period; at 30fps and 2*pi that means a wrist turning slower
 * than ~15 revolutions per second, and the correlation view's frame stride only relaxes
 * it (stride 4 → ~3.7 rev/s). Neither is reachable by a hand.
 *
 * The unwrapped value is no longer inside the declared range — that is the point, and it
 * is why unwrapping belongs to the STATISTICS and never to the meter: the displayed level
 * still comes from the normalizer's fixed declared-range mapping, so the bar the performer
 * watches keeps its stable, history-independent scale.
 *
 * Pure and Node-safe: no imports, no clock, no allocation per sample.
 */

/** A full turn. The default period for an `atan2`-derived angle in radians. */
export const TAU = 2 * Math.PI;

/**
 * `x` shifted by whole `period`s so it lands within half a period of `prev` — the
 * continuous continuation of a wrapped signal.
 *
 * Returns `x` untouched when it cannot be unwrapped meaningfully (a non-finite input, or
 * a degenerate period), so a bad frame passes through as-is rather than becoming a NaN
 * that would poison whatever accumulates it.
 */
export function unwrapStep(prev: number, x: number, period: number): number {
  if (!Number.isFinite(prev) || !Number.isFinite(x) || !Number.isFinite(period) || !(period > 0)) return x;
  return x + period * Math.round((prev - x) / period);
}

/** A running unwrapper over ONE signal. Never share an instance across two signals, or
 *  each one's wraps are corrected against the other's phase. */
export interface Unwrapper {
  /**
   * Unwrap one sample against the running phase and advance it. `period` is per-call
   * (a formula may supply it), and a non-finite `x` or `period` passes through WITHOUT
   * advancing the state — a signal that is absent this frame must not be read as a jump,
   * for the same reason the moments estimator refuses it.
   */
  next(x: number, period?: number): number;
  /** Forget the phase — the shared "recalibrate" path. */
  reset(): void;
}

/** Create a running unwrapper, seeded by its first finite sample. */
export function makeUnwrapper(): Unwrapper {
  let prev = NaN;
  return {
    next(x, period = TAU) {
      if (!Number.isFinite(x) || !Number.isFinite(period) || !(period > 0)) return x;
      const u = Number.isFinite(prev) ? unwrapStep(prev, x, period) : x;
      prev = u;
      return u;
    },
    reset() {
      prev = NaN;
    },
  };
}

/** The period of a declared `[lo, hi]` angular range. */
export function periodOf(range: readonly [number, number]): number {
  return range[1] - range[0];
}
