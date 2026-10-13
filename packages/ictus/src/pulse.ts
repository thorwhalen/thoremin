/**
 * The pulse follower: musical time from a CONTINUOUS motion channel (a dancer's
 * stride, the bob of a head) rather than from discrete strokes (#186 PR F).
 *
 * The conductor's path (`detector.ts`) finds each stroke's turning point because a
 * conductor marks every beat. A dancer does not: the body repeats a pattern, and the
 * pattern's period is whatever the choreography makes it, a beat, a bar, six beats.
 * So the pulse is read off the channel's autocorrelation (the body research map
 * §4.2: a causal, detrended ACF over the last few seconds, normalised per lag by the
 * overlapping segments' energies so a slow pattern's peak is not crushed by the
 * shrinking overlap), its phase off a least-squares sinusoid at that period, and the
 * fitted cycle's maxima become {@link Anchor}s for a {@link RhythmPrior}, which
 * publishes the {@link MusicalTime} every ictus consumer reads.
 *
 * **No octave is assumed anywhere.** The follower tracks an ACF peak (a *level*) by
 * identity: a peak within `levelTolerance` of the current level is the same level and
 * refines it; any other peak is a different level, whatever its ratio, and takes over
 * only by being clearly stronger for `switchAfterS`. Nothing folds a period by two.
 * The measured reason (`test/body_pulse.test.ts`, the Que Calor fixture at
 * 129.2 bpm): the dancer's stride repeats once per BAR (1.86 s), not per beat, so a
 * follower that folds periods into a "beat range" reports a level the dancer is not
 * moving at; and a choreography can repeat at three or six beats as readily as at two
 * or four, which no power of two reaches. Relating the
 * pulse to a song's grid (beat, bar, or a ratio of three) is the consumer's call, and
 * `candidates` hands it every level the channel shows.
 *
 * Phase convention: phase 0 is the MAXIMUM of the channel's fundamental at the level
 * (for an image-y channel, y down, that is the lowest point of the movement). Pure,
 * causal and clock-free like the rest of ictus: time is the caller's, in seconds.
 */
import { createRhythmPrior, DEFAULT_RHYTHM_PRIOR, type RhythmPriorKind } from './priors';
import type { Anchor, MusicalTime, RhythmPrior } from './types';

/** One ACF peak: a period the channel repeats at, and how strongly (normalised r). */
export interface PulseLevel {
  /** Seconds. */
  period: number;
  /** Normalised autocorrelation at that lag, -1..1 (in practice 0..1). */
  r: number;
}

/**
 * What the follower publishes: the prior's {@link MusicalTime}, where one "beat" is
 * one cycle of the movement at the followed level (so `tempo` is cycles per minute,
 * NOT the song's beats per minute), plus what the level itself is.
 */
export interface PulseState extends MusicalTime {
  /** The followed level's period from the ACF, seconds (NaN when there is none). The
   *  prior's `period` tracks it through the anchors; this is the raw reading. */
  level: number;
  /** The ACF strength at the followed level, 0..1. */
  strength: number;
  /** Every ACF peak in the search range, strongest first: the other levels the
   *  channel shows, for a consumer that relates the pulse to a grid. Never folded. */
  candidates: readonly PulseLevel[];
}

