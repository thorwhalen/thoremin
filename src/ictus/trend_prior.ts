/**
 * The trend prior — a second {@link RhythmPrior}: a least-squares tempo trend over
 * the last few anchors.
 *
 * The adaptive oscillator (`oscillator.ts`) carries a phase and a period and corrects
 * both by a fraction of each anchor's error, which is how a human follower behaves
 * (McAuley and Jones) and what keeps it robust to a stray anchor. It has no notion of
 * a tempo *trend*: under a steady accelerando its period runs behind by a few beats'
 * worth of change and its predicted beats land late by several tens of milliseconds
 * (`scripts/subframe/score.ts` measures it). Cemgil's Kalman tempo tracker (research
 * map §2.3) fixes that by giving the state a tempo-rate; this is the plainest version
 * of the same idea: fit anchor time against beat index with a quadratic (a linear
 * change of period) over a short memory, and read the next beat off the fit. It is the
 * intent estimate a scheduler wants when the player is deliberately speeding up.
 *
 * Costs, stated: a fit over `memory` anchors reacts to a real tempo change within
 * `memory` beats but is pulled by one bad anchor for as long; the quadratic term is
 * only used once `quadraticAfter` anchors are in, and a dropped beat is bridged by
 * assigning the anchor the nearest integer beat index. Same interface, same state
 * machine words (`ready` until two anchors, `running`, `hold` when the expected beat
 * is overdue by `holdAfterPeriods`), so a consumer swaps it in without knowing.
 */
import type { Anchor, MusicalTime, Prediction, RhythmPrior } from './types';

export interface TrendPriorOptions {
  /** Anchors the fit uses (the most recent). */
  memory?: number;
  /** Anchors needed before the fit carries a quadratic term (a tempo trend). */
  quadraticAfter?: number;
  /** Plausible period range, seconds. */
  minPeriod?: number;
  maxPeriod?: number;
  /** An anchor below this confidence is ignored. */
  confidenceFloor?: number;
  /** Missing the expected beat by this many periods enters `hold`. */
  holdAfterPeriods?: number;
  /** Attentional window half-width as a fraction of the period, and a floor on it. */
  windowFraction?: number;
  initialTempo?: number;
  beatsPerBar?: number;
}

const DEFAULTS: Required<TrendPriorOptions> = {
  memory: 6,
  quadraticAfter: 4,
  minPeriod: 0.2,
  maxPeriod: 2.0,
  confidenceFloor: 0.2,
  holdAfterPeriods: 2.25,
  windowFraction: 0.15,
  initialTempo: 100,
  beatsPerBar: 4,
};

interface Fit {
  a: number;
  b: number;
  c: number;
  rms: number;
}

