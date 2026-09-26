/**
 * The reactive strike trigger the strike test answers with (#227, measurement 3).
 *
 * It is deliberately the SIMPLEST honest reactive detector, not the instrument's
 * best one: the first frame on which a fast downward motion has stopped. A reactive design
 * cannot know a strike happened before it has seen the hand stop, so this trigger
 * fires one frame after the frame that contains the impact, on average, and the
 * strike test's number therefore includes that confirmation frame, as any purely
 * reactive onset must. The impact predictor (`src/ictus/impact.ts`) exists to beat
 * exactly this number; this module is the baseline it is measured against.
 *
 * Coordinates are normalised image y (0 top, 1 bottom), so a downward strike is
 * increasing y and velocities are in image heights per second. Pure: fed one
 * sample per camera frame.
 */

export interface StrikeTriggerOptions {
  /** The downward speed the previous step must have had, image heights per second. */
  minSpeed?: number;
  /** The hand counts as stopped once its downward speed falls below this fraction of
   *  `minSpeed` (a hand resting on a table still jitters by a pixel or two). */
  stopFraction?: number;
  /** Ignore a new strike this soon after the last one, seconds. */
  refractory?: number;
}

export const STRIKE_DEFAULTS: Required<StrikeTriggerOptions> = { minSpeed: 1.0, stopFraction: 0.2, refractory: 0.15 };

export interface StrikeTrigger {
  /** Feed one frame: time in seconds and normalised y, or `undefined` when no hand.
   *  Returns true when this frame confirms a strike. */
  push(t: number, y: number | undefined): boolean;
  reset(): void;
}

export function createStrikeTrigger(options: StrikeTriggerOptions = {}): StrikeTrigger {
  const o = { ...STRIKE_DEFAULTS, ...options };
  let prevT = NaN;
  let prevY = NaN;
  /** The fastest downward speed of the motion in progress (0 when at rest). The frame
   *  that straddles the impact has only part of the approach speed, so the test is on
   *  the approach's peak, not on the one step before the stop. */
  let approach = 0;
  let lastFire = -Infinity;
  const reset = () => {
    prevT = NaN;
    prevY = NaN;
    approach = 0;
  };
  return {
    push(t, y) {
      if (y === undefined || !Number.isFinite(y) || !Number.isFinite(t)) {
        reset();
        return false;
      }
      let fired = false;
      if (Number.isFinite(prevT) && t > prevT) {
        const v = (y - prevY) / (t - prevT);
        if (v >= o.minSpeed * o.stopFraction) {
          approach = Math.max(approach, v);
        } else {
          if (approach >= o.minSpeed && t - lastFire >= o.refractory) {
            fired = true;
            lastFire = t;
          }
          approach = 0;
        }
      }
      prevT = t;
      prevY = y;
      return fired;
    },
    reset,
  };
}
