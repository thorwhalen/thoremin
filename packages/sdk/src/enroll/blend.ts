/**
 * Continuous control from category memberships (#372, #160's second reading): a categorizer's soft
 * memberships (`LiveReading.memberships`, a `CategoryScores`' bars) weigh a value set per category
 * into one number, so moving from one of a player's poses to another moves a sound smoothly
 * between the two categories' settings rather than switching at the boundary.
 *
 * - `blendByMembership`: the membership-weighted mean of the categories that have a value (a
 *   category the player gave none does not pull); null when nothing is read.
 * - `createSmoother`: an exponential approach with a time constant, so a membership's frame-to-frame
 *   jitter is not heard; it holds its value while nothing is read.
 *
 * Pure. Per-tick and continuous, which is why this is a node in the graph rather than a command
 * (#87, Decision B: no per-tick command writes).
 */

/** The membership-weighted mean of the values the categories have (ids aligned with scores). */
export function blendByMembership(ids: readonly string[], scores: readonly number[], values: Readonly<Record<string, number | undefined>>): number | null {
  let sum = 0;
  let weight = 0;
  ids.forEach((id, i) => {
    const v = values[id];
    const s = scores[i];
    if (typeof v !== 'number' || !Number.isFinite(v) || !(s > 0)) return;
    sum += v * s;
    weight += s;
  });
  return weight > 0 ? sum / weight : null;
}

export interface Smoother {
  /** The target now (null: nothing read, hold) and the seconds since the last: the value. */
  push(target: number | null, dt: number): number | null;
  reset(): void;
}

/** An exponential approach to the target with time constant `tauS` (0: none). */
export function createSmoother(tauS: number): Smoother {
  let value: number | null = null;
  return {
    push(target, dt) {
      if (target === null) return value;
      if (value === null || !(tauS > 0)) value = target;
      else value += (target - value) * (1 - Math.exp(-Math.max(0, dt) / tauS));
      return value;
    },
    reset() {
      value = null;
    },
  };
}
