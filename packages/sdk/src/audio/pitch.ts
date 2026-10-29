/**
 * Monophonic pitch from a buffer of samples: what a singing game, a tuner and a play-along on a
 * monophonic instrument read from the microphone (lane A of #866; the research behind the choice
 * is `docs/research/music-games-from-audio.md`, section 4.1).
 *
 * YIN (de Cheveigné and Kawahara, 2002): the difference function d(tau) of the window against
 * itself shifted by tau, normalised by its cumulative mean (d'), the first dip under an absolute
 * threshold taken as the period (the first, not the deepest, which is what keeps it off the
 * octave below), refined between samples by a parabola through the dip. The clarity is
 * `1 - d'(tau)`: near 1 for a clean periodic sound, near 0 for noise, so a consumer gates on it
 * rather than on a level. A window holds about two periods of the lowest pitch, so `minHz`
 * decides the window and with it the latency; `windowFor` says how long.
 *
 * `createPitchTracker` runs it over a stream of blocks (a hop at a time, from a ring), stamping
 * each estimate with the time of its window's CENTRE on the caller's clock: the pitch describes
 * the window, and a judge compares it with the note sounding then.
 *
 * Pure: no DOM, no Web Audio; the same code runs in the AudioWorklet, in a test over a WAV, and
 * in a script.
 */
import type { AudioAnalyser, AudioEvent } from './types';

export interface PitchEstimate {
  /** Hz, or null when nothing periodic was heard. */
  f0: number | null;
  /** 1 - d'(tau) at the chosen period, 0..1; 0 when unvoiced by level. */
  clarity: number;
  /** Root mean square of the window. */
  rms: number;
}

export interface YinOptions {
  /** The absolute threshold on d'. Default 0.1 (the paper's; best on the vocadito fixtures). */
  threshold?: number;
  /** Lowest pitch looked for, Hz. Default 70 (a bass voice's low notes). */
  minHz?: number;
  /** Highest pitch looked for, Hz. Default 1400. */
  maxHz?: number;
  /** A window quieter than this RMS is unvoiced without analysis. Default 0.003 (about -50 dBFS). */
  minRms?: number;
}

export const YIN_DEFAULTS: Required<YinOptions> = { threshold: 0.1, minHz: 70, maxHz: 1400, minRms: 0.003 };

/** Samples a YIN window needs at `sampleRate` to see `minHz`: two periods, rounded up to even. */
export function windowFor(sampleRate: number, minHz = YIN_DEFAULTS.minHz): number {
  const n = Math.ceil((2 * sampleRate) / minHz);
  return n + (n % 2);
}

/** YIN over one window `x` (its whole length). `scratch` (at least `sampleRate / minHz + 1` long) spares the audio thread an allocation. */
export function yin(x: ArrayLike<number>, sampleRate: number, opts: YinOptions = {}, scratch?: Float64Array): PitchEstimate {
  const { threshold, minHz, maxHz, minRms } = { ...YIN_DEFAULTS, ...opts };
  const n = x.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  const rms = Math.sqrt(energy / Math.max(1, n));
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), Math.floor(n / 2));
  if (rms < minRms || tauMax <= tauMin + 2) return { f0: null, clarity: 0, rms };
  const w = n - tauMax;
  // d'(tau) for tau = 0..tauMax; d'(0) = 1 by definition.
  const dp = scratch && scratch.length >= tauMax + 1 ? scratch : new Float64Array(tauMax + 1);
  dp[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let d = 0;
    for (let j = 0; j < w; j++) {
      const diff = x[j] - x[j + tau];
      d += diff * diff;
    }
    running += d;
    dp[tau] = running > 0 ? (d * tau) / running : 1;
  }
  // The first dip under the threshold, followed down to its local minimum; else the global minimum.
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (dp[t] < threshold) {
      while (t + 1 <= tauMax && dp[t + 1] < dp[t]) t++;
      tau = t;
      break;
    }
  }
  let voiced = true;
  if (tau < 0) {
    voiced = false;
    tau = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (dp[t] < dp[tau]) tau = t;
  }
  const clarity = Math.max(0, Math.min(1, 1 - dp[tau]));
  if (!voiced) return { f0: null, clarity, rms };
  // Parabolic refinement through the dip and its neighbours.
  let refined = tau;
  if (tau > 1 && tau < tauMax) {
    const a = dp[tau - 1];
    const b = dp[tau];
    const c = dp[tau + 1];
    const den = a - 2 * b + c;
    if (den > 0) refined = tau + (a - c) / (2 * den);
  }
  return { f0: sampleRate / refined, clarity, rms };
}

