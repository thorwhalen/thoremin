/**
 * Onset analysis for the physical strike test (#227, measurement 3).
 *
 * The test: the player strikes a table with a flat hand in view of the camera. The
 * app detects the strike from the hand landmarks, the way a reactive instrument must
 * (on the frame where the downward motion stops), and answers with a short pure-tone
 * burst through its own AudioContext. A microphone records the room. The strike and
 * the app's answer reach the recording through the SAME microphone path, so the
 * microphone's own input latency cancels: the distance between the two onsets in the
 * recording is the instrument's event-to-sound latency, glass to air, including what
 * no in-page clock can see (sensor exposure and readout, the OS camera pipeline, the
 * DAC and the speaker).
 *
 * Two detectors, on purpose. A slap is broadband and has a reverberant tail; a single
 * "anything loud" detector would read that tail as a second strike and pair the answer
 * with it, biasing every latency short. So strikes are rising edges of the broadband
 * envelope with hysteresis (the envelope must fall back before a new strike counts),
 * and answers are found in the probe tone's own frequency band, where a slap has
 * little energy. Then each answer is paired with the latest strike before it.
 */

export interface OnsetOptions {
  /** Hop for the envelopes, ms. */
  hopMs?: number;
  /** A strike is a rise above `noiseFactor` × the broadband noise floor... */
  noiseFactor?: number;
  /** ...and above this absolute amplitude. */
  minAmplitude?: number;
  /** The envelope must fall below `rearm` × the threshold before another strike counts. */
  rearm?: number;
  /** And another strike never counts sooner than this after the last, ms. */
  refractoryMs?: number;
}

export const ONSET_DEFAULTS: Required<OnsetOptions> = {
  hopMs: 0.5,
  noiseFactor: 8,
  minAmplitude: 0.01,
  rearm: 0.5,
  refractoryMs: 60,
};

/** Median of a copy (the noise floor of a mostly-silent recording). */
function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/**
 * Amplitude of the `freq` component over `pcm[start, start+len)` (Goertzel): a sine
 * of amplitude A at `freq` reads about A; energy elsewhere reads near 0.
 */
