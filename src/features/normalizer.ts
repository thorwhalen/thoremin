/**
 * Online per-feature normalizer — the fix for "heterogeneous feature ranges".
 *
 * Face and hand features span wildly different magnitudes and distributions
 * (blendshapes 0..1, curls 0..3pi rad, gaze offsets ~+/-1, head pose in degrees,
 * pinch/gap as open-ended palm-span ratios). To read them as comparable levels on
 * one grid of meters, each feature's raw value is mapped to 0..1 against
 * statistics accumulated ONLINE from the moment the lab turns on, robust to the
 * performer continuously changing their range (drift).
 *
 * Per feature we maintain (all O(1) per sample):
 *  - a Welford cumulative mean/variance (numerically stable baseline);
 *  - an exponentially-weighted (EW) mean + variance for drift, with the EW factor
 *    derived from the ACTUAL frame `dt` (`alpha = 1 - exp(-dt/tau)`) — rAF/audio
 *    dt is jittery, so a constant-fps alpha would drift;
 *  - an EW-decayed min/max ENVELOPE (the default display range) — expands
 *    instantly to a new extreme, forgets old extremes slowly (NOT a windowed
 *    min/max);
 *  - interior quantile estimates (the percentile band the meter draws as ticks)
 *    via an ADDITIVE deterministic-update rule (Robbins-Monro), envelope-scaled so
 *    it works for signed/zero-centered features where the multiplicative DUMIQE
 *    step collapses; kept monotone across quantiles by a read-time guard.
 *
 * Guards (each a load-bearing correction from the #119 appendix): NaN/Inf inputs
 * are rejected before they can permanently poison a running mean; a degenerate
 * range never divides to Infinity; per-feature and global {@link reset} re-zero
 * the stats; a `tanh` squash option keeps the very peaks legible instead of
 * hard-clipping everything past the top of the range to exactly 1.
 *
 * Pure and headlessly unit-testable (no DOM/audio/time source — `dt` is passed in).
 */

/** How a raw value maps to a 0..1 display level. */
export type NormalizerMode = 'minmax' | 'quantile' | 'zscore';

export interface NormalizerOptions {
  /** Display mapping (default `'minmax'`: the EW min/max envelope). */
  mode?: NormalizerMode;
  /** EW time constant (seconds) for the drift mean/variance + quantile step. */
  tau?: number;
  /** EW time constant (seconds) for the min/max envelope contraction (longer =
   *  the bar remembers extremes longer). */
  envelopeTau?: number;
  /** Frames of warm-up before the `quantile` mapping is trusted (crossfaded in). */
  warmup?: number;
  /** Final saturation: `'clamp'` hard-clips to [0,1]; `'tanh'` softly saturates so
   *  values past the range stay distinguishable (musicians explore the peaks). */
  squash?: 'clamp' | 'tanh';
  /** The quantiles the band is drawn at (must include 0 and 1). Default the
   *  quartiles: min, p25, median, p75, max. */
  markers?: number[];
}

const DEFAULTS = {
  mode: 'minmax' as NormalizerMode,
  tau: 6,
  envelopeTau: 20,
  warmup: 20,
  squash: 'clamp' as const,
  markers: [0, 0.25, 0.5, 0.75, 1],
};

/** Frames over which the quantile mapping is crossfaded in after warm-up. */
const FADE_FRAMES = 15;
const EPS = 1e-9;