export interface PulseOptions {
  /** Seconds of history the period estimate and the phase fit see. */
  windowS?: number;
  /** The grid the channel is resampled onto, Hz. */
  gridHz?: number;
  /** Period search range, seconds. */
  minPeriodS?: number;
  maxPeriodS?: number;
  /** Span of the centred moving average subtracted before the ACF (a high-pass that
   *  removes a dancer drifting across the room), seconds. `maxPeriodS` by default: a
   *  moving average passes every period up to its span at full gain, where a shorter
   *  one attenuates the slow levels (a 1 s span keeps 17 % of a 3 s pattern) and biases
   *  the estimate toward the fast ones. */
  detrendS?: number;
  /** History needed before the first estimate, seconds. */
  minSpanS?: number;
  /** Seconds between estimates (the ACF is the costly part). */
  updateEveryS?: number;
  /** How many ACF peaks to keep in `candidates`. */
  topK?: number;
  /** ACF strength below which no pulse is reported. The per-lag normalisation lets
   *  noise reach 0.2 to 0.5 at long lags (white and low-passed noise, measured in
   *  `test/ictus_pulse.test.ts`); a real stride sits at 0.76 (median, Que Calor). The
   *  floor makes a noise level rare; {@link PULSE_TRUSTED_CONFIDENCE} makes it harmless. */
  minStrength?: number;
  /** Relative distance within which a peak IS the current level. */
  levelTolerance?: number;
  /** A signal that repeats every P also repeats every 2P, 3P..., so its ACF peaks
   *  there nearly as high. The fundamental is the SHORTEST lag whose peak is within
   *  this fraction of the strongest (the definition of a period, not a fold: the
   *  longer peaks stay in `candidates`, and no ratio is assumed between levels). */
  nearTop?: number;
  /** How far (in r) a LONGER level must beat the current one to challenge it. */
  switchMargin?: number;
  /** How long a challenger must keep winning before it takes over, seconds. */
  switchAfterS?: number;
  /** How far an estimate moves the level toward its peak, 0..1 per estimate. */
  levelGain?: number;
  /** An anchor is emitted for a fitted maximum once it is this fraction of a period in
   *  the past (the fit has samples on both sides of it). */
  settle?: number;
  /** The ACF strength at which an anchor is fully trusted (its confidence is
   *  `strength / anchorTrustAt`, capped at 1). */
  anchorTrustAt?: number;
  /** The rhythm prior by name or as an instance; the package default otherwise. */
  prior?: RhythmPrior | RhythmPriorKind;
}

export const PULSE_DEFAULTS = {
  windowS: 8,
  gridHz: 30,
  minPeriodS: 0.3,
  maxPeriodS: 3,
  minSpanS: 4,
  updateEveryS: 0.25,
  topK: 4,
  minStrength: 0.45,
  levelTolerance: 0.06,
  nearTop: 0.9,
  switchMargin: 0.05,
  switchAfterS: 1.5,
  levelGain: 0.5,
  settle: 0.25,
  anchorTrustAt: 0.5,
} as const;

/** The confidence from which a consumer should act on the pulse (follow it, gate on
 *  it). White noise never reaches it; red noise (a slowly wandering body) does in 1 to 5 %
 *  of ticks, as a slow level held for a second or two, because an 8 s window cannot
 *  rule out a 2.5 s cycle seen three times (`test/ictus_pulse.test.ts`); the Que Calor
 *  stride is above it in nearly every tick once locked. Below it, hold; and a consumer
 *  that acts on a NEW level should want it to persist. */
export const PULSE_TRUSTED_CONFIDENCE = 0.2;

/** The state before anything is known: no level, no phase, zero confidence. */
export const UNKNOWN_PULSE: PulseState = {
  t: NaN,
  beat: 0,
  phase: NaN,
  tempo: NaN,
  period: NaN,
  confidence: 0,
  nextBeatAt: NaN,
  beatsPerBar: 1,
  beatInBar: 0,
  state: 'ready',
  anchors: 0,
  level: NaN,
  strength: 0,
  candidates: [],
};

export interface PulseFollower {
  /** Feed one sample of the channel at `t` (seconds, increasing). NaN means "not
   *  observed this tick"; a gap longer than half the window starts over. */
  feed(t: number, value: number): PulseState;
  state(): PulseState;
  reset(): void;
}

interface Sample {
  t: number;
  v: number;
}

/** Linear resample of (t, v) samples onto a uniform grid of `n` points ending at the
 *  last sample. Returns the grid's start time with the values. */