/** One estimate of a stream, stamped at its window's centre. */
export interface PitchFrame extends PitchEstimate {
  t: number;
}

export interface PitchTrackerOptions extends YinOptions {
  sampleRate: number;
  /** Window length in samples. Default `windowFor(sampleRate, minHz)`. */
  window?: number;
  /** Samples between estimates. Default 10 ms worth. */
  hop?: number;
}

export interface PitchTracker {
  /**
   * Feed one block of contiguous samples whose first sample is at time `t0` (seconds, the
   * caller's clock); returns every estimate whose window completed inside it. A gap in the
   * stream must be signalled by `reset()`, never by pushing across it.
   */
  push(block: ArrayLike<number>, t0: number): PitchFrame[];
  /** Forget the history (after a gap or a seek). */
  reset(): void;
  readonly window: number;
  readonly hop: number;
}

export function createPitchTracker(opts: PitchTrackerOptions): PitchTracker {
  const { sampleRate } = opts;
  const window = opts.window ?? windowFor(sampleRate, opts.minHz);
  const hop = opts.hop ?? Math.round(sampleRate / 100);
  if (!(window > 0 && hop > 0)) throw new Error('pitch tracker: window and hop must be positive');
  const ring = new Float32Array(window);
  const frame = new Float32Array(window);
  let filled = 0; // samples in the ring, up to `window`
  let write = 0; // next write index
  let sinceHop = 0; // samples since the last estimate
  return {
    window,
    hop,
    push(block, t0) {
      const out: PitchFrame[] = [];
      for (let i = 0; i < block.length; i++) {
        ring[write] = block[i];
        write = (write + 1) % window;
        if (filled < window) filled++;
        sinceHop++;
        if (filled === window && sinceHop >= hop) {
          sinceHop = 0;
          for (let k = 0; k < window; k++) frame[k] = ring[(write + k) % window];
          // The window ends at sample i of this block, so its centre is half a window earlier.
          const tEnd = t0 + (i + 1) / sampleRate;
          out.push({ t: tEnd - window / (2 * sampleRate), ...yin(frame, sampleRate, opts) });
        }
      }
      return out;
    },
    reset() {
      filled = 0;
      write = 0;
      sinceHop = 0;
    },
  };
}

/** What the pitch analyser posts: the audio-input seam's `pitch` event (`./types`). */
export interface PitchAnalyserOptions extends YinOptions {
  /** Window, samples. Default `windowFor(sampleRate, minHz)`. */
  window?: number;
  /** Samples between estimates. Default 10 ms worth. */
  hop?: number;
}

/**
 * YIN as an analyser on the audio thread (the seam's `AudioAnalyser`): every hop, one `pitch`
 * event stamped at its window's CENTRE frame. Allocation-free per quantum apart from the events.
 */
export function createPitchAnalyser(sampleRate: number, options: PitchAnalyserOptions = {}): AudioAnalyser {
  const minHz = options.minHz ?? YIN_DEFAULTS.minHz;
  const window = options.window ?? windowFor(sampleRate, minHz);
  const hop = options.hop ?? Math.round(sampleRate / 100);
  const ring = new Float32Array(window);
  const frameBuf = new Float32Array(window);
  const scratch = new Float64Array(Math.floor(sampleRate / minHz) + 2);
  const events: AudioEvent[] = [];
  let filled = 0;
  let write = 0;
  let sinceHop = 0;
  return {
    process(input, _output, frame) {
      events.length = 0;
      for (let i = 0; i < input.length; i++) {
        ring[write] = input[i];
        write = (write + 1) % window;
        if (filled < window) filled++;
        sinceHop++;
        if (filled === window && sinceHop >= hop) {
          sinceHop = 0;
          for (let k = 0; k < window; k++) frameBuf[k] = ring[(write + k) % window];
          const est = yin(frameBuf, sampleRate, options, scratch);
          // The window ends at sample i; its centre is half a window earlier.
          events.push({ kind: 'pitch', frame: frame + i + 1 - window / 2, f0: est.f0, clarity: est.clarity });
        }
      }
      return events;
    },
  };
}
