/**
 * Formants by linear prediction: where the vocal tract resonates, which is what tells one vowel
 * from another whatever the pitch (F1 falls as the tongue rises, F2 rises as it moves forward).
 * The textbook method (Markel and Gray 1976; Praat's Burg is the same model fitted another way):
 * low-pass and decimate to about 11 kHz (the first three formants of adults and children lie
 * below 4 kHz), pre-emphasise (+6 dB per octave, undoing the glottal source's tilt), a Hamming
 * window of 25 ms, the autocorrelation, Levinson-Durbin for an all-pole model (`orderFor`), and
 * the model's roots: each complex pair is a resonance, its angle the frequency and its radius the
 * bandwidth. Narrow ones (under 500 Hz wide) are formants.
 *
 * `formantsOf` is one window, pure. `createFormantAnalyser` is the same on the audio thread (the
 * seam's `AudioAnalyser`): every hop, one `formants` event stamped at its window's centre frame,
 * with the window's rms; nothing allocated per quantum but the events.
 */
import type { AudioAnalyser, AudioEvent } from './types';

export interface FormantOptions {
  /** The rate the analysis runs at, Hz: the input is decimated by the whole factor nearest to it. */
  analysisRate?: number;
  /** Window, ms. */
  windowMs?: number;
  /** Between estimates, ms. */
  hopMs?: number;
  /** Prediction order; default 2 + the analysis rate in kHz. */
  order?: number;
  preEmphasis?: number;
  /** Below this rms (of the decimated window) nothing is estimated. */
  minRms?: number;
  /** A resonance wider than this is not a formant, Hz. */
  maxBandwidthHz?: number;
  /** Nor one below this, Hz. */
  minHz?: number;
  /**
   * F2 is never above this (an adult's [i] is near 2500 Hz, a child's near 3200). A second
   * resonance higher up means F2 was not resolved (in back vowels F1 and F2 lie a few hundred
   * hertz apart and often merge into one), so the window reports no F2 rather than F3 in its place.
   */
  maxF2Hz?: number;
}

export const FORMANT_DEFAULTS = { analysisRate: 11025, windowMs: 25, hopMs: 10, preEmphasis: 0.97, minRms: 0.003, maxBandwidthHz: 500, minHz: 90, maxF2Hz: 3400 };

export interface FormantEstimate {
  /** Hz, or null when the window was too quiet or showed fewer resonances. */
  f1: number | null;
  f2: number | null;
  f3: number | null;
  rms: number;
}

/** The scratch one window's analysis needs, made once. */
interface Scratch {
  w: Float64Array;
  r: Float64Array;
  a: Float64Array;
  tmp: Float64Array;
  re: Float64Array;
  im: Float64Array;
  found: Float64Array;
}

const scratchFor = (n: number, order: number): Scratch => ({
  w: new Float64Array(n),
  r: new Float64Array(order + 1),
  a: new Float64Array(order + 1),
  tmp: new Float64Array(order + 1),
  re: new Float64Array(order),
  im: new Float64Array(order),
  found: new Float64Array(order),
});

/** The prediction order: the textbook 2 + the analysis rate in kHz. */
export const orderFor = (rate: number): number => 2 + Math.round(rate / 1000);

/**
 * The roots of z^p + c[1] z^(p-1) + ... + c[p] by Durand-Kerner (all at once, from points on a
 * spiral), into `re` / `im`. Converges for the well-separated roots an LPC polynomial has.
 */
function rootsOf(c: Float64Array, p: number, re: Float64Array, im: Float64Array): void {
  for (let k = 0; k < p; k++) {
    // (0.4 + 0.9i)^k: the classic start, no two on a line through the origin.
    const mag = Math.pow(Math.hypot(0.4, 0.9), k);
    const ang = k * Math.atan2(0.9, 0.4);
    re[k] = mag * Math.cos(ang);
    im[k] = mag * Math.sin(ang);
  }
  for (let iter = 0; iter < 200; iter++) {
    let moved = 0;
    for (let k = 0; k < p; k++) {
      // f(z) by Horner.
      let fr = 1;
      let fi = 0;
      for (let j = 1; j <= p; j++) {
        const nr = fr * re[k] - fi * im[k] + c[j];
        fi = fr * im[k] + fi * re[k];
        fr = nr;
      }
      // prod over j != k of (z_k - z_j).
      let dr = 1;
      let di = 0;
      for (let j = 0; j < p; j++) {
        if (j === k) continue;
        const xr = re[k] - re[j];
        const xi = im[k] - im[j];
        const nr = dr * xr - di * xi;
        di = dr * xi + di * xr;
        dr = nr;
      }
      const den = dr * dr + di * di || 1e-300;
      const qr = (fr * dr + fi * di) / den;
      const qi = (fi * dr - fr * di) / den;
      re[k] -= qr;
      im[k] -= qi;
      moved = Math.max(moved, Math.abs(qr) + Math.abs(qi));
    }
    if (moved < 1e-10) break;
  }
}

