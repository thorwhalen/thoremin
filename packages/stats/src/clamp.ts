/**
 * Clamping into the unit interval, written once (#392): weights, confidences and
 * strengths are all read as a share in [0, 1].
 *
 * Pure: no DOM, no clock, no dependency.
 */

/** `v` clamped into [0, 1]; NaN stays NaN (an unknown is not made a zero). */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