function resample(samples: readonly Sample[], hz: number, n: number): { t0: number; x: number[] } {
  const tEnd = samples[samples.length - 1].t;
  const t0 = tEnd - (n - 1) / hz;
  const x = new Array<number>(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / hz;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    if (t <= a.t || b.t <= a.t) x[i] = t <= a.t ? a.v : b.v;
    else x[i] = a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return { t0, x };
}

/** Subtract a centred moving average of `span` samples (a cheap, phase-free high-pass). */
function detrend(x: readonly number[], span: number): number[] {
  const n = x.length;
  const half = Math.max(1, Math.floor(span / 2));
  const out = new Array<number>(n);
  let acc = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < n; i++) {
    const wantLo = Math.max(0, i - half);
    const wantHi = Math.min(n - 1, i + half);
    while (hi < wantHi) acc += x[++hi];
    while (lo < wantLo) acc -= x[lo++];
    out[i] = x[i] - acc / (hi - lo + 1);
  }
  return out;
}

/**
 * Normalised autocorrelation peaks with lags in [minLag, maxLag] (samples), strongest
 * first (all of them unless `k` says otherwise), each refined by a parabola through
 * its neighbours. Each lag is normalised by
 * the geometric mean of the two overlapping segments' energies, so a long lag with a
 * short overlap is not penalised for the overlap it lacks.
 */
export function acfPeaks(x: readonly number[], minLag: number, maxLag: number, k = Infinity): Array<{ lag: number; r: number }> {
  const n = x.length;
  let mean = 0;
  for (const v of x) mean += v;
  mean /= n;
  const e = x.map((v) => v - mean);
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + e[i] * e[i];
  if (!(cum[n] > 0)) return [];
  const hi = Math.min(maxLag, n - 3);
  const lo = Math.max(1, minLag);
  if (hi < lo) return [];
  const ac = new Array<number>(hi + 2).fill(0);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += e[i] * e[i - lag];
    const den = Math.sqrt((cum[n] - cum[lag]) * cum[n - lag]);
    ac[lag] = den > 0 ? s / den : 0;
  }
  const peaks: Array<{ lag: number; r: number }> = [];
  for (let lag = lo; lag <= hi; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0) {
      const l = ac[lag - 1];
      const c = ac[lag];
      const r = ac[lag + 1];
      const denom = l - 2 * c + r;
      const d = denom < 0 ? (0.5 * (l - r)) / denom : 0;
      peaks.push({ lag: lag + d, r: c });
    }
  }
  return peaks.sort((p, q) => q.r - p.r).slice(0, k);
}

/**
 * Least-squares fit of `a cos(wt) + b sin(wt) + c + d (t - tMid)` to `x` sampled at
 * `t0 + i / hz`, returned as `A cos(wt - phi)`: the phase angle and the amplitude.
 * Exact for a sinusoid on a linear drift over any span (a plain DFT bin is biased when
 * the window is not a whole number of periods, which it almost never is). It takes the
 * RAW window: a moving-average detrend distorts the window's ends, which is where the
 * newest cycle, the one an anchor comes from, sits.
 */
