/**
 * The song's beat grid, from its audio (#186 PR G; research map
 * `docs/research/body-and-pace-research-map.md` §5).
 *
 * The other half of the pace problem: the pulse follower (`pulse.ts`) says when the
 * DANCER repeats; this says when the SONG does, so the pace controller (PR H) can relate
 * the two. It is offline rather than causal (the song is known in full the moment it is
 * loaded), which is the one way it differs from the rest of this package; it is here
 * because the grid it returns is read through the same {@link MusicalTime} the
 * consumers already speak ({@link songTimeAt}).
 *
 * Hand-rolled rather than a library, for measured reasons (§5.2): the only pure-JS
 * tracker on npm returns fifteen seconds of beats, the neural ones need an ONNX runtime,
 * and the good C++ ones are GPL. The pipeline:
 *
 *  1. **Onset strength**: per hop, the half-wave-rectified increase in log energy of the
 *     signal through a one-pole low-pass (kicks and bass) and of its first difference
 *     (hi-hats), a two-band spectral-flux proxy without an FFT.
 *  2. **Tempo**: the autocorrelation of the mean-removed envelope over the lags between
 *     `minBpm` and `maxBpm`, weighted by a broad log-normal tempo prior (the octave
 *     tie-break: a 129 bpm click repeats at 64.6 bpm just as strongly), parabolically
 *     interpolated at its peak.
 *  3. **Phase**: a comb over one period against the LOW band only, so hi-hat eighths and
 *     swung eighths do not pull it off the beat.
 *  4. **Beats, then the line**: each comb beat snaps to the strongest onset within a
 *     tenth of a period (kept where nothing stands out), and the tempo and phase are a
 *     least-squares line through the snapped beats, never a median interval. The beats
 *     are kept beside the line because real songs drift, and the nearest actual beat
 *     beats extrapolating for anything longer than half a minute.
 *
 * The remaining failure is the tempo octave (170 bpm read as 85). The pace controller
 * relates the dancer's level to the song's over integer ratios, so it absorbs that by
 * construction. Downbeats are an empty list until a downbeat tracker exists; `meter` is
 * 0 (unknown) until then.
 *
 * Pure: a `Float32Array` of mono samples in, a {@link SongGrid} out.
 */
import type { MusicalTime } from './types';

/** The song's ruler (the paces `Grid`): a line, the beats it was fitted to, and how
 *  sure the tracker was. Times are seconds on the SONG's own timeline. */
export interface SongGrid {
  /** Seconds per beat (the least-squares line). */
  periodS: number;
  /** Beats per minute, `60 / periodS`. */
  bpm: number;
  /** The time of beat 0 on the line, 0 <= phaseS < periodS. */
  phaseS: number;
  /** The tracked beat instants, ascending (beat `i` is `beats[i]`). */
  beats: number[];
  /** Downbeats: empty until a downbeat tracker exists (the field is the seam). */
  downbeats: number[];
  /** The autocorrelation strength at the chosen period, 0..1. */
  confidence: number;
  /** Beats per bar; 0 = unknown. */
  meter: number;
  /** Which tracker produced it. */
  source: string;
}

export interface SongGridOptions {
  sampleRate: number;
  /** Samples per envelope frame. */
  hop?: number;
  /** Samples per energy window. */
  win?: number;
  minBpm?: number;
  maxBpm?: number;
  /** The tempo prior's centre and width (octaves, one standard deviation). */
  priorBpm?: number;
  priorOctaves?: number;
  /** Phase comb resolution: offsets tried per period. */
  combSteps?: number;
  /** How far a comb beat may move to the strongest onset, as a fraction of the period. */
  snap?: number;
  /** The low band's cutoff, Hz (the phase comb's band). */
  lowCutHz?: number;
  /** Below this autocorrelation strength there is no beat to report (white noise reaches
   *  about 0.1): the empty grid rather than a "faint beat" a consumer would lock onto. */
  minConfidence?: number;
}

