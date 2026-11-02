/**
 * The exponentially weighted running mean, written once (#392).
 *
 * Why NaN seeds it: the trackers keep their estimates as NaN until the first reading (an
 * honest "unknown" a reader can test), so the first reading is taken whole rather than
 * blended toward a made-up start.
 *
 * Pure: no DOM, no clock, no dependency.
 */
import { definedOnly } from './options';

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
 * The smoothing gain of a first-order low-pass at `cutoff` Hz over a step of `dt` seconds (the
 * 1-euro paper's alpha). Exported so the 2-D filter below runs the same arithmetic, not a copy.
 */
export function oneEuroAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * The 1-euro filter (Casiez, Roussel and Vogel, CHI 2012): an exponential smoother whose cutoff
 * rises with the signal's speed, so a held value is steady and a quick move is followed with little
 * lag. thoremin had two private copies (the mapping node, the theremin's assist); this is the pure
 * one for new code.
 */
export function createOneEuro(options: OneEuroOptions = {}): OneEuro {
  let { minCutoff, beta, dCutoff } = { ...ONE_EURO_DEFAULTS, ...definedOnly(options) };
  const period = options.period;
  const alpha = oneEuroAlpha;
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

export interface OneEuro2DOptions extends Pick<OneEuroOptions, 'minCutoff' | 'beta' | 'dCutoff'> {
  /**
   * How far ahead to extrapolate the `predicted` point, seconds (for example the camera frame's
   * measured age). Absent or 0: no `predicted` point is returned.
   */
  predict?: number;
}

/**
 * Defaults for a point in frame fractions (0..1), not the scalar defaults: a hand crossing the
 * frame moves about 1 unit/s, where `ONE_EURO_DEFAULTS.beta` (0.05) would barely raise the cutoff.
 * Source: thoremin-ar's Drawn Pieces tuning (`createOneEuro2D` in its `src/lib/pinch.ts`), inside
 * the 1-2 Hz / beta 1-10 range its research note gives for a drawing cursor (section 6.1 of
 * `docs/research/02-draw-and-move-with-a-webcam.md`). To be retuned on footage (#819).
 */
export const ONE_EURO_2D_DEFAULTS = { minCutoff: 1.5, beta: 8, dCutoff: 1 };

export interface Point2 {
  x: number;
  y: number;
}

export interface OneEuro2DOutput extends Point2 {
  /** The filtered point moved `predict` seconds along its own velocity, smoothed at `dCutoff` (a
   *  cursor dot only: ink is never predicted, so a stroke never holds an extrapolation error). The
   *  filter's speed term is not that velocity: it is taken against the PREVIOUS filtered point (the
   *  paper's), so it also carries the lag and would overshoot. */
  predicted?: Point2;
}

export interface OneEuro2D {
  /**
   * Fold in the point (`x`, `y`) captured at `t` seconds (non-decreasing) and return the smoothed
   * one. A repeated stamp or a non-finite value is skipped: the previous output is returned (NaN
   * before the first finite point).
   */
  push(t: number, x: number, y: number): OneEuro2DOutput;
  reset(): void;
  retune(options: OneEuro2DOptions): void;
}

/**
 * The 1-euro filter on a 2-D point with ONE cutoff for both axes, driven by the speed of the
 * point (the length of its smoothed velocity), not of each coordinate. Two scalar filters would
 * each raise their cutoff by their own axis's speed, so a diagonal stroke would lag more along
 * the slower axis and the filtered point would leave the line the hand drew; with one cutoff
 * both axes are blended by the same gain and the lag is the same in time along the stroke.
 * `t` is the CAPTURE time of the sample (so dt is the camera's real spacing, not the tick's).
 */
export function createOneEuro2D(options: OneEuro2DOptions = {}): OneEuro2D {
  let { minCutoff, beta, dCutoff, predict } = { ...ONE_EURO_2D_DEFAULTS, predict: 0, ...definedOnly(options) };
  let x = NaN;
  let y = NaN;
  let dx = 0;
  let dy = 0;
  let vx = 0;
  let vy = 0;
  let last = NaN;
  const out = (): OneEuro2DOutput => (predict > 0 ? { x, y, predicted: { x: x + vx * predict, y: y + vy * predict } } : { x, y });
  return {
    push(t, rawX, rawY) {
      // A non-finite reading (a lost landmark, a bad stamp) is no observation: the previous
      // output again, rather than a NaN that would re-seed the filter and snap on the next one.
      if (!Number.isFinite(t) || !Number.isFinite(rawX) || !Number.isFinite(rawY)) return out();
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        x = rawX;
        y = rawY;
        dx = 0;
        dy = 0;
        vx = 0;
        vy = 0;
        last = t;
        return out();
      }
      const dt = t - last;
      if (!(dt > 0)) return out();
      last = t;
      const ad = oneEuroAlpha(dCutoff, dt);
      dx = ewUpdate(dx, (rawX - x) / dt, ad);
      dy = ewUpdate(dy, (rawY - y) / dt, ad);
      const a = oneEuroAlpha(minCutoff + beta * Math.hypot(dx, dy), dt);
      const px = x;
      const py = y;
      x = ewUpdate(x, rawX, a);
      y = ewUpdate(y, rawY, a);
      vx = ewUpdate(vx, (x - px) / dt, ad);
      vy = ewUpdate(vy, (y - py) / dt, ad);
      return out();
    },
    reset() {
      x = NaN;
      y = NaN;
      dx = 0;
      dy = 0;
      vx = 0;
      vy = 0;
      last = NaN;
    },
    retune(o) {
      minCutoff = o.minCutoff ?? minCutoff;
      beta = o.beta ?? beta;
      dCutoff = o.dCutoff ?? dCutoff;
      predict = o.predict ?? predict;
    },
  };
}
