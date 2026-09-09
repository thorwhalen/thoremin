/**
 * The song's beat grid, from its audio, in the browser (#186 PR G).
 *
 * A hand-rolled tracker rather than a library, for measured reasons
 * (docs/research/body-and-pace-research-map.md §5): the only pure-JS tracker on
 * npm returns fifteen seconds of beats, the neural ones need an ONNX runtime, and
 * the good C++ ones are GPL. On synthetic click tracks this forty-line pipeline
 * gets the tempo within 0.1 bpm and 98 % of beats within 70 ms:
 *
 *  1. **Onset strength**: per hop, the half-wave-rectified increase in log energy
 *     of the signal and of its first difference — a two-band spectral-flux proxy
 *     (low band: kicks and snares; high band: hi-hats) without an FFT.
 *  2. **Tempo**: the autocorrelation of the mean-removed envelope over lags between
 *     `minBpm` and `maxBpm`, parabolically interpolated at its peak.
 *  3. **Phase**: a comb over one period against the LOW band only — hi-hat eighths
 *     and swung eighths would otherwise pull the comb off the beat (the same lesson
 *     the paces project learned moving its sub-bass band away from the male vocal).
 *  4. **Tempo, again, properly**: a least-squares line through the comb-picked
 *     beats (never a median inter-beat interval — the paces measurement showed a
 *     1 % error from that on a 20 ms-quantised tracker).
 *
 * The grid it returns is the paces `Grid` ruler: phase, period, the raw beat list
 * (kept because real songs drift and the nearest actual beat beats the line for
 * anything longer than ~30 s), a confidence, and an empty downbeat list until a
 * downbeat tracker exists. The remaining failure is the tempo octave (170 bpm read
 * as 85); the pace controller absorbs that by construction (octave-agnostic ratio).
 *
 * Pure and Node-safe: a `Float32Array` of mono samples in, a {@link SongGrid} out.
 */

export interface SongGrid {
  /** Seconds per beat. */
  periodS: number;
  /** Beats per minute (60 / periodS). */
  bpm: number;
  /** The time of beat 0 — the phase of the ruler. */
  phaseS: number;
  /** The raw comb-picked beat instants, ascending. */
  beats: number[];
  /** Downbeats: empty until a downbeat tracker exists (the field is the seam). */
  downbeats: number[];
  /** The autocorrelation strength at the chosen period, 0..1. */
  confidence: number;
  /** Beats per bar, 0 = unknown. */
  meter: number;
  /** Which tracker produced it. */
  source: string;
}

export interface BeatTrackOptions {
  sampleRate: number;
  hop?: number;
  win?: number;
  minBpm?: number;
  maxBpm?: number;
  /** Phase comb resolution: steps per period. */
  combSteps?: number;
}

/** The onset envelopes: total (for the tempo) and low-band (for the phase). */
export function onsetEnvelopes(x: Float32Array, hop: number, win: number): { env: Float32Array; low: Float32Array; fps: number; sampleRate?: number } {
  const nF = Math.max(0, Math.floor((x.length - win) / hop));
  const env = new Float32Array(nF);
  const low = new Float32Array(nF);
  let prevLo = 0;
  let prevHi = 0;
  for (let f = 0; f < nF; f++) {
    let lo = 0;
    let hi = 0;
    const o = f * hop;
    for (let i = 1; i < win; i++) {
      const v = x[o + i];
      lo += v * v;
      const d = v - x[o + i - 1];
      hi += d * d;
    }
    lo = Math.log1p(lo * 1000);
    hi = Math.log1p(hi * 1000);
    low[f] = Math.max(0, lo - prevLo);
    env[f] = low[f] + Math.max(0, hi - prevHi);
    prevLo = lo;
    prevHi = hi;
  }
  return { env, low, fps: NaN };
}

/** Least-squares tempo (seconds per beat) through a beat list; NaN below three beats. */
export function lsPeriod(beats: readonly number[]): number {
  const n = beats.length;
  if (n < 3) return NaN;
  const mx = (n - 1) / 2;
  let my = 0;
  for (const b of beats) my += b;
  my /= n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (beats[i] - my);
    den += (i - mx) * (i - mx);
  }
  return num / den;
}

