/**
 * taglog — lead-in (pre-roll) correction (design §6).
 *
 * A busy performer clicks *before* acting, so the intended action time is offset
 * from the click. The correction is **asymmetric and signed** so both moves shrink
 * the tagged interval toward the clean middle of the action (excluding the reach-in
 * and reach-out — exactly what training data wants):
 *
 *   - **open**  -> `t + leadIn`  (the action begins *after* the click; the countdown
 *                                 covers this gap)
 *   - **close** -> `t - leadIn`  (trims the trailing ramp-down before the hands leave)
 *   - **point** -> `t`           (a point is the instant itself)
 *
 * Pure functions — no state, no timers. The countdown UI is a separate presentation
 * concern; here we only compute times.
 */
import type { TagStatus } from './schema';

/** The lead-in-corrected time for one event, given its status and the tag's lead-in. */
export function correctedTime(status: TagStatus, t: number, leadIn: number): number {
  switch (status) {
    case 'open':
      return t + leadIn;
    case 'close':
      return t - leadIn;
    case 'point':
      return t;
  }
}

/**
 * True if applying lead-in to an interval inverted it (`openCorrected >= closeCorrected`)
 * — e.g. a lead-in larger than the interval itself. The consumer should fall back to
 * raw times (or a zero-length point) rather than emit a negative interval (§6 guard).
 */
export function isDegenerate(openCorrected: number, closeCorrected: number): boolean {
  return openCorrected >= closeCorrected;
}