export const SONG_GRID_DEFAULTS = {
  hop: 256,
  win: 1024,
  minBpm: 60,
  maxBpm: 200,
  priorBpm: 120,
  priorOctaves: 1,
  combSteps: 64,
  snap: 0.1,
  lowCutHz: 200,
  minConfidence: 0.15,
} as const;

export const SONG_GRID_SOURCE = 'ictus/flux-acf';

/** The grid of a song with no usable periodicity (silence, noise, too short): no beats, NaN
 *  tempo, never a zero tempo a consumer would divide by. */
export const EMPTY_SONG_GRID: SongGrid = Object.freeze({
  periodS: NaN,
  bpm: NaN,
  phaseS: NaN,
  beats: [],
  downbeats: [],
  confidence: 0,
  meter: 0,
  source: SONG_GRID_SOURCE,
}) as SongGrid;

/** The onset envelopes, one value per hop: total (for the tempo) and low band (for the
 *  phase). The low band is the signal through a one-pole low-pass of coefficient
 *  `lowAlpha` (1 = no filtering); the high band is the first difference. */
export function onsetEnvelopes(x: Float32Array, hop: number, win: number, lowAlpha = 1): { env: Float32Array; low: Float32Array } {
  const nF = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  // The low-passed signal (kicks and bass), so a hi-hat as loud as the kick cannot move
  // the phase comb.
  const y = lowAlpha >= 1 ? x : new Float32Array(x.length);
  if (lowAlpha < 1) {
    let acc = 0;
    for (let i = 0; i < x.length; i++) {
      acc += lowAlpha * (x[i] - acc);
      y[i] = acc;
    }
  }
  const env = new Float32Array(nF);
  const low = new Float32Array(nF);
  let prevLo = NaN;
  let prevHi = NaN;
  for (let f = 0; f < nF; f++) {
    let lo = 0;
    let hi = 0;
    const o = f * hop;
    for (let i = 1; i < win; i++) {
      const l = y[o + i];
      lo += l * l;
      const d = x[o + i] - x[o + i - 1];
      hi += d * d;
    }
    lo = Math.log1p(lo * 1000);
    hi = Math.log1p(hi * 1000);
    // The first frame has no predecessor: no onset, rather than one the size of the level.
    low[f] = f === 0 ? 0 : Math.max(0, lo - prevLo);
    env[f] = low[f] + (f === 0 ? 0 : Math.max(0, hi - prevHi));
    prevLo = lo;
    prevHi = hi;
  }
  return { env, low };
}

/** Least-squares line `t = phase + i * period` through `beats` (indexed 0..n-1);
 *  null below three beats. */
export function lsLine(beats: readonly number[]): { period: number; intercept: number } | null {
  const n = beats.length;
  if (n < 3) return null;
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
  const period = num / den;
  return { period, intercept: my - period * mx };
}

/** Downmix channels to mono (the channel average). */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * Track the beats of a mono signal. Returns {@link EMPTY_SONG_GRID} when the signal has
 * no usable periodicity (silence, under two seconds, an empty buffer).
 */
