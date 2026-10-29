/**
 * What a struck sound's attack looks like, as a short vector (the sound mapper's features;
 * `docs/research/live-audio-to-audio.md` §5).
 *
 * The window starts at the onset and is short on purpose: every sample of it is latency the
 * player hears (`docs/research/audio-trigger-latency.md`). The usual embeddings (YAMNet,
 * PANNs, CLAP, OpenL3) read 0.5 to 1 s of audio and are out of the question for a trigger; what
 * the attack's first few milliseconds DO carry is where its energy sits in frequency (a pot
 * rings high, a table thuds low, the edge of a table is brighter than its middle), how noisy
 * it is, and how fast it falls. So the vector is:
 *
 * - the spectral SHAPE in `bands` log-spaced bands, as log fractions of the window's total
 *   energy (so the same tap struck harder reads the same);
 * - the spectral centroid and the 85 % roll-off, in octaves;
 * - the spectral flatness (noise against tone), in log;
 * - the zero-crossing rate;
 * - the decay inside the window (log energy of the second half against the first);
 * - the loudness (log total energy), which the default weights keep but count for little:
 *   a harder tap must not change class, but a whisper-quiet one is a different gesture.
 *
 * A tap often lands while the last one still rings (a pot rings for a second). Its window then
 * holds both, and the tail's spectrum pulls the vector toward the previous surface. So
 * {@link AttackFeatures.compute} takes an optional BACKGROUND window (the samples just before the
 * onset) whose power spectrum is subtracted bin by bin before anything is measured: a ringing
 * tail is nearly stationary over a few milliseconds, the new attack is not. The sound mapper
 * leaves it off by default: when the SAME surface is struck again, its tail has the same modes
 * as the new attack, and subtracting it erases what identifies the surface.
 *
 * Everything is computed into caller-owned arrays (a plan made once by {@link createAttackFeatures}),
 * so the audio thread never allocates.
 */
import { createFft, nextPow2 } from './fft';

export interface AttackFeatureOptions {
  sampleRate: number;
  /** Window length, samples (the latency it costs is window / sampleRate). */
  window: number;
  /** Log-spaced bands for the spectral shape. */
  bands?: number;
  /** Lowest and highest band edges, Hz (the top is clamped below Nyquist). */
  minHz?: number;
  maxHz?: number;
  /**
   * How the spectral shape is summarised: `bands` (log energy fraction per band) or `mfcc`
   * (the DCT of the log band energies, without c0: the cepstrum, decorrelated, the usual
   * front end of drum and vocal-percussion classifiers).
   */
  shape?: 'bands' | 'mfcc';
  /** Cepstral coefficients kept with `mfcc` (c1..cN). */
  cepstra?: number;
}

export const ATTACK_FEATURE_DEFAULTS = { bands: 16, minHz: 60, maxHz: 18000, shape: 'bands' as 'bands' | 'mfcc', cepstra: 12 };

export interface AttackFeatures {
  /** Length of the vector. */
  readonly size: number;
  /** One name per entry, in order (for a readout and for the weights). */
  readonly names: readonly string[];
  /** Default weight per entry (loudness counts for little). */
  readonly weights: Float64Array;
  readonly window: number;
  /**
   * Compute the vector of `samples[offset, offset + window)` into `out`; with `background`, the
   * power spectrum of `samples[background, background + window)` is subtracted first.
   */
  compute(samples: ArrayLike<number>, offset: number, out: Float64Array, background?: number): Float64Array;
}

const EPS = 1e-10;

