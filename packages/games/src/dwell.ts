/**
 * Dwell: time spent inside something, as progress toward "enough". The one mechanic under two
 * games: a balloon pops when the voice has stayed on it for `needS` (it loses progress at `decay`
 * while the voice is off it), and the maze's ball climbs through a wall's opening only while the
 * voice holds the opening's note (no decay: it waits where it is).
 *
 * Pure: stepped by the caller's dt.
 */
export interface DwellOptions {
  /** Seconds inside to reach 1. */
  needS: number;
  /** Progress lost per second outside, as a fraction of the whole (0 = kept). */
  decay?: number;
}

export interface Dwell {
  /** Advance by `dt` seconds, inside or not; returns the progress, 0..1. */
  step(inside: boolean, dt: number): number;
  readonly progress: number;
  readonly done: boolean;
  reset(): void;
  /** A new need, the progress kept (a practice control moved mid-hold). */
  retune(needS: number): void;
}

export function createDwell({ needS, decay = 0 }: DwellOptions): Dwell {
  if (!(needS > 0)) throw new Error('dwell: needS must be positive');
  let p = 0;
  return {
    step(inside, dt) {
      if (p >= 1 || !(dt > 0)) return p;
      p = inside ? p + dt / needS : Math.max(0, p - decay * dt);
      // Steps that add up to the need (0.1 ten times) count as reaching it.
      if (p > 1 - 1e-9) p = 1;
      return p;
    },
    get progress() {
      return p;
    },
    get done() {
      return p >= 1;
    },
    reset() {
      p = 0;
    },
    retune(s) {
      if (!(s > 0)) throw new Error('dwell: needS must be positive');
      needS = s;
    },
  };
}
