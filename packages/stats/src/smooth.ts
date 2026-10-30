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

export interface OneEuroOptions {
  /** Cutoff when still, Hz: lower is smoother at rest. */
  minCutoff?: number;
  /** How fast the cutoff rises with speed: higher follows a quick move with less lag. */
  beta?: number;
  /** Cutoff of the speed estimate itself, Hz. */
  dCutoff?: number;
  /**
   * A circular quantity's period (a pitch class has 12 semitones): each reading is taken as the
   * representative nearest the last value, so B to C is a step of one, not of eleven. The output
   * is NOT wrapped (it stays continuous); wrap it where it is shown.
   */
  period?: number;
}

export const ONE_EURO_DEFAULTS = { minCutoff: 1, beta: 0.05, dCutoff: 1 };

export interface OneEuro {
  /** Fold in `x` at time `t` seconds (non-decreasing) and return the smoothed value. */
  push(t: number, x: number): number;
  reset(): void;
  /** New cutoffs from the next sample on, the state kept (a smoothing control moved mid-take). */
  retune(options: Pick<OneEuroOptions, 'minCutoff' | 'beta' | 'dCutoff'>): void;
}

/**
 * The 1-euro filter (Casiez, Roussel and Vogel, CHI 2012): an exponential smoother whose cutoff
 * rises with the signal's speed, so a held value is steady and a quick move is followed with little
 * lag. thoremin had two private copies (the mapping node, the theremin's assist); this is the pure
 * one for new code.
 */
export function createOneEuro(options: OneEuroOptions = {}): OneEuro {
  let { minCutoff, beta, dCutoff } = { ...ONE_EURO_DEFAULTS, ...options };
  const period = options.period;
  const alpha = (cutoff: number, dt: number) => {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };
  let x = NaN;
  let dx = 0;
  let last = NaN;
  return {
    push(t, raw) {
      if (!Number.isFinite(x)) {
        x = raw;
        dx = 0;
        last = t;
        return x;
      }
      const near = period ? raw + period * Math.round((x - raw) / period) : raw;
      const dt = t - last;
      last = t;
      if (!(dt > 0)) return x;
      dx = ewUpdate(dx, (near - x) / dt, alpha(dCutoff, dt));
      x = ewUpdate(x, near, alpha(minCutoff + beta * Math.abs(dx), dt));
      return x;
    },
    reset() {
      x = NaN;
      dx = 0;
      last = NaN;
    },
    retune(o) {
      minCutoff = o.minCutoff ?? minCutoff;
      beta = o.beta ?? beta;
      dCutoff = o.dCutoff ?? dCutoff;
    },
  };
}