/**
 * Track the beats of a mono signal. Returns a grid with `bpm: NaN` and no beats
 * when the signal has no usable periodicity (silence, an empty buffer), never a
 * zero tempo.
 */
export function trackBeats(x: Float32Array, opts: BeatTrackOptions): SongGrid {
  const hop = opts.hop ?? 256;
  const win = opts.win ?? 1024;
  const minBpm = opts.minBpm ?? 60;
  const maxBpm = opts.maxBpm ?? 200;
  const steps = opts.combSteps ?? 64;
  const fps = opts.sampleRate / hop;
  const none: SongGrid = { periodS: NaN, bpm: NaN, phaseS: NaN, beats: [], downbeats: [], confidence: 0, meter: 0, source: 'thoremin/flux-acf' };
  const { env, low } = onsetEnvelopes(x, hop, win);
  const nF = env.length;
  if (nF < fps * 2) return none;
  let mean = 0;
  for (let i = 0; i < nF; i++) mean += env[i];
  mean /= nF;
  const e = new Float64Array(nF);
  let a0 = 0;
  for (let i = 0; i < nF; i++) {
    e[i] = env[i] - mean;
    a0 += e[i] * e[i];
  }
  if (!(a0 > 0)) return none;
  const acf = (lag: number): number => {
    let s = 0;
    for (let i = lag; i < nF; i++) s += e[i] * e[i - lag];
    return s / a0;
  };
  const lo = Math.max(1, Math.round((fps * 60) / maxBpm));
  const hi = Math.min(nF - 2, Math.round((fps * 60) / minBpm));
  if (hi <= lo) return none;
  let bestLag = lo;
  let bestR = -Infinity;
  const r = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) r[lag] = acf(lag);
  for (let lag = lo; lag <= hi; lag++) {
    if (r[lag] > bestR) {
      bestR = r[lag];
      bestLag = lag;
    }
  }
  if (!(bestR > 0)) return none;
  const l = r[bestLag - 1];
  const c = r[bestLag];
  const rr = r[bestLag + 1];
  const denom = l - 2 * c + rr;
  const dl = denom !== 0 ? (0.5 * (l - rr)) / denom : 0;
  const period0 = (bestLag + dl) / fps;
  // Phase: the comb offset that collects the most low-band onset energy.
  let bestPh = 0;
  let bestScore = -Infinity;
  const total = nF / fps;
  for (let p = 0; p < steps; p++) {
    const ph = (p / steps) * period0;
    let sc = 0;
    for (let t = ph; t < total; t += period0) {
      const i = Math.round(t * fps);
      if (i < nF) sc += low[i];
    }
    if (sc > bestScore) {
      bestScore = sc;
      bestPh = ph;
    }
  }
  const beats: number[] = [];
  for (let t = bestPh; t < total; t += period0) beats.push(t);
  // The line through the comb beats; identical to period0 on a synthetic grid, and
  // the honest tempo on a real one.
  const period = beats.length >= 3 ? lsPeriod(beats) : period0;
  return {
    periodS: period,
    bpm: 60 / period,
    phaseS: bestPh,
    beats,
    downbeats: [],
    confidence: Math.max(0, Math.min(1, bestR)),
    meter: 0,
    source: 'thoremin/flux-acf',
  };
}

/** Beat index (fractional) at time `t` on the ruler. */
export function beatIndexAt(grid: SongGrid, t: number): number {
  return (t - grid.phaseS) / grid.periodS;
}

/** Phase within the beat, 0..1, at time `t`; NaN without a grid. */
export function beatPhaseAt(grid: SongGrid, t: number): number {
  const b = beatIndexAt(grid, t);
  if (!Number.isFinite(b)) return NaN;
  return ((b % 1) + 1) % 1;
}

/** Downmix an AudioBuffer-like to mono (channel average). */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}