export function createAttackFeatures(options: AttackFeatureOptions): AttackFeatures {
  const o = { ...ATTACK_FEATURE_DEFAULTS, ...options };
  const window = Math.max(16, Math.round(o.window));
  const n = nextPow2(window);
  const fft = createFft(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const power = new Float64Array(n / 2 + 1);
  const bgPower = new Float64Array(n / 2 + 1);
  const binHz = o.sampleRate / n;
  const top = Math.min(o.maxHz, o.sampleRate * 0.475);
  // Band edges in bins; a band narrower than a bin still gets one bin.
  const edges = new Int32Array(o.bands + 1);
  for (let b = 0; b <= o.bands; b++) {
    const hz = o.minHz * (top / o.minHz) ** (b / o.bands);
    edges[b] = Math.min(n / 2, Math.max(1, Math.round(hz / binHz)));
  }
  for (let b = 1; b <= o.bands; b++) if (edges[b] <= edges[b - 1]) edges[b] = Math.min(n / 2, edges[b - 1] + 1);
  // A taper over the last quarter only: the attack is at the START of the window, and a
  // symmetric window would erase exactly the part that tells sounds apart.
  const taper = new Float64Array(window);
  const flat = Math.floor(window * 0.75);
  for (let i = 0; i < window; i++) taper[i] = i < flat ? 1 : 0.5 * (1 + Math.cos((Math.PI * (i - flat)) / (window - flat)));

  const mfcc = o.shape === 'mfcc';
  const shapeSize = mfcc ? Math.min(o.cepstra, o.bands - 1) : o.bands;
  const logBand = new Float64Array(o.bands);
  // DCT-II rows c1..cN over the bands.
  const dct = new Float64Array(shapeSize * o.bands);
  if (mfcc) for (let c = 0; c < shapeSize; c++) for (let b = 0; b < o.bands; b++) dct[c * o.bands + b] = Math.cos((Math.PI * (c + 1) * (b + 0.5)) / o.bands) * Math.sqrt(2 / o.bands);
  const names: string[] = [];
  for (let b = 0; b < shapeSize; b++) names.push(mfcc ? `mfcc${b + 1}` : `band${b}`);
  names.push('centroid', 'rolloff', 'flatness', 'zcr', 'decay', 'loudness');
  const size = names.length;
  const weights = new Float64Array(size).fill(1);
  weights[size - 1] = 0.25;

  return {
    size,
    names,
    weights,
    window,
    compute(samples, offset, out, background) {
      if (background !== undefined) {
        for (let i = 0; i < window; i++) {
          re[i] = (samples[background + i] ?? 0) * taper[i];
          im[i] = 0;
        }
        for (let i = window; i < n; i++) {
          re[i] = 0;
          im[i] = 0;
        }
        fft.transform(re, im);
        for (let k = 0; k <= n / 2; k++) bgPower[k] = re[k] * re[k] + im[k] * im[k];
      }
      let e1 = 0;
      let e2 = 0;
      let zc = 0;
      let prev = samples[offset] ?? 0;
      const half = window >> 1;
      for (let i = 0; i < window; i++) {
        const x = samples[offset + i] ?? 0;
        if (i < half) e1 += x * x;
        else e2 += x * x;
        if ((x >= 0) !== (prev >= 0)) zc++;
        prev = x;
        re[i] = x * taper[i];
        im[i] = 0;
      }
      for (let i = window; i < n; i++) {
        re[i] = 0;
        im[i] = 0;
      }
      fft.transform(re, im);
      let total = 0;
      let weighted = 0;
      let logSum = 0;
      const lo = edges[0];
      const hi = edges[o.bands];
      for (let k = 0; k <= n / 2; k++) {
        const p = re[k] * re[k] + im[k] * im[k];
        // A floor of 1 % of the bin keeps the log measures finite where the tail explains it all.
        power[k] = background !== undefined ? Math.max(0.01 * p, p - bgPower[k]) : p;
      }
      for (let k = lo; k < hi; k++) {
        total += power[k];
        weighted += power[k] * k;
        logSum += Math.log(power[k] + EPS);
      }
      const span = Math.max(1, hi - lo);
      for (let b = 0; b < o.bands; b++) {
        let s = 0;
        for (let k = edges[b]; k < edges[b + 1]; k++) s += power[k];
        logBand[b] = Math.log10(s / (total + EPS) + 1e-6);
      }
      if (mfcc) {
        for (let c = 0; c < shapeSize; c++) {
          let acc = 0;
          for (let b = 0; b < o.bands; b++) acc += dct[c * o.bands + b] * logBand[b];
          out[c] = acc;
        }
      } else for (let b = 0; b < o.bands; b++) out[b] = logBand[b];
      const at = shapeSize;
      const centroidBin = total > EPS ? weighted / total : (lo + hi) / 2;
      let acc = 0;
      let rollBin = hi;
      for (let k = lo; k < hi; k++) {
        acc += power[k];
        if (acc >= 0.85 * total) {
          rollBin = k;
          break;
        }
      }
      const arith = total / span;
      out[at] = Math.log2(Math.max(binHz, centroidBin * binHz));
      out[at + 1] = Math.log2(Math.max(binHz, rollBin * binHz));
      out[at + 2] = logSum / span - Math.log(arith + EPS);
      out[at + 3] = zc / window;
      out[at + 4] = Math.log10((e2 + EPS) / (e1 + EPS));
      out[at + 5] = Math.log10((e1 + e2) / window + EPS);
      return out;
    },
  };
}
