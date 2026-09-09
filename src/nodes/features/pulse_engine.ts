/**
 * The pulse engine seam (#186 PR F) — the interface an `ictus`-backed engine
 * (`src/ictus`, #178 / #187; on main since #200) fills next, and the interim
 * implementation that fills it today, built from two exported parts so the
 * adapter can reuse them rather than copy them.
 *
 * Shape, from `docs/research/rhythm-from-gesture-research-map.md` §6 and the body
 * map §4: a low-rate observation stream goes through an **anchor detector** (sparse
 * timing candidates with a confidence) into a **rhythm inference engine** whose
 * latent state is (period, phase, confidence), read back as a {@link PulseState}.
 * Anchors are observations with likelihoods, never onsets: the engine weighs each
 * by its strength when it corrects the phase.
 *
 * The parts:
 *  - {@link createAcfPeriodEstimator}: a causal, detrended autocorrelation over the
 *    last `windowS` seconds of the channel, resampled to a fixed grid, searched
 *    between `minPeriodS` and `maxPeriodS`, parabolically interpolated, and
 *    normalised per lag by the overlapping segments' energies (so a slow dancer's
 *    peak is not crushed by the shrinking overlap — the plain `/a0` estimator caps
 *    a perfectly regular 2.4 s bounce at r ≈ 0.4). The top peaks are all reported
 *    (`candidates`): the harmonics are the point, beat vs bar is the consumer's call.
 *  - {@link createExtremaAnchorDetector}: a median-3 filtered local maximum of the
 *    channel (the DOWN extremum: the lowest point of a bounce, y down) whose
 *    prominence over the trough of the last half period clears a threshold in
 *    multiples of the detrended channel's MAD. A candidate is held for a
 *    quarter-period refractory and replaced by a higher one arriving inside it.
 *  - {@link createInterimPulseEngine}: composes them with a phase-locked loop — the
 *    next anchor is predicted one period after the last; an arriving anchor's
 *    residual (wrapped to half a period) corrects the phase and the period by
 *    gains scaled by the anchor's strength; a weak unrelated ACF winner lowers
 *    confidence instead of switching the tempo. A NaN sample or a gap longer than
 *    half the window drops the lock (a stale, fully-confident pulse must never be
 *    extrapolated across a dropout).
 *
 * Phase convention: **phase 0 is the down extremum** (the landing of a bounce). For
 * a dancer bouncing down on the beat that is the beat; for an up-groove it is the
 * off-beat, and a consumer that cannot know which should treat 0 and 0.5 alike
 * (the pace controller does). Pure and Node-safe; time is the caller's clock.
 */

/** What the engine reports each tick: the SSOT of musical time for its consumers. */
export interface PulseState {
  /** Seconds per pulse, or NaN before anything is known. */
  periodS: number;
  /** `60 / periodS`, or NaN. */
  bpm: number;
  /** Position within the current pulse, 0 (at the down extremum) .. 1, or NaN. */
  phase: number;
  /** 0..1: how much to trust `periodS` / `phase`. 0 when nothing is known. */
  confidence: number;
  /** The time of the last accepted anchor, or NaN. */
  lastAnchorT: number;
  /** The forecast time of the next anchor, or NaN. */
  nextAnchorT: number;
  /** The autocorrelation's top peaks (period, strength), strongest first. */
  candidates: ReadonlyArray<{ periodS: number; r: number }>;
}

export const UNKNOWN_PULSE: PulseState = {
  periodS: NaN,
  bpm: NaN,
  phase: NaN,
  confidence: 0,
  lastAnchorT: NaN,
  nextAnchorT: NaN,
  candidates: [],
};

/**
 * The confidence below which a consumer should HOLD its last decision rather than
 * follow the pulse. Measured on the real dancer fixture (`test/body_pulse.test.ts`):
 * above it the estimate sits on a harmonic of the music's beat; below it the ACF
 * has no clear winner. The pace controller (PR H) reads this constant.
 */
export const PULSE_HOLD_CONFIDENCE = 0.2;

/** A timing candidate from the anchor detector: an instant with a strength. */
export interface PulseAnchor {
  t: number;
  /** Prominence of the extremum over the recent trough, in multiples of the detrended
   *  channel's median absolute deviation — amplitude-relative (a clean bounce reads
   *  about 3 whatever the tracking jitter), NOT the trainer's frame-to-frame noise unit. */
  strength: number;
}