/** One window (oldest sample first) at `rate`: its first three formants and its rms. */
export function formantsOf(x: ArrayLike<number>, rate: number, options: FormantOptions = {}, scratch?: Scratch): FormantEstimate {
  const o = { ...FORMANT_DEFAULTS, ...options };
  const n = x.length;
  const p = o.order ?? orderFor(rate);
  const s = scratch ?? scratchFor(n, p);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += x[i] * x[i];
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms < o.minRms || n <= p) return { f1: null, f2: null, f3: null, rms };

  // Pre-emphasis and a Hamming window.
  for (let i = 0; i < n; i++) {
    const y = x[i] - o.preEmphasis * (i > 0 ? x[i - 1] : 0);
    s.w[i] = y * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  for (let lag = 0; lag <= p; lag++) {
    let acc = 0;
    for (let i = lag; i < n; i++) acc += s.w[i] * s.w[i - lag];
    s.r[lag] = acc;
  }
  if (!(s.r[0] > 0)) return { f1: null, f2: null, f3: null, rms };
  s.r[0] *= 1 + 1e-9; // a whisper of white noise keeps the recursion stable

  // Levinson-Durbin: a[0] = 1, A(z) = sum a[k] z^-k.
  s.a.fill(0);
  s.a[0] = 1;
  let err = s.r[0];
  for (let i = 1; i <= p; i++) {
    let acc = s.r[i];
    for (let j = 1; j < i; j++) acc += s.a[j] * s.r[i - j];
    const k = -acc / err;
    for (let j = 0; j <= i; j++) s.tmp[j] = s.a[j];
    for (let j = 1; j < i; j++) s.a[j] = s.tmp[j] + k * s.tmp[i - j];
    s.a[i] = k;
    err *= 1 - k * k;
    if (!(err > 0)) break;
  }

  rootsOf(s.a, p, s.re, s.im);
  let m = 0;
  for (let k = 0; k < p; k++) {
    if (s.im[k] <= 0) continue; // one of each conjugate pair; real roots are no resonance
    const radius = Math.hypot(s.re[k], s.im[k]);
    const hz = (Math.atan2(s.im[k], s.re[k]) * rate) / (2 * Math.PI);
    const bw = (-Math.log(radius) * rate) / Math.PI;
    if (hz >= o.minHz && hz <= rate / 2 - 50 && bw > 0 && bw <= o.maxBandwidthHz) s.found[m++] = hz;
  }
  const f = Array.from(s.found.subarray(0, m)).sort((u, v) => u - v);
  if (f.length >= 2 && f[1] > o.maxF2Hz) return { f1: f[0], f2: null, f3: null, rms };
  return { f1: f[0] ?? null, f2: f[1] ?? null, f3: f[2] ?? null, rms };
}

/** The low-pass before decimating by `factor`: a Hamming-windowed sinc at 0.45 of the new Nyquist, unit gain. */
function decimationFilter(factor: number): Float64Array {
  const taps = 8 * factor + 1;
  const mid = (taps - 1) / 2;
  const fc = 0.45 / factor;
  const h = new Float64Array(taps);
  let total = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    total += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= total;
  return h;
}

/**
 * The formant analyser on the audio thread: decimate, then every hop one `formants` event at its
 * window's centre frame (in the input's frames, the decimation filter's delay included).
 */
export function createFormantAnalyser(sampleRate: number, options: FormantOptions = {}): AudioAnalyser {
  const o = { ...FORMANT_DEFAULTS, ...options };
  const factor = Math.max(1, Math.round(sampleRate / o.analysisRate));
  const rate = sampleRate / factor;
  const window = Math.round((o.windowMs / 1000) * rate);
  const hop = Math.max(1, Math.round((o.hopMs / 1000) * rate));
  const order = o.order ?? orderFor(rate);
  const h = decimationFilter(factor);
  const hist = new Float64Array(h.length); // the input's last taps, a ring
  const ring = new Float64Array(window); // the decimated signal, a ring
  const frameBuf = new Float64Array(window);
  const scratch = scratchFor(window, order);
  const delay = (h.length - 1) / 2 + (window / 2) * factor;
  const events: AudioEvent[] = [];
  let hw = 0;
  let phase = 0;
  let write = 0;
  let filled = 0;
  let sinceHop = 0;
  return {
    process(input, _output, frame) {
      events.length = 0;
      for (let i = 0; i < input.length; i++) {
        hist[hw] = input[i];
        hw = (hw + 1) % hist.length;
        if (++phase < factor) continue;
        phase = 0;
        let y = 0;
        for (let k = 0; k < h.length; k++) y += h[k] * hist[(hw + k) % hist.length];
        ring[write] = y;
        write = (write + 1) % window;
        if (filled < window) filled++;
        if (filled === window && ++sinceHop >= hop) {
          sinceHop = 0;
          for (let k = 0; k < window; k++) frameBuf[k] = ring[(write + k) % window];
          const est = formantsOf(frameBuf, rate, { ...o, order }, scratch);
          events.push({ kind: 'formants', frame: Math.round(frame + i + 1 - delay), f1: est.f1, f2: est.f2, f3: est.f3, rms: est.rms });
        }
      }
      return events;
    },
  };
}
