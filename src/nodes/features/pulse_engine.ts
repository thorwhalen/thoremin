/**
 * The pulse engine seam (#186 PR F) — the interface an `ictus`-backed engine
 * (`src/ictus`, #178 / #187; on main since #200) fills next, and the interim
 * implementation that fills it today.
 *
 * Shape, from `docs/research/rhythm-from-gesture-research-map.md` §6 and the body
 * map §4: a low-rate observation stream goes through an **anchor detector** (sparse,
 * high-confidence timing candidates — here the extrema of a periodic body channel,
 * each with a confidence in noise units) into a **rhythm inference engine** whose
 * latent state is (period, phase, confidence), read back as a {@link PulseState}.
 * Anchors are observations with likelihoods, never onsets: the engine decides
 * whether one confirms the predicted beat, signals a tempo change, or is noise.
 *
 * The interim engine ({@link createInterimPulseEngine}):
 *  - **Period** from a causal, detrended autocorrelation over the last `windowS`
 *    seconds of the channel, resampled to a fixed grid, searched between `minPeriodS`
 *    and `maxPeriodS`, parabolically interpolated. The top peaks are all reported
 *    (`candidates`) because the harmonics are the point — beat vs bar is the
 *    consumer's decision (the pace controller is octave-agnostic).
 *  - **Phase** from a phase-locked loop on the anchors: the next anchor is predicted
 *    one period after the last; an arriving anchor's residual (wrapped to half a
 *    period) corrects the phase by `phaseGain` and the period by `periodGain` — a
 *    degenerate Large–Kolen oscillator, which #178 notes is what an oscillator is.
 *  - **Confidence** is the ACF peak height (0..1) scaled by how regular the recent
 *    anchors have been.
 *
 * Pure and Node-safe: no DAG, no DOM. Time is whatever clock the caller passes
 * (the engine's `ctx.time`), so a replay is deterministic.
 */

/** What the engine reports each tick: the SSOT of musical time for its consumers. */
export interface PulseState {
  /** Seconds per pulse, or NaN before anything is known. */
  periodS: number;
  /** `60 / periodS`, or NaN. */
  bpm: number;
  /** Position within the current pulse, 0 (at the anchor) .. 1, or NaN. */
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

/** A timing candidate from the anchor detector: an instant with a confidence. */
export interface Anchor {
  t: number;
  /** Prominence in noise units (multiples of the channel's own jitter). */
  strength: number;
}

/** The seam `ictus` fills. Everything a consumer needs is on `state()`. */
export interface PulseEngine {
  /** Feed one sample of the observed channel at time `t` (seconds, monotonic). */
  push(t: number, value: number): void;
  /** The current latent state (cheap; recomputation is rate-limited internally). */
  state(): PulseState;
  /** Forget everything (a body left the frame; a swap into a running graph). */
  reset(): void;
}

export interface InterimPulseOptions {
  /** Seconds of history the period estimate sees. */
  windowS?: number;
  /** The grid the channel is resampled onto for the autocorrelation, in Hz. */
  gridHz?: number;
  /** Period search range, seconds. */
  minPeriodS?: number;
  maxPeriodS?: number;
  /** Seconds between period re-estimates (the ACF is the costly part). */
  updateEveryS?: number;
  /** Moving-average span for detrending, seconds. */
  detrendS?: number;
  /** Anchor prominence threshold, in MAD units of the detrended channel. */
  anchorMinStrength?: number;
  /** Phase-lock correction fractions per anchor. */
  phaseGain?: number;
  periodGain?: number;
  /** ACF strength below which the engine reports no pulse at all. */
  minStrength?: number;
  /** ACF strength a NON-harmonic winner needs before the locked period switches to it:
   *  a tempo change needs a clear peak; a weak, unrelated peak only lowers confidence. */
  switchStrength?: number;
}

const DEFAULTS: Required<InterimPulseOptions> = {
  windowS: 5,
  gridHz: 30,
  minPeriodS: 0.25,
  maxPeriodS: 2.5,
  updateEveryS: 0.25,
  detrendS: 1,
  anchorMinStrength: 1.5,
  phaseGain: 0.5,
  periodGain: 0.1,
  minStrength: 0.15,
  switchStrength: 0.3,
};

interface Sample {
  t: number;
  v: number;
}

/** Linear resample of (t, v) samples onto a uniform grid ending at the last sample. */
function resample(samples: Sample[], hz: number, windowS: number): { t0: number; x: number[] } {
  const tEnd = samples[samples.length - 1].t;
  const n = Math.floor(windowS * hz);
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
  return { t0, x };
}

/** Subtract a centred moving average of `span` samples (a cheap high-pass). */
function detrend(x: number[], span: number): number[] {
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

/** Normalised autocorrelation peaks in [minLag, maxLag], strongest first. */
function acfPeaks(x: number[], minLag: number, maxLag: number, k = 4): Array<{ lag: number; r: number }> {
  const n = x.length;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const e = x.map((v) => v - mean);
  let a0 = 0;
  for (const v of e) a0 += v * v;
  if (!(a0 > 0)) return [];
  const hi = Math.min(maxLag + 1, n - 2);
  const ac = new Array<number>(hi + 2).fill(0);
  for (let lag = Math.max(0, minLag - 1); lag <= hi + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += e[i] * e[i - lag];
    ac[lag] = s / a0;
  }
  const peaks: Array<{ lag: number; r: number }> = [];
  for (let lag = Math.max(1, minLag); lag <= hi; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > 0) {
      // Parabolic interpolation of the peak position.
      const l = ac[lag - 1];
      const c = ac[lag];
      const r = ac[lag + 1];
      const denom = l - 2 * c + r;
      const d = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
      peaks.push({ lag: lag + d, r: c });
    }
  }
  return peaks.sort((p, q) => q.r - p.r).slice(0, k);
}

/** Median absolute deviation (a robust sigma) of a series. */
function mad(x: number[]): number {
  const s = [...x].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const d = x.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)] || 0;
}