/** The seam `ictus` fills. Everything a consumer needs is on `state()`. */
export interface PulseEngine {
  /** Feed one sample of the observed channel at time `t` (seconds, monotonic). NaN
   *  means "no observation this tick" and weakens the lock. */
  push(t: number, value: number): void;
  /** The current latent state (cheap; recomputation is rate-limited internally). */
  state(): PulseState;
  /** Forget everything (a body left the frame; a swap into a running graph). */
  reset(): void;
}

// ---- The period estimator ----------------------------------------------------

export interface AcfPeriodOptions {
  /** Seconds of history the estimate sees. */
  windowS?: number;
  /** The grid the channel is resampled onto, in Hz. */
  gridHz?: number;
  /** Period search range, seconds. */
  minPeriodS?: number;
  maxPeriodS?: number;
  /** Moving-average span for detrending, seconds. */
  detrendS?: number;
  /** How many peaks to report. */
  topK?: number;
}

export interface PeriodEstimate {
  /** ACF peaks (period, strength), strongest first; empty when nothing is periodic. */
  candidates: Array<{ periodS: number; r: number }>;
  /** Median absolute deviation of the detrended channel (the anchor's unit). */
  sigma: number;
}

interface Sample {
  t: number;
  v: number;
}

/** Linear resample of (t, v) samples onto a uniform grid ending at the last sample. */
function resample(samples: readonly Sample[], hz: number, windowS: number): number[] {
  const tEnd = samples[samples.length - 1].t;
  const n = Math.max(2, Math.floor(windowS * hz));
  const t0 = tEnd - (n - 1) / hz;
  const x = new Array<number>(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / hz;
    while (j < samples.length - 2 && samples[j + 1].t < t) j++;
    const a = samples[j];
    const b = samples[Math.min(j + 1, samples.length - 1)];
    if (t <= a.t) x[i] = a.v;
    else if (b.t <= a.t) x[i] = b.v;
    else x[i] = a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
  }
  return x;
}

/** Subtract a centred moving average of `span` samples (a cheap high-pass). */
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

/** Median absolute deviation (a robust sigma) of a series. */
export function mad(x: readonly number[]): number {
  if (!x.length) return 0;
  const s = [...x].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const d = x.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 0;
}

/**
 * Normalised autocorrelation peaks in [minLag, maxLag], strongest first. Each lag is
 * normalised by the geometric mean of the two overlapping segments' energies, so a
 * long lag with a short overlap is not penalised for the overlap it lacks.
 */