export function trackSongGrid(x: Float32Array, opts: SongGridOptions): SongGrid {
  const o = { ...SONG_GRID_DEFAULTS, ...opts };
  const fps = o.sampleRate / o.hop;
  const lowAlpha = 1 - Math.exp((-2 * Math.PI * o.lowCutHz) / o.sampleRate);
  const { env, low } = onsetEnvelopes(x, o.hop, o.win, lowAlpha);
  const nF = env.length;
  if (!(fps > 0) || nF < fps * 2) return EMPTY_SONG_GRID;

  // The tempo reads a lightly smoothed envelope: a click is one frame wide, so at a lag
  // that falls between two frames its autocorrelation splits in half, and the doubled
  // period (which lands on a whole frame more often) would win the octave.
  const sm = smooth(env);
  let mean = 0;
  for (let i = 0; i < nF; i++) mean += sm[i];
  mean /= nF;
  const e = new Float64Array(nF);
  let a0 = 0;
  for (let i = 0; i < nF; i++) {
    e[i] = sm[i] - mean;
    a0 += e[i] * e[i];
  }
  if (!(a0 > 0)) return EMPTY_SONG_GRID;
  const acf = (lag: number): number => {
    let s = 0;
    for (let i = lag; i < nF; i++) s += e[i] * e[i - lag];
    return s / a0;
  };

  const lo = Math.max(2, Math.round((fps * 60) / o.maxBpm));
  const hi = Math.min(nF - 2, Math.round((fps * 60) / o.minBpm));
  if (hi <= lo) return EMPTY_SONG_GRID;
  const r = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) r[lag] = acf(lag);
  const prior = (lag: number): number => {
    const oct = Math.log2((fps * 60) / lag / o.priorBpm) / o.priorOctaves;
    return Math.exp(-0.5 * oct * oct);
  };
  let bestLag = -1;
  let bestScore = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    // A local maximum only: a lag on the shoulder of a stronger peak is not a tempo.
    if (!(r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1])) continue;
    const score = r[lag] * prior(lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || !(r[bestLag] >= o.minConfidence)) return EMPTY_SONG_GRID;
  const [l, c, rr] = [r[bestLag - 1], r[bestLag], r[bestLag + 1]];
  const denom = l - 2 * c + rr;
  const dl = denom !== 0 ? (0.5 * (l - rr)) / denom : 0;
  const period0 = (bestLag + Math.max(-0.5, Math.min(0.5, dl))) / fps;

  // The comb: the offset that collects the most low-band onset energy.
  const total = (nF - 1) / fps;
  let bestPh = 0;
  let bestComb = -Infinity;
  for (let p = 0; p < o.combSteps; p++) {
    const ph = (p / o.combSteps) * period0;
    let sc = 0;
    for (let t = ph; t <= total; t += period0) sc += low[Math.round(t * fps)];
    if (sc > bestComb) {
      bestComb = sc;
      bestPh = ph;
    }
  }

  // Walk the beats outward from the middle of the song, each one predicted a period
  // from the previous one and snapped to the strongest onset within reach. Starting in
  // the middle (where the comb's average phase is truest) and stepping beat to beat is
  // what lets a drifting song keep its own beats instead of the comb's line.
  let envMean = 0;
  for (let i = 0; i < nF; i++) envMean += env[i];
  envMean /= nF;
  const reach = Math.max(1, Math.round(o.snap * period0 * fps));
  const snapAt = (t: number): number => {
    const i0 = Math.round(t * fps);
    if (i0 < 0 || i0 > nF - 1) return t;
    let bi = i0;
    let bv = env[i0];
    for (let i = Math.max(0, i0 - reach); i <= Math.min(nF - 1, i0 + reach); i++) {
      if (env[i] > bv) {
        bv = env[i];
        bi = i;
      }
    }
    return bv > envMean ? bi / fps : t;
  };
  const mid = bestPh + Math.floor((total / 2 - bestPh) / period0) * period0;
  const centre = snapAt(mid);
  const after: number[] = [];
  for (let t = snapAt(centre + period0); t <= total; t = snapAt(after[after.length - 1] + period0)) {
    if (!(t > (after.length ? after[after.length - 1] : centre))) break;
    after.push(t);
  }
  const before: number[] = [];
  for (let t = snapAt(centre - period0); t >= 0; t = snapAt(before[before.length - 1] - period0)) {
    if (!(t < (before.length ? before[before.length - 1] : centre))) break;
    before.push(t);
  }
  const beats = [...before.reverse(), centre, ...after];

  const line = lsLine(beats);
  const periodS = line && line.period > 0 ? line.period : period0;
  const intercept = line ? line.intercept : bestPh;
  const phaseS = ((intercept % periodS) + periodS) % periodS;
  return {
    periodS,
    bpm: 60 / periodS,
    phaseS,
    beats,
    downbeats: [],
    confidence: Math.max(0, Math.min(1, r[bestLag])),
    meter: 0,
    source: SONG_GRID_SOURCE,
  };
}