export function createInterimPulseEngine(opts: InterimPulseOptions = {}): PulseEngine {
  const o = { ...DEFAULTS, ...opts };
  let samples: Sample[] = [];
  let lastEstimateT = -Infinity;
  let candidates: Array<{ periodS: number; r: number }> = [];
  let period = NaN;
  let strength = 0;
  let lastAnchorT = NaN;
  let anchorGaps: number[] = [];
  let sigma = 0; // MAD of the detrended channel, the anchor's noise unit
  let lastT = NaN;

  const reset = () => {
    samples = [];
    lastEstimateT = -Infinity;
    candidates = [];
    period = NaN;
    strength = 0;
    lastAnchorT = NaN;
    anchorGaps = [];
    sigma = 0;
    lastT = NaN;
  };

  /** Re-estimate the period from the window (rate-limited by the caller). */
  const estimate = (): void => {
    const span = samples[samples.length - 1].t - samples[0].t;
    if (span < Math.max(2 * o.minPeriodS, 1)) return;
    const windowS = Math.min(o.windowS, span);
    const { x } = resample(samples, o.gridHz, windowS);
    const d = detrend(x, o.detrendS * o.gridHz);
    sigma = mad(d);
    const peaks = acfPeaks(d, Math.round(o.minPeriodS * o.gridHz), Math.round(o.maxPeriodS * o.gridHz));
    candidates = peaks.map((p) => ({ periodS: p.lag / o.gridHz, r: p.r }));
    if (!candidates.length || candidates[0].r < o.minStrength) {
      strength = candidates[0]?.r ?? 0;
      period = NaN;
      return;
    }
    strength = candidates[0].r;
    if (!Number.isFinite(period)) {
      period = candidates[0].periodS;
    } else {
      // Keep the locked period unless the ACF's winner is clearly a different tempo
      // (not a harmonic of the current one): a stable estimate matters more than a
      // quick one for a pace controller.
      const best = candidates[0].periodS;
      const ratio = best / period;
      const harmonic = [0.5, 1, 2].some((h) => Math.abs(ratio - h) < 0.12 * h);
      if (harmonic) period += (best * (ratio < 0.75 ? 2 : ratio > 1.5 ? 0.5 : 1) - period) * 0.25;
      else if (candidates[0].r >= o.switchStrength) period = best;
      // else: a weak unrelated peak — hold the locked period; `strength` already dropped.
    }
  };

  /**
   * Anchor detection: the sample before last is a local maximum of the raw channel
   * (the bottom of a bounce in image coordinates, y down) over a short neighbourhood,
   * and its prominence over the channel's minimum across the last half period, in
   * MAD units of the detrended channel, clears the threshold. Prominence is measured
   * against the half-period trough, not the adjacent samples: a smooth bounce differs
   * from its neighbours by almost nothing and from its trough by its whole amplitude.
   */
  const detectAnchor = (): Anchor | null => {
    const n = samples.length;
    if (n < 5 || !(sigma > 0)) return null;
    const i = n - 2;
    const b = samples[i].v;
    for (let k = Math.max(0, i - 2); k <= n - 1; k++) {
      if (k === i) continue;
      if (samples[k].v > b || (samples[k].v === b && k > i)) return null;
    }
    const lookback = Number.isFinite(period) ? period / 2 : o.minPeriodS;
    let trough = b;
    for (let k = i - 1; k >= 0 && samples[i].t - samples[k].t <= lookback; k--) trough = Math.min(trough, samples[k].v);
    const prominence = (b - trough) / sigma;
    if (prominence < o.anchorMinStrength) return null;
    return { t: samples[i].t, strength: prominence };
  };

  const acceptAnchor = (anchor: Anchor): void => {
    if (!Number.isFinite(period)) return;
    if (!Number.isFinite(lastAnchorT)) {
      lastAnchorT = anchor.t;
      return;
    }
    const gap = anchor.t - lastAnchorT;
    if (gap < 0.5 * period) return; // too soon: the same event, or noise
    // Residual against the prediction, wrapped to half a period.
    const predicted = lastAnchorT + Math.round(gap / period) * period;
    let err = anchor.t - predicted;
    err = ((err + period / 2) % period + period) % period - period / 2;
    lastAnchorT = predicted + err * o.phaseGain;
    // The period follows the residual a little (a tempo change shows up as a drift).
    period += (err / Math.max(1, Math.round(gap / period))) * o.periodGain;
    anchorGaps.push(gap);
    if (anchorGaps.length > 8) anchorGaps.shift();
  };

  return {
    push(t, value) {
      if (!Number.isFinite(t) || !Number.isFinite(value)) return;
      if (Number.isFinite(lastT) && t <= lastT) return; // non-monotonic: ignore
      lastT = t;
      samples.push({ t, v: value });
      const cutoff = t - o.windowS - 0.5;
      let drop = 0;
      while (drop < samples.length && samples[drop].t < cutoff) drop++;
      if (drop) samples = samples.slice(drop);
      if (t - lastEstimateT >= o.updateEveryS) {
        lastEstimateT = t;
        estimate();
      }
      const anchor = detectAnchor();
      if (anchor) acceptAnchor(anchor);
    },
    state() {
      if (!Number.isFinite(period) || !samples.length) {
        return { ...UNKNOWN_PULSE, candidates };
      }
      const t = samples[samples.length - 1].t;
      // Regularity: how consistent the recent anchor gaps are with the period.
      const regularity = anchorGaps.length
        ? Math.max(0, 1 - (anchorGaps.reduce((s, g) => s + Math.abs(g / period - Math.round(g / period)), 0) / anchorGaps.length) * 2)
        : 0.5;
      const confidence = Math.max(0, Math.min(1, strength)) * regularity;
      const haveAnchor = Number.isFinite(lastAnchorT);
      const phase = haveAnchor ? (((t - lastAnchorT) / period) % 1 + 1) % 1 : NaN;
      const nextAnchorT = haveAnchor ? lastAnchorT + (Math.floor((t - lastAnchorT) / period) + 1) * period : NaN;
      return {
        periodS: period,
        bpm: 60 / period,
        phase,
        confidence,
        lastAnchorT,
        nextAnchorT,
        candidates,
      };
    },
    reset,
  };
}
