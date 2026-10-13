/**
 * The exponentially weighted running mean, written once (#392).
 *
 * Why NaN seeds it: the trackers keep their estimates as NaN until the first reading (an
 * honest "unknown" a reader can test), so the first reading is taken whole rather than
 * blended toward a made-up start.
 *
 * Pure: no DOM, no clock, no dependency.
 */

/** One step of `prev + gain · (x - prev)`; `x` itself while `prev` is not finite. */
export function ewUpdate(prev: number, x: number, gain: number): number {
  return Number.isFinite(prev) ? prev + gain * (x - prev) : x;
}