export function acfPeaks(x: readonly number[], minLag: number, maxLag: number, k = 4): Array<{ lag: number; r: number }> {
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
    const eA = cum[n] - cum[lag];
    const eB = cum[n - lag];
    const den = Math.sqrt(eA * eB);
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

/** A stateless period estimate over a sample window (the callers own the window). */
export function createAcfPeriodEstimator(opts: AcfPeriodOptions = {}) {
  const o = { windowS: 5, gridHz: 30, minPeriodS: 0.25, maxPeriodS: 2.5, detrendS: 1, topK: 4, ...opts };
  return {
    options: o,
    estimate(samples: readonly Sample[]): PeriodEstimate | null {
      if (samples.length < 4) return null;
      const span = samples[samples.length - 1].t - samples[0].t;
      if (span < Math.max(2 * o.minPeriodS, 1)) return null;
      const x = resample(samples, o.gridHz, Math.min(o.windowS, span));
      const d = detrend(x, o.detrendS * o.gridHz);
      const peaks = acfPeaks(d, Math.round(o.minPeriodS * o.gridHz), Math.round(o.maxPeriodS * o.gridHz), o.topK);
      return { candidates: peaks.map((p) => ({ periodS: p.lag / o.gridHz, r: p.r })), sigma: mad(d) };
    },
  };
}

// ---- The anchor detector ------------------------------------------------------

export interface ExtremaDetectorOptions {
  /** Prominence threshold, in MAD units of the detrended channel. */
  minStrength?: number;
  /** Fraction of the period a candidate is held before it is final (a higher one
   *  arriving inside it replaces it). Before the period is known, `fallbackS` is used. */
  refractory?: number;
  fallbackS?: number;
}

/**
 * The down-extremum detector. `push` takes the raw sample and the current `sigma`
 * (MAD of the detrended channel) and `period` (NaN before it is known); it returns a
 * FINAL anchor when a held candidate's refractory has elapsed, else null.
 */
export function createExtremaAnchorDetector(opts: ExtremaDetectorOptions = {}) {
  const o = { minStrength: 1.5, refractory: 0.25, fallbackS: 0.25, ...opts };
  let recent: Sample[] = [];
  let filtered: Sample[] = [];
  let pending: PulseAnchor | null = null;
  const reset = () => {
    recent = [];
    filtered = [];
    pending = null;
  };
  return {
    reset,
    push(sample: Sample, sigma: number, period: number): PulseAnchor | null {
      recent.push(sample);
      if (recent.length > 3) recent.shift();
      if (recent.length < 3) return null;
      // Median-3: the filtered sample is one frame behind the raw one.
      const vs = recent.map((s) => s.v).sort((a, b) => a - b);
      filtered.push({ t: recent[1].t, v: vs[1] });
      const lookback = Number.isFinite(period) ? period / 2 : o.fallbackS;
      const keepFrom = filtered[filtered.length - 1].t - lookback - 0.5;
      let drop = 0;
      while (drop < filtered.length && filtered[drop].t < keepFrom) drop++;
      if (drop) filtered = filtered.slice(drop);
      const n = filtered.length;
      let out: PulseAnchor | null = null;
      if (n >= 3 && sigma > 0) {
        const i = n - 2;
        const b = filtered[i].v;
        if (b > filtered[i - 1].v && b >= filtered[i + 1].v) {
          let trough = b;
          for (let k = i - 1; k >= 0 && filtered[i].t - filtered[k].t <= lookback; k--) trough = Math.min(trough, filtered[k].v);
          const strength = (b - trough) / sigma;
          if (strength >= o.minStrength) {
            const cand: PulseAnchor = { t: filtered[i].t, strength };
            if (!pending || cand.strength > pending.strength) pending = cand;
          }
        }
      }
      const hold = Number.isFinite(period) ? o.refractory * period : o.fallbackS;
      if (pending && sample.t - pending.t >= hold) {
        out = pending;
        pending = null;
      }
      return out;
    },
  };
}

// ---- The engine ----------------------------------------------------------------

export interface InterimPulseOptions extends AcfPeriodOptions {
  /** Seconds between period re-estimates (the ACF is the costly part). */
  updateEveryS?: number;
  /** Anchor prominence threshold, in MAD units of the detrended channel. */
  anchorMinStrength?: number;
  /** Phase-lock correction fractions per anchor, at full anchor strength. */
  phaseGain?: number;
  periodGain?: number;
  /** ACF strength below which the engine reports no pulse at all. */
  minStrength?: number;
  /** ACF strength a NON-harmonic winner needs before the locked period switches to it. */
  switchStrength?: number;
}

const DEFAULTS = {
  windowS: 5,
  gridHz: 30,
  minPeriodS: 0.25,
  maxPeriodS: 2.5,
  detrendS: 1,
  topK: 4,
  updateEveryS: 0.25,
  anchorMinStrength: 1.5,
  phaseGain: 0.5,
  periodGain: 0.1,
  minStrength: 0.15,
  switchStrength: 0.3,
};

export function createInterimPulseEngine(opts: InterimPulseOptions = {}): PulseEngine {
  const o = { ...DEFAULTS, ...opts };
  const estimator = createAcfPeriodEstimator(o);
  const detector = createExtremaAnchorDetector({ minStrength: o.anchorMinStrength });
  let samples: Sample[] = [];
  let lastEstimateT = -Infinity;
  let candidates: Array<{ periodS: number; r: number }> = [];
  let period = NaN;
  let strength = 0;
  let sigma = 0;
  let lastAnchorT = NaN;
  let anchorGaps: number[] = [];
  let lastT = NaN;
  let lastValidT = NaN;

  const dropLock = () => {
    lastAnchorT = NaN;
    anchorGaps = [];
  };

  const reset = () => {
    samples = [];
    lastEstimateT = -Infinity;
    candidates = [];
    period = NaN;
    strength = 0;
    sigma = 0;
    lastT = NaN;
    lastValidT = NaN;
    dropLock();
    detector.reset();
  };

  const estimate = (): void => {
    const est = estimator.estimate(samples);
    if (!est) return;
    sigma = est.sigma;
    candidates = est.candidates;
    if (!candidates.length || candidates[0].r < o.minStrength) {
      strength = candidates[0]?.r ?? 0;
      period = NaN;
      dropLock();
      return;
    }
    strength = candidates[0].r;
    if (!Number.isFinite(period)) {
      period = candidates[0].periodS;
      return;
    }
    // Keep the locked period unless the ACF's winner is clearly a different tempo (not
    // a harmonic of the current one) AND clearly present: a stable estimate matters
    // more than a quick one for a pace controller, and a weak unrelated peak is noise.
    const best = candidates[0].periodS;
    const ratio = best / period;
    const harmonic = [0.5, 1, 2].some((h) => Math.abs(ratio - h) < 0.12 * h);
    if (harmonic) period += (best * (ratio < 0.75 ? 2 : ratio > 1.5 ? 0.5 : 1) - period) * 0.25;
    else if (candidates[0].r >= o.switchStrength) {
      period = best;
      dropLock();
    }
  };

  const acceptAnchor = (anchor: PulseAnchor): void => {
    if (!Number.isFinite(period)) return;
    // The anchor's weight: full trust at three MAD and above, proportionally less below.
    const w = Math.max(0, Math.min(1, anchor.strength / 3));
    if (!Number.isFinite(lastAnchorT)) {
      lastAnchorT = anchor.t;
      return;
    }
    const gap = anchor.t - lastAnchorT;
    if (gap < 0.5 * period) return; // too soon: the same event, or noise
    const cycles = Math.max(1, Math.round(gap / period));
    const predicted = lastAnchorT + cycles * period;
    let err = anchor.t - predicted;
    err = ((((err + period / 2) % period) + period) % period) - period / 2;
    lastAnchorT = predicted + err * o.phaseGain * w;
    // The period follows the residual a little (a tempo change shows up as a drift).
    period = Math.max(o.minPeriodS, Math.min(o.maxPeriodS, period + (err / cycles) * o.periodGain * w));
    anchorGaps.push(gap);
    if (anchorGaps.length > 8) anchorGaps.shift();
  };

  return {
    push(t, value) {
      if (!Number.isFinite(t)) return;
      if (Number.isFinite(lastT) && t <= lastT) return; // non-monotonic: ignore
      lastT = t;
      if (!Number.isFinite(value)) {
        // No observation: the lock cannot be extrapolated across a dropout longer
        // than half the window; the period estimate itself decays with its window.
        if (Number.isFinite(lastValidT) && t - lastValidT > o.windowS / 2) {
          dropLock();
          samples = [];
          detector.reset();
          lastValidT = NaN;
        }
        return;
      }
      if (Number.isFinite(lastValidT) && t - lastValidT > o.windowS / 2) {
        // A gap this long is a new take: start the window over.
        samples = [];
        dropLock();
        detector.reset();
      }
      lastValidT = t;
      samples.push({ t, v: value });
      const cutoff = t - o.windowS - 0.5;
      let drop = 0;
      while (drop < samples.length && samples[drop].t < cutoff) drop++;
      if (drop) samples = samples.slice(drop);
      if (t - lastEstimateT >= o.updateEveryS) {
        lastEstimateT = t;
        estimate();
      }
      const anchor = detector.push({ t, v: value }, sigma, period);
      if (anchor) acceptAnchor(anchor);
    },
    state() {
      if (!Number.isFinite(period) || !samples.length) return { ...UNKNOWN_PULSE, candidates };
      const t = lastT;
      const regularity = anchorGaps.length
        ? Math.max(0, 1 - (anchorGaps.reduce((s, g) => s + Math.abs(g / period - Math.round(g / period)), 0) / anchorGaps.length) * 2)
        : 0.5;
      const confidence = Math.max(0, Math.min(1, strength)) * regularity;
      const haveAnchor = Number.isFinite(lastAnchorT);
      const phase = haveAnchor ? ((((t - lastAnchorT) / period) % 1) + 1) % 1 : NaN;
      const nextAnchorT = haveAnchor ? lastAnchorT + (Math.floor((t - lastAnchorT) / period) + 1) * period : NaN;
      return { periodS: period, bpm: 60 / period, phase, confidence, lastAnchorT, nextAnchorT, candidates };
    },
    reset,
  };
}