/** A [1 2 3 2 1]/9 smoothing (about 25 ms at the default hop): enough to keep a click's
 *  autocorrelation whole at a fractional lag, far below a beat. */
function smooth(x: Float32Array): Float32Array {
  const w = [1, 2, 3, 2, 1];
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= x.length) continue;
      s += x[j] * w[k + 2];
      n += w[k + 2];
    }
    out[i] = s / n;
  }
  return out;
}

/** Whether a grid has a usable ruler (a finite, positive period). */
export function hasGrid(grid: SongGrid | null | undefined): grid is SongGrid {
  return !!grid && Number.isFinite(grid.periodS) && grid.periodS > 0;
}

/**
 * The continuous beat index at song time `s`: between two tracked beats it interpolates
 * them (a drifting song keeps its own beats), outside them it extends the line from the
 * nearest end. NaN without a ruler.
 */
export function beatIndexAt(grid: SongGrid, s: number): number {
  if (!hasGrid(grid) || !Number.isFinite(s)) return NaN;
  const b = grid.beats;
  if (b.length < 2) return (s - grid.phaseS) / grid.periodS;
  if (s <= b[0]) return (s - b[0]) / grid.periodS;
  const last = b.length - 1;
  if (s >= b[last]) return last + (s - b[last]) / grid.periodS;
  // Binary search for the beat at or before `s`.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (b[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = b[lo + 1] - b[lo];
  return lo + (span > 0 ? (s - b[lo]) / span : 0);
}

/** The song time of (fractional) beat `k`: the inverse of {@link beatIndexAt}. */
export function songTimeOfBeat(grid: SongGrid, k: number): number {
  if (!hasGrid(grid) || !Number.isFinite(k)) return NaN;
  const b = grid.beats;
  if (b.length < 2) return grid.phaseS + k * grid.periodS;
  const last = b.length - 1;
  if (k <= 0) return b[0] + k * grid.periodS;
  if (k >= last) return b[last] + (k - last) * grid.periodS;
  const i = Math.floor(k);
  return b[i] + (k - i) * (b[i + 1] - b[i]);
}

/**
 * The song's musical time while it plays: at song position `positionS`, played at
 * `rate` (song seconds per engine second), read at engine time `t`. Tempo, period and
 * `nextBeatAt` are in ENGINE time (a song played at 1.1x has a 10 % shorter period), so
 * a consumer compares it with the dancer's {@link MusicalTime} directly. `state` is
 * `running` while playing and `hold` while paused (the beat does not advance);
 * `ready` without a ruler.
 */
export function songTimeAt(grid: SongGrid, positionS: number, opts: { t: number; rate?: number; playing?: boolean }): MusicalTime {
  const rate = opts.rate !== undefined && opts.rate > 0 ? opts.rate : 1;
  const beat = beatIndexAt(grid, positionS);
  if (!Number.isFinite(beat)) {
    return { t: opts.t, beat: 0, phase: 0, tempo: 0, period: 0, confidence: 0, nextBeatAt: Infinity, beatsPerBar: grid.meter || 4, beatInBar: 0, state: 'ready', anchors: 0 };
  }
  const next = Math.floor(beat) + 1;
  const local = songTimeOfBeat(grid, next) - songTimeOfBeat(grid, next - 1);
  const period = (local > 0 ? local : grid.periodS) / rate;
  const beatsPerBar = grid.meter || 4;
  const phase = beat - Math.floor(beat);
  return {
    t: opts.t,
    beat,
    phase,
    tempo: 60 / period,
    period,
    confidence: grid.confidence,
    nextBeatAt: opts.t + (songTimeOfBeat(grid, next) - positionS) / rate,
    beatsPerBar,
    beatInBar: ((Math.floor(beat) % beatsPerBar) + beatsPerBar) % beatsPerBar,
    state: opts.playing === false ? 'hold' : 'running',
    anchors: grid.beats.length,
  };
}