/** Least squares of t on n (index), linear or quadratic. */
function fitTrend(ns: number[], ts: number[], quadratic: boolean): Fit | null {
  const m = ns.length;
  if (m < 2) return null;
  const n0 = ns[m - 1];
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < m; i++) {
    const x = ns[i] - n0;
    const x2 = x * x;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    r0 += ts[i];
    r1 += x * ts[i];
    r2 += x2 * ts[i];
  }
  let a: number, b: number, c: number;
  if (quadratic && m >= 3) {
    const det = m * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
    a = (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det;
    b = (m * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det;
    c = (m * (s2 * r2 - r1 * s3) - s1 * (s1 * r2 - r1 * s2) + r0 * (s1 * s3 - s2 * s2)) / det;
  } else {
    const det = m * s2 - s1 * s1;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
    b = (m * r1 - s1 * r0) / det;
    a = (r0 - b * s1) / m;
    c = 0;
  }
  let ss = 0;
  for (let i = 0; i < m; i++) {
    const x = ns[i] - n0;
    const e = ts[i] - (a + b * x + c * x * x);
    ss += e * e;
  }
  return { a, b, c, rms: Math.sqrt(ss / m) };
}

export function createTrendPrior(options: TrendPriorOptions = {}): RhythmPrior {
  const o = { ...DEFAULTS, ...options };
  const ns: number[] = [];
  const ts: number[] = [];
  let t = 0;
  let fit: Fit | null = null;
  let lastN = 0;
  let anchors = 0;
  let state: MusicalTime['state'] = 'ready';
  let confidence = 0;

  /** The beat frozen at the moment the follower entered `hold`. */
  let holdBeat = 0;

  /** Time of beat index n (relative to the last anchor's index), from the fit. */
  const timeOf = (n: number): number => {
    const x = n - lastN;
    return fit ? fit.a + fit.b * x + fit.c * x * x : NaN;
  };
  /** Period at beat index n. */
  const periodAt = (n: number): number => {
    if (!fit) return 60 / o.initialTempo;
    const x = n - lastN;
    return Math.max(o.minPeriod, Math.min(o.maxPeriod, fit.b + 2 * fit.c * x));
  };
  /** A fit is usable only where its slope (the period) stays plausible over the
   *  beats it will be evaluated on: the last anchor, and up to two beats ahead. A
   *  quadratic whose curvature drives the period out of range there is replaced by
   *  the linear fit. */
  const plausible = (f: Fit): boolean => {
    for (const x of [-1, 0, 1, 2]) {
      const slope = f.b + 2 * f.c * x;
      if (!(slope >= o.minPeriod && slope <= o.maxPeriod)) return false;
    }
    return true;
  };
  /** Continuous beat index at time tt: the fit inverted in closed form, the root on
   *  the branch that contains the last anchor, clamped to a few beats around it. */
  const beatAtTime = (tt: number): number => {
    if (!fit) return 0;
    let x: number;
    if (Math.abs(fit.c) < 1e-9) x = (tt - fit.a) / fit.b;
    else {
      // c x² + b x + (a - tt) = 0; the root nearest x = 0 on the increasing branch.
      const disc = fit.b * fit.b - 4 * fit.c * (fit.a - tt);
      if (disc < 0) x = (tt - fit.a) / fit.b;
      else {
        const sq = Math.sqrt(disc);
        const r1 = (-fit.b - sq) / (2 * fit.c);
        const r2 = (-fit.b + sq) / (2 * fit.c);
        x = Math.abs(r1) <= Math.abs(r2) ? r1 : r2;
      }
    }
    return lastN + Math.max(-2, Math.min(4, x));
  };

  const snapshot = (): MusicalTime => {
    const beat = state === 'ready' ? 0 : state === 'hold' ? holdBeat : beatAtTime(t);
    const wholeBeat = Math.floor(beat);
    const phase = beat - wholeBeat;
    const period = periodAt(beat);
    const lastAnchorAt = ts.length ? ts[ts.length - 1] : undefined;
    return {
      t,
      beat,
      phase,
      tempo: 60 / period,
      period,
      confidence,
      nextBeatAt: state === 'hold' || !fit ? Infinity : timeOf(Math.floor(beat) + 1),
      beatsPerBar: o.beatsPerBar,
      beatInBar: ((wholeBeat % o.beatsPerBar) + o.beatsPerBar) % o.beatsPerBar,
      state,
      anchors,
      lastAnchorAt,
    };
  };

  return {
    advance(tNew) {
      if (!(tNew > t)) return;
      const dt = tNew - t;
      t = tNew;
      if (state === 'running' && ts.length) {
        const since = t - ts[ts.length - 1];
        const p = periodAt(lastN);
        // Once the expected beat is overdue, confidence decays by the time elapsed
        // (not per call), as the oscillator's does.
        if (since > p) confidence *= Math.pow(0.5, Math.min(dt, since - p) / p);
        if (since > o.holdAfterPeriods * p) {
          holdBeat = beatAtTime(t);
          state = 'hold';
        }
      }
    },
    update(a: Anchor) {
      if (!(a.confidence >= o.confidenceFloor)) return;
      if (ts.length && !(a.t > ts[ts.length - 1])) return;
      anchors++;
      if (state === 'hold') {
        // A preparatory beat after a hold: keep the tempo, restart the phase here on
        // the next whole beat, and carry on running from a linear fit through this
        // anchor at the kept period (the beat count continues; a fermata does not
        // rewind the score).
        const period = periodAt(lastN);
        const n = Math.floor(holdBeat) + 1;
        ns.length = 0;
        ts.length = 0;
        ns.push(n);
        ts.push(a.t);
        lastN = n;
        fit = { a: a.t, b: period, c: 0, rms: 0 };
        state = 'running';
        confidence = 0.5;
        if (a.t > t) t = a.t;
        return;
      }
      // The beat index: the nearest whole number of periods since the last anchor
      // once a tempo is known, else simply the next beat (the first interval IS the
      // period; rounding it against a guessed tempo would read a slow player as a
      // multiple of the guess).
      const n = ts.length ? lastN + (fit ? Math.max(1, Math.round((a.t - ts[ts.length - 1]) / periodAt(lastN))) : 1) : 0;
      ns.push(n);
      ts.push(a.t);
      lastN = n;
      while (ns.length > o.memory) {
        ns.shift();
        ts.shift();
      }
      if (ts.length >= 2) {
        const iai = ts[ts.length - 1] - ts[ts.length - 2];
        if (ts.length === 2 && (iai < o.minPeriod || iai > o.maxPeriod)) {
          // Not a plausible first interval: start over from this anchor.
          ns.splice(0, 1);
          ts.splice(0, 1);
          fit = null;
          state = 'ready';
        } else {
          const q = ns.length >= o.quadraticAfter ? fitTrend(ns, ts, true) : null;
          fit = q && plausible(q) ? q : fitTrend(ns, ts, false);
          if (fit && !plausible(fit)) fit = null;
          state = fit ? 'running' : 'ready';
          const period = periodAt(lastN);
          confidence = fit ? Math.max(0, Math.min(1, 1 - fit.rms / (0.1 * period))) : 0;
        }
      }
      if (a.t > t) t = a.t;
    },
    predict(): Prediction {
      const s = snapshot();
      const window = Math.max(0.03, o.windowFraction * s.period + (fit ? fit.rms : 0));
      return { expectedAt: s.nextBeatAt, window, phase: s.phase };
    },
    state: snapshot,
    reset() {
      ns.length = 0;
      ts.length = 0;
      t = 0;
      fit = null;
      lastN = 0;
      anchors = 0;
      state = 'ready';
      confidence = 0;
      holdBeat = 0;
    },
  };
}