export function fitSine(x: readonly number[], t0: number, hz: number, period: number): { phi: number; amp: number } {
  const w = (2 * Math.PI) / period;
  const N = 4;
  const tMid = t0 + (x.length - 1) / (2 * hz);
  // Normal equations over [cos, sin, 1, t - tMid], solved by Gauss-Jordan with pivoting.
  // The sums are accumulated in scalars and the cos/sin by rotation (no allocation and
  // two trig calls per fit: this runs a dozen times per estimate on the main thread).
  let cc = 0, cs = 0, c1 = 0, ct = 0, ss = 0, s1 = 0, st = 0, n1 = 0, nt = 0, tt = 0, xc = 0, xs = 0, x1 = 0, xt = 0;
  const dc = Math.cos(w / hz);
  const ds = Math.sin(w / hz);
  let c = Math.cos(w * t0);
  let sn = Math.sin(w * t0);
  for (let i = 0; i < x.length; i++) {
    const u = t0 + i / hz - tMid;
    const v = x[i];
    cc += c * c; cs += c * sn; c1 += c; ct += c * u;
    ss += sn * sn; s1 += sn; st += sn * u;
    n1 += 1; nt += u; tt += u * u;
    xc += v * c; xs += v * sn; x1 += v; xt += v * u;
    const c2 = c * dc - sn * ds;
    sn = sn * dc + c * ds;
    c = c2;
  }
  const m = [
    [cc, cs, c1, ct, xc],
    [cs, ss, s1, st, xs],
    [c1, s1, n1, nt, x1],
    [ct, st, nt, tt, xt],
  ];
  for (let col = 0; col < N; col++) {
    let piv = col;
    for (let r = col + 1; r < N; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    if (Math.abs(m[col][col]) < 1e-12) return { phi: NaN, amp: 0 };
    for (let r = 0; r < N; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k <= N; k++) m[r][k] -= f * m[col][k];
    }
  }
  const a = m[0][N] / m[0][0];
  const b = m[1][N] / m[1][1];
  return { phi: Math.atan2(b, a), amp: Math.hypot(a, b) };
}

/**
 * Sharpen an ACF period by maximising the fitted sinusoid's amplitude around it (the
 * least-squares frequency estimate): the ACF chooses the LEVEL, this measures it.
 * Steps of `step` (relative) over `+-span` steps, then a parabola through the best
 * three. Stays within the searched span, so it never moves to another level.
 */
export function refinePeriod(x: readonly number[], t0: number, hz: number, period: number, step = 0.004, span = 6): number {
  const amps: number[] = [];
  for (let k = -span; k <= span; k++) amps.push(fitSine(x, t0, hz, period * (1 + k * step)).amp);
  let best = 0;
  for (let i = 1; i < amps.length; i++) if (amps[i] > amps[best]) best = i;
  if (best === 0 || best === amps.length - 1) return period * (1 + (best - span) * step);
  const [l, c, r] = [amps[best - 1], amps[best], amps[best + 1]];
  const denom = l - 2 * c + r;
  const d = denom < 0 ? (0.5 * (l - r)) / denom : 0;
  return period * (1 + (best - span + d) * step);
}