interface FeatureStat {
  n: number;
  mean: number;
  M2: number;
  ewMean: number;
  ewVar: number;
  lo: number;
  hi: number;
  /** Interior-quantile estimates, aligned with {@link interiorMarkers}. */
  q: number[];
  init: boolean;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class OnlineNormalizer {
  private readonly opts: Required<NormalizerOptions>;
  private readonly interiorMarkers: number[];
  private readonly stats = new Map<string, FeatureStat>();

  constructor(options: NormalizerOptions = {}) {
    const markers = (options.markers ?? DEFAULTS.markers).slice().sort((a, b) => a - b);
    this.opts = {
      mode: options.mode ?? DEFAULTS.mode,
      tau: options.tau ?? DEFAULTS.tau,
      envelopeTau: options.envelopeTau ?? DEFAULTS.envelopeTau,
      warmup: options.warmup ?? DEFAULTS.warmup,
      squash: options.squash ?? DEFAULTS.squash,
      markers,
    };
    // Interior markers = every tracked quantile strictly inside (0, 1); 0 and 1
    // are read off the min/max envelope, not estimated.
    this.interiorMarkers = markers.filter((p) => p > EPS && p < 1 - EPS);
  }

  /** The display mode (for the caller to reflect in the UI). */
  get mode(): NormalizerMode {
    return this.opts.mode;
  }

  /** Switch the display mapping live. The mapping is computed on read, so this is
   *  instant and loses no accumulated statistics. */
  setMode(mode: NormalizerMode): void {
    this.opts.mode = mode;
  }

  /**
   * Fold one raw observation of feature `id` into its running statistics.
   * Non-finite inputs (NaN/Inf) are rejected — a single NaN would permanently
   * corrupt every running estimate. `dt` is the seconds since the previous frame
   * (a positive fallback is used for the first/degenerate frame).
   */
  observe(id: string, x: number, dt: number): void {
    if (!Number.isFinite(x)) return;
    const st = this.ensure(id);
    const step = dt > EPS ? dt : 1 / 60;
    const alpha = 1 - Math.exp(-step / this.opts.tau);
    const envAlpha = 1 - Math.exp(-step / this.opts.envelopeTau);

    // Welford cumulative mean/variance.
    st.n += 1;
    const delta = x - st.mean;
    st.mean += delta / st.n;
    st.M2 += delta * (x - st.mean);

    if (!st.init) {
      st.ewMean = x;
      st.ewVar = 0;
      st.lo = x;
      st.hi = x;
      st.q = this.interiorMarkers.map(() => x);
      st.init = true;
      return;
    }

    // EW mean + variance (West/Finch): recent samples weigh more.
    const d = x - st.ewMean;
    st.ewMean += alpha * d;
    st.ewVar = (1 - alpha) * (st.ewVar + alpha * d * d);

    // EW-decayed min/max envelope: instant expand, slow contract.
    st.lo = x < st.lo ? x : st.lo + envAlpha * (x - st.lo);
    st.hi = x > st.hi ? x : st.hi + envAlpha * (x - st.hi);

    // Additive (Robbins-Monro) quantile update, envelope-scaled so it works for
    // signed features. For target quantile p: q += a*(hi-lo)*(p - I(x <= q)).
    const spread = st.hi - st.lo;
    const qStep = alpha * (spread > EPS ? spread : Math.abs(x) + EPS);
    for (let k = 0; k < this.interiorMarkers.length; k++) {
      const p = this.interiorMarkers[k];
      const indicator = x <= st.q[k] ? 1 : 0;
      st.q[k] += qStep * (p - indicator);
    }
  }

  /**
   * Map the current raw value `x` of feature `id` to a 0..1 display level, per the
   * configured {@link NormalizerMode}. Returns `NaN` when the feature is unknown,
   * un-warmed, or `x` is non-finite (the caller draws no bar).
   */
  level(id: string, x: number): number {
    if (!Number.isFinite(x)) return NaN;
    const st = this.stats.get(id);
    if (!st || !st.init) return NaN;
    return this.map(st, x);
  }

  /**
   * The percentile band for feature `id` as 0..1 bar positions (each configured
   * marker quantile mapped through the SAME level() function, so the ticks align
   * with the bar). Empty until the feature has enough samples to be meaningful.
   */
  markers(id: string): number[] {
    const st = this.stats.get(id);
    if (!st || !st.init || st.n < 5) return [];
    const raws = this.markerRaws(st);
    return raws.map((r) => this.map(st, r));
  }

  /** The raw marker values (min, interior quantiles monotone-guarded, max). */
  private markerRaws(st: FeatureStat): number[] {
    // Enforce non-decreasing interior quantiles (independent estimators can cross)
    // and clamp them within the envelope.
    const guarded: number[] = [];
    let prev = st.lo;
    for (const qk of st.q) {
      const v = Math.min(Math.max(qk, prev), st.hi);
      guarded.push(v);
      prev = v;
    }
    const out: number[] = [];
    for (const p of this.opts.markers) {
      if (p <= EPS) out.push(st.lo);
      else if (p >= 1 - EPS) out.push(st.hi);
      else {
        // Find this marker's interior index.
        const idx = this.interiorMarkers.indexOf(p);
        out.push(idx >= 0 ? guarded[idx] : st.lo);
      }
    }
    return out;
  }

  /** The core raw→level mapping, shared by level() and markers() so they agree. */
  private map(st: FeatureStat, x: number): number {
    const { mode, squash, warmup } = this.opts;
    let u: number;
    if (mode === 'zscore') {
      const std = Math.sqrt(st.ewVar);
      u = std < EPS ? 0.5 : 0.5 + 0.5 * Math.tanh((x - st.ewMean) / (2 * std));
      return this.finish(u, squash === 'tanh' ? 'tanh' : 'clamp', true);
    }
    const minmax = this.minmaxLevel(st, x);
    if (mode === 'minmax') return this.finish(minmax, squash);
    // quantile mode: robust scaling around the median with the IQR, crossfaded in
    // from the min/max envelope over the warm-up so there is no visible jump.
    const q = this.quantileLevel(st, x);
    if (Number.isNaN(q)) return this.finish(minmax, squash);
    const t = clamp01((st.n - warmup) / FADE_FRAMES);
    return this.finish(minmax * (1 - t) + q * t, squash);
  }

  private minmaxLevel(st: FeatureStat, x: number): number {
    const range = st.hi - st.lo;
    if (range < EPS) return 0.5;
    return (x - st.lo) / range;
  }

  private quantileLevel(st: FeatureStat, x: number): number {
    if (st.q.length < 1) return NaN;
    const median = st.q[Math.floor((st.q.length - 1) / 2)];
    const qlo = st.q[0];
    const qhi = st.q[st.q.length - 1];
    const iqr = qhi - qlo;
    if (iqr < EPS) return NaN;
    return 0.5 + 0.5 * ((x - median) / iqr);
  }

  private finish(u: number, squash: 'clamp' | 'tanh', alreadyBounded = false): number {
    if (squash === 'tanh' && !alreadyBounded) return 0.5 + 0.5 * Math.tanh(2 * (u - 0.5));
    return clamp01(u);
  }

  /** Reset one feature's stats, or all when `id` is omitted (recalibrate). */
  reset(id?: string): void {
    if (id === undefined) this.stats.clear();
    else this.stats.delete(id);
  }

  /** Whether feature `id` has any accumulated samples. */
  has(id: string): boolean {
    return this.stats.has(id);
  }

  /** Sample count for feature `id` (0 if unseen). */
  count(id: string): number {
    return this.stats.get(id)?.n ?? 0;
  }

  private ensure(id: string): FeatureStat {
    let st = this.stats.get(id);
    if (!st) {
      st = { n: 0, mean: 0, M2: 0, ewMean: 0, ewVar: 0, lo: 0, hi: 0, q: [], init: false };
      this.stats.set(id, st);
    }
    return st;
  }
}