export function toneAmplitude(pcm: Float32Array, sampleRate: number, start: number, len: number, freq: number): number {
  const s = Math.max(0, start);
  const end = Math.min(pcm.length, start + len);
  const n = end - s;
  if (n <= 0) return 0;
  const coeff = 2 * Math.cos((2 * Math.PI * freq) / sampleRate);
  let s1 = 0;
  let s2 = 0;
  for (let i = s; i < end; i++) {
    const s0 = pcm[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / n;
}

/** Strike onsets (ms from the buffer start): rising edges of the broadband envelope,
 *  placed at the first sample above the threshold. */
export function strikeOnsets(pcm: Float32Array, sampleRate: number, options: OnsetOptions = {}): number[] {
  const o = { ...ONSET_DEFAULTS, ...options };
  const hop = Math.max(1, Math.round((o.hopMs / 1000) * sampleRate));
  const peaks: number[] = [];
  for (let i = 0; i < pcm.length; i += hop) {
    let p = 0;
    for (let j = i; j < Math.min(pcm.length, i + hop); j++) p = Math.max(p, Math.abs(pcm[j]));
    peaks.push(p);
  }
  const threshold = Math.max(o.minAmplitude, o.noiseFactor * median(peaks));
  const refractory = (o.refractoryMs / 1000) * sampleRate;
  const out: number[] = [];
  let armed = true;
  let last = -Infinity;
  for (let h = 0; h < peaks.length; h++) {
    if (!armed) {
      if (peaks[h] < o.rearm * threshold) armed = true;
      continue;
    }
    if (peaks[h] < threshold) continue;
    let index = h * hop;
    while (index < pcm.length - 1 && Math.abs(pcm[index]) < threshold) index++;
    armed = false;
    if (index - last < refractory) continue;
    out.push((index / sampleRate) * 1000);
    last = index;
  }
  return out;
}

export interface ToneOnsetOptions {
  /** The probe tone's frequency, Hz. */
  toneHz?: number;
  /** Goertzel window, ms (a few periods of the tone). */
  windowMs?: number;
  /** Hop between windows, ms. */
  hopMs?: number;
  /** A tone is present when its amplitude exceeds this... */
  minAmplitude?: number;
  /** ...and `noiseFactor` × the band's median amplitude. */
  noiseFactor?: number;
  /** ...and the band holds at least this fraction of the window's power. A pure
   *  tone scores near 1; a slap, broadband, a few percent even when loud. */
  minPurity?: number;
  /** Minimum spacing between two answers, ms. */
  refractoryMs?: number;
}

export const TONE_DEFAULTS: Required<ToneOnsetOptions> = {
  toneHz: 3000,
  windowMs: 2,
  hopMs: 0.25,
  minAmplitude: 0.005,
  noiseFactor: 10,
  minPurity: 0.5,
  refractoryMs: 60,
};

/** Mean square of `pcm[start, start+len)`. */
function meanSquare(pcm: Float32Array, start: number, len: number): number {
  let e = 0;
  const end = Math.min(pcm.length, start + len);
  for (let i = Math.max(0, start); i < end; i++) e += pcm[i] * pcm[i];
  return end > start ? e / (end - start) : 0;
}

/**
 * Onsets of the probe tone (ms from the buffer start): the band is loud AND pure.
 * The band amplitude is read
 * over a TRAILING window, which ramps linearly while the tone fills it, so the tone
 * starts about half a window before the amplitude first reaches half its plateau;
 * that is where the onset is placed.
 */
export function toneOnsets(pcm: Float32Array, sampleRate: number, options: ToneOnsetOptions = {}): number[] {
  const o = { ...TONE_DEFAULTS, ...options };
  const win = Math.max(4, Math.round((o.windowMs / 1000) * sampleRate));
  const hop = Math.max(1, Math.round((o.hopMs / 1000) * sampleRate));
  const amps: number[] = [];
  const purity: number[] = [];
  for (let end = win; end <= pcm.length; end += hop) {
    const a = toneAmplitude(pcm, sampleRate, end - win, win, o.toneHz);
    const ms = meanSquare(pcm, end - win, win);
    amps.push(a);
    purity.push(ms > 0 ? (a * a) / 2 / ms : 0);
  }
  const threshold = Math.max(o.minAmplitude, o.noiseFactor * median(amps));
  const refractoryHops = Math.round(o.refractoryMs / o.hopMs);
  const out: number[] = [];
  let k = 0;
  while (k < amps.length) {
    if (amps[k] < threshold || purity[k] < o.minPurity) {
      k++;
      continue;
    }
    // The plateau: the largest amplitude over the next window or two.
    let plateau = 0;
    for (let j = k; j < Math.min(amps.length, k + Math.ceil((2 * win) / hop)); j++) plateau = Math.max(plateau, amps[j]);
    // Walk back to where the ramp crossed half the plateau.
    let h = k;
    while (h > 0 && amps[h - 1] >= plateau / 2) h--;
    while (h < amps.length && amps[h] < plateau / 2) h++;
    const endSample = win + h * hop;
    out.push(((endSample - win / 2) / sampleRate) * 1000);
    k = h + Math.max(1, refractoryHops);
  }
  return out;
}

export interface StrikePair {
  strikeMs: number;
  answerMs: number;
  /** The event-to-sound latency this pair measures. */
  latencyMs: number;
}

export interface PairOptions {
  /** The answer must follow its strike by at least this... */
  minLatencyMs?: number;
  /** ...and at most this. */
  maxLatencyMs?: number;
  /** A broadband onset this close to an answer IS the answer (the beep is loud in every
   *  band), not a strike, and is dropped. */
  answerGuardMs?: number;
  /** Broadband onsets closer than this to the previous one belong to the same strike
   *  (a bounce, a second finger, a re-armed tail); the strike is the cluster's FIRST. */
  clusterGapMs?: number;
}

export const PAIR_DEFAULTS: Required<PairOptions> = { minLatencyMs: 10, maxLatencyMs: 600, answerGuardMs: 5, clusterGapMs: 150 };

/** The strikes proper: broadband onsets that are not answers, one per cluster (its first). */
export function strikeClusters(strikesMs: readonly number[], answersMs: readonly number[], options: PairOptions = {}): number[] {
  const o = { ...PAIR_DEFAULTS, ...options };
  const own = [...strikesMs]
    .filter((s) => !answersMs.some((a) => Math.abs(a - s) <= o.answerGuardMs))
    .sort((a, b) => a - b);
  const starts: number[] = [];
  let prev = -Infinity;
  for (const s of own) {
    if (s - prev > o.clusterGapMs) starts.push(s);
    prev = s;
  }
  return starts;
}

/**
 * Pair each answer with the latest unused strike (a cluster's first onset, see
 * {@link strikeClusters}) before it within the latency window. Strikes the app missed
 * and answers with no strike (false triggers) are left out; the caller reports both
 * counts.
 */
export function pairStrikes(strikesMs: readonly number[], answersMs: readonly number[], options: PairOptions = {}): StrikePair[] {
  const o = { ...PAIR_DEFAULTS, ...options };
  const strikes = strikeClusters(strikesMs, answersMs, o);
  const used = new Set<number>();
  const pairs: StrikePair[] = [];
  for (const a of [...answersMs].sort((x, y) => x - y)) {
    let best = -1;
    strikes.forEach((s, i) => {
      const d = a - s;
      if (d < o.minLatencyMs || d > o.maxLatencyMs || used.has(i)) return;
      if (best < 0 || s > strikes[best]) best = i;
    });
    if (best < 0) continue;
    used.add(best);
    pairs.push({ strikeMs: strikes[best], answerMs: a, latencyMs: a - strikes[best] });
  }
  return pairs;
}