/** Build a pulse follower. See the module header for what it does and why. */
export function createPulseFollower(options: PulseOptions = {}): PulseFollower {
  const { prior: priorOpt, ...rest } = options;
  const o = { ...PULSE_DEFAULTS, detrendS: rest.maxPeriodS ?? PULSE_DEFAULTS.maxPeriodS, ...rest };
  if (!(o.minPeriodS > 0 && o.minPeriodS < o.maxPeriodS)) throw new Error(`pulse: need 0 < minPeriodS < maxPeriodS, got ${o.minPeriodS}..${o.maxPeriodS}`);
  const bounds = { minPeriod: o.minPeriodS, maxPeriod: o.maxPeriodS, beatsPerBar: 1 };
  const makePrior = (): RhythmPrior =>
    typeof priorOpt === 'object' ? priorOpt : createRhythmPrior(priorOpt ?? DEFAULT_RHYTHM_PRIOR, { oscillator: bounds, trend: bounds });
  let prior = makePrior();

  let samples: Sample[] = [];
  let lastT = NaN;
  let lastNanT = NaN;
  let lastValidT = NaN;
  let lastEstimateT = -Infinity;
  let level = NaN;
  let strength = 0;
  let candidates: PulseLevel[] = [];
  let challenger: { period: number; since: number } | null = null;
  let phi = NaN; // the fundamental's phase angle at the level, from the last estimate
  let lastAnchorT = NaN;
  let priorT = -Infinity; // how far the prior has been advanced (a delayed clock)
  let lastBeat = -Infinity; // the published beat never steps back within a lock
  let current: PulseState = UNKNOWN_PULSE;

  /** The shortest peak within `nearTop` of the strongest (see {@link PulseOptions.nearTop}),
   *  chosen over EVERY peak: a fast cycle's multiples all score near the top, so a cut
   *  to the strongest few first can drop the period itself. */
  const fundamental = (peaks: readonly PulseLevel[]): PulseLevel | undefined => {
    let best: PulseLevel | undefined;
    for (const p of peaks) if (!best || p.r > best.r) best = p;
    if (!best) return undefined;
    const floor = o.nearTop * best.r;
    return peaks.filter((p) => p.r >= floor).reduce((a, b) => (b.period < a.period ? b : a));
  };

  const forgetLevel = () => {
    level = NaN;
    strength = 0;
    challenger = null;
    phi = NaN;
    lastAnchorT = NaN;
    priorT = -Infinity;
    lastBeat = -Infinity;
    if (typeof priorOpt === 'object') prior.reset();
    else prior = makePrior();
  };

  const reset = () => {
    samples = [];
    lastT = NaN;
    lastNanT = NaN;
    lastValidT = NaN;
    lastEstimateT = -Infinity;
    candidates = [];
    forgetLevel();
    current = UNKNOWN_PULSE;
  };

  const estimate = (t: number) => {
    const span = samples[samples.length - 1].t - samples[0].t;
    if (span < o.minSpanS) return;
    const n = Math.max(4, Math.floor(Math.min(o.windowS, span) * o.gridHz));
    const { t0, x } = resample(samples, o.gridHz, n);
    const d = detrend(x, o.detrendS * o.gridHz);
    const peaks: PulseLevel[] = acfPeaks(d, Math.round(o.minPeriodS * o.gridHz), Math.round(o.maxPeriodS * o.gridHz)).map((p) => ({ period: p.lag / o.gridHz, r: p.r }));
    candidates = peaks.slice(0, o.topK);
    // Only the levels in play are measured by the sine fit (the costly part).
    const measure = (p: PulseLevel): PulseLevel => ({ period: refinePeriod(x, t0, o.gridHz, p.period), r: p.r });
    const found = fundamental(peaks);
    const top = found && measure(found);
    if (!top || top.r < o.minStrength) {
      if (Number.isFinite(level)) forgetLevel();
      strength = top?.r ?? 0;
      return;
    }
    if (!Number.isFinite(level)) {
      level = top.period;
      strength = top.r;
    } else {
      // The same level is a peak within tolerance of it: never a multiple of it.
      const near = peaks.find((c) => Math.abs(c.period / level - 1) < o.levelTolerance);
      const same = near && (near === found ? top : measure(near));
      const other = near === found ? undefined : top;
      // A challenger is the fundamental of this estimate when it is not the current
      // level: either a shorter near-top lag (the lock sat on a multiple) or a clearly
      // stronger peak. It takes over only by persisting.
      if (other && (!same || other.period < same.period || other.r > same.r + o.switchMargin)) {
        if (!challenger || Math.abs(other.period / challenger.period - 1) >= o.levelTolerance) challenger = { period: other.period, since: t };
        else challenger.period = other.period;
      } else challenger = null;
      if (challenger && t - challenger.since >= o.switchAfterS) {
        // A different level has won for long enough: a new pulse, a new lock.
        const next = challenger.period;
        forgetLevel();
        level = next;
        strength = top.r;
      } else if (same) {
        level += (same.period - level) * o.levelGain;
        strength = same.r;
      } else strength = 0;
    }
    if (strength < o.minStrength) {
      phi = NaN;
      return;
    }
    phi = fitSine(x, t0, o.gridHz, level).phi;
  };

  /** The latest fitted maximum that has settled, or NaN. */
  const settledMaximum = (t: number): number => {
    if (!Number.isFinite(phi) || !Number.isFinite(level)) return NaN;
    const w = (2 * Math.PI) / level;
    const k = Math.floor((w * (t - o.settle * level) - phi) / (2 * Math.PI));
    return (phi + 2 * Math.PI * k) / w;
  };

  /**
   * The prior runs on a DELAYED clock: an anchor reaches it a settle (plus up to an
   * estimate and a frame) after its own time, so a prior advanced to now would find
   * every anchor overdue and decay its confidence once per cycle. Advanced to
   * `now - lag` instead, it sees each anchor when it is due; `publish` extrapolates
   * its state to now at its own tempo, which is what `beatAt` does for any consumer.
   */
  const priorLag = (): number => o.settle * level + o.updateEveryS + 1 / o.gridHz;
  const advancePrior = (t: number) => {
    const target = t - priorLag();
    if (target > priorT) {
      priorT = target;
      prior.advance(target);
    }
  };

  const publish = (t: number): PulseState => {
    if (!Number.isFinite(level)) return { ...UNKNOWN_PULSE, t, candidates };
    const s = prior.state();
    const locked = s.state === 'running' && s.anchors > 0;
    // Running, the beat is projected from the delayed clock to now; in `hold` the prior
    // freezes its own beat, which is behind the projection by the delay: hold the
    // published beat where it got to rather than step it back.
    const beat = Math.max(lastBeat, locked ? s.beat + (t - s.t) / s.period : s.beat);
    lastBeat = beat;
    const phase = beat - Math.floor(beat);
    // Before the prior locks, its period is its own initial guess: report the level.
    return {
      ...s,
      t,
      beat,
      period: locked ? s.period : level,
      tempo: locked ? s.tempo : 60 / level,
      beatsPerBar: 1,
      beatInBar: 0,
      phase: locked ? phase : NaN,
      nextBeatAt: locked ? t + (1 - phase) * s.period : NaN,
      confidence: locked ? Math.max(0, Math.min(1, strength)) * s.confidence : 0,
      level,
      strength: Math.max(0, Math.min(1, strength)),
      candidates,
    };
  };

  return {
    feed(t, value) {
      if (!Number.isFinite(t)) return current;
      const longGap = Number.isFinite(lastValidT) && t - lastValidT > o.windowS / 2;
      if (!Number.isFinite(value)) {
        // Unobserved: a lock is not extrapolated across a long dropout. An unobserved
        // tick only reads the clock: it does not move `lastT`, so a later sample stamped
        // a little earlier (a capture stamp after a tick-time NaN) is still taken.
        if (Number.isFinite(lastNanT) && t <= lastNanT) return current;
        lastNanT = t;
        if (longGap) reset();
        if (Number.isFinite(level)) advancePrior(t);
        current = publish(t);
        return current;
      }
      if (Number.isFinite(lastT) && t <= lastT) return current;
      lastT = t;
      if (longGap) {
        reset();
        lastT = t;
      }
      lastNanT = NaN;
      lastValidT = t;
      samples.push({ t, v: value });
      const cutoff = t - o.windowS - 1 / o.gridHz;
      let drop = 0;
      while (drop < samples.length && samples[drop].t < cutoff) drop++;
      if (drop) samples = samples.slice(drop);
      if (t - lastEstimateT >= o.updateEveryS) {
        lastEstimateT = t;
        estimate(t);
      }
      const tau = settledMaximum(t);
      if (Number.isFinite(tau) && !(tau - lastAnchorT < 0.5 * level)) {
        lastAnchorT = tau;
        const anchor: Anchor = { t: tau, confidence: Math.min(1, strength / o.anchorTrustAt), strength, sharpness: NaN, lateral: 0 };
        prior.update(anchor);
      }
      if (Number.isFinite(level)) advancePrior(t);
      current = publish(t);
      return current;
    },
    state: () => current,
    reset,
  };
}
