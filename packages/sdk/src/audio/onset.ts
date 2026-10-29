/**
 * A causal onset detector for struck sounds, built to run on the audio thread
 * (`docs/design/audio-input.md`, `docs/research/live-audio-to-audio.md` §5).
 *
 * Why this shape. A tap on a table is broadband and its attack is a step of tens of dB in
 * well under a millisecond, so an energy detector on short hops finds it as fast as any
 * spectral-flux detector would, with no FFT and no lookahead (the frame-based detectors of
 * the literature buy robustness on pitched music with 10-50 ms of latency, the wrong trade
 * here). Three choices carry the robustness instead:
 *
 * - **Pre-emphasis** (`y[n] = x[n] - a x[n-1]`) takes out rumble, hum and footsteps, which are
 *   loud and low and never a tap.
 * - **The threshold is relative to the room**: a noise floor tracked from the hops that are not
 *   attacks (it falls fast and rises slowly, so a held sound does not drag it up), times a ratio,
 *   never below an absolute level. A fixed level is wrong in every room but one.
 * - **A new onset needs a new attack**: the hop's energy must be `riseRatio` times the LOUDEST hop
 *   of the last `riseMs` (skipping the one just before, so an attack that builds over two hops is
 *   still one), and a refractory time must have passed since the last onset. A ringing pot stays
 *   above the noise floor for a second; a level test alone would read its tail as one long onset,
 *   or many, and a re-arm that waits for the tail to decay would miss a second tap on a pot still
 *   ringing. The reference is the recent PEAK, not the recent minimum, because a hop (0.7 ms) is
 *   shorter than a low mode's period: hop energies inside a pure decaying tail swing by 20 dB
 *   between a zero crossing and a crest, and a minimum-referenced test fires on every swing.
 * - **The rise is tested per band** (low, mid, high: one-pole crossovers at `splitHz`), and any band
 *   rising is an attack. A table's thud under a pot still ringing from the last tap adds little
 *   to the TOTAL energy (the pot is louder) but multiplies the low band's; a whole-signal test
 *   misses it, and it was 9 % of the taps of a synthetic take of four surfaces before this.
 *
 * Placement: the onset frame is the first sample of the crossing hop whose pre-emphasised
 * square exceeds the threshold (sample-accurate, not hop-accurate); the detection is known at
 * the end of that hop, so the detector adds at most `hop` samples of latency (0.67 ms at the
 * default 32 samples and 48 kHz).
 */

export interface OnsetOptions {
  sampleRate: number;
  /** Hop for the energy envelope, samples. */
  hop?: number;
  /** Pre-emphasis coefficient (0 = none). */
  preEmphasis?: number;
  /** An attack is energy above `thresholdRatio` x the noise floor (10 = +10 dB)... */
  thresholdRatio?: number;
  /** ...and above this absolute mean-square level (pre-emphasised; 1e-6 = -60 dBFS). */
  minEnergy?: number;
  /** ...and at least `riseRatio` x the loudest hop of the `riseMs` before it (the latest hop skipped). */
  riseRatio?: number;
  riseMs?: number;
  /** No onset sooner than this after the last one, ms. */
  refractoryMs?: number;
  /** The two crossover frequencies of the three rise bands, Hz. */
  splitHz?: readonly [number, number];
  /** Noise-floor tracking: time constants for falling and rising, ms. */
  floorFallMs?: number;
  floorRiseMs?: number;
  /** After an onset, the floor ignores hops above the threshold for this long, ms. */
  floorHoldMs?: number;
}

export const ONSET_DEFAULTS = {
  hop: 32,
  preEmphasis: 0.95,
  thresholdRatio: 10,
  minEnergy: 1e-6,
  riseRatio: 2.5,
  riseMs: 12,
  splitHz: [400, 2000] as readonly [number, number],
  refractoryMs: 35,
  floorFallMs: 50,
  floorRiseMs: 2000,
  floorHoldMs: 300,
} as const;

export interface DetectedOnset {
  frame: number;
  detectedFrame: number;
  strength: number;
}

export interface OnsetDetector {
  /**
   * Feed samples whose first is at context frame `frame`; calls `onOnset` for each onset
   * found (no allocation per call when the callback does not allocate).
   */
  push(samples: Float32Array, frame: number, onOnset: (o: DetectedOnset) => void): void;
  /** The current noise floor (mean-square, pre-emphasised). */
  floor(): number;
  /** The current threshold (mean-square, pre-emphasised). */
  threshold(): number;
  reset(): void;
}

export function createOnsetDetector(options: OnsetOptions): OnsetDetector {
  const o = { ...ONSET_DEFAULTS, ...options };
  const hop = Math.max(1, Math.round(o.hop));
  const hopS = hop / o.sampleRate;
  const fall = 1 - Math.exp(-hopS / (o.floorFallMs / 1000));
  const rise = 1 - Math.exp(-hopS / (o.floorRiseMs / 1000));
  const refractory = Math.round((o.refractoryMs / 1000) * o.sampleRate);
  const floorHold = Math.round((o.floorHoldMs / 1000) * o.sampleRate);

  // The hop being filled: its squares (to place the onset inside it) and its sum.
  const sq = new Float64Array(hop);
  let fill = 0;
  let hopStart = 0;
  let sum = 0;
  let prevX = 0;
  // The three rise bands: their per-hop energy sums, floors and recent hops (a ring of riseMs,
  // plus the skipped latest hop), band-major.
  const BANDS = 3;
  const lpA = 1 - Math.exp((-2 * Math.PI * o.splitHz[0]) / o.sampleRate);
  const lpB = 1 - Math.exp((-2 * Math.PI * o.splitHz[1]) / o.sampleRate);
  let lowState = 0;
  let midState = 0;
  const bandSum = new Float64Array(BANDS);
  const bandFloor = new Float64Array(BANDS).fill(-1);
  const ringLen = Math.max(2, Math.round(o.riseMs / 1000 / hopS) + 1);
  const recent = new Float64Array(BANDS * ringLen);
  let recentAt = 0;
  let noise = -1; // unset until the first hop
  let lastOnset = -Infinity;

  const thresholdOf = () => Math.max(o.minEnergy, noise * o.thresholdRatio);

  const endHop = (onOnset: (o: DetectedOnset) => void) => {
    const e = sum / hop;
    if (noise < 0) noise = e;
    const thr = thresholdOf();
    // Per band: the loudest recent hop, skipping the latest (written at recentAt - 1).
    const latest = (recentAt + ringLen - 1) % ringLen;
    let rising = false;
    for (let b = 0; b < BANDS; b++) {
      const eb = bandSum[b] / hop;
      if (bandFloor[b] < 0) bandFloor[b] = eb;
      let loudest = 0;
      for (let i = 0; i < ringLen; i++) if (i !== latest && recent[b * ringLen + i] > loudest) loudest = recent[b * ringLen + i];
      const bandThr = Math.max(o.minEnergy * 0.01, bandFloor[b] * o.thresholdRatio);
      if (eb > bandThr && eb >= o.riseRatio * Math.max(loudest, bandFloor[b])) rising = true;
    }
    const startFrame = hopStart;
    const attack = e > thr && rising;
    if (attack && startFrame - lastOnset >= refractory) {
      // Sample-accurate placement: the first square above the threshold in this hop.
      let at = 0;
      while (at < hop - 1 && sq[at] <= thr) at++;
      lastOnset = startFrame + at;
      onOnset({ frame: startFrame + at, detectedFrame: startFrame + hop, strength: noise > 0 ? e / noise : Infinity });
    }
    // The floor learns from hops below the threshold (falling fast, so the quiet after a tap
    // pulls it back down), and from any hop once `floorHoldMs` has passed since the last onset,
    // slowly: a room that got louder (a fan) raises it, a tap's own tail does not.
    const learn = e < thr || startFrame - lastOnset >= floorHold;
    if (learn) noise += (e < noise ? fall : rise) * (e - noise);
    for (let b = 0; b < BANDS; b++) {
      const eb = bandSum[b] / hop;
      if (learn) bandFloor[b] += (eb < bandFloor[b] ? fall : rise) * (eb - bandFloor[b]);
      recent[b * ringLen + recentAt] = eb;
      bandSum[b] = 0;
    }
    recentAt = (recentAt + 1) % ringLen;
  };

  return {
    push(samples, frame, onOnset) {
      for (let i = 0; i < samples.length; i++) {
        if (fill === 0) hopStart = frame + i;
        const x = samples[i];
        const y = x - o.preEmphasis * prevX;
        prevX = x;
        const s = y * y;
        sq[fill++] = s;
        sum += s;
        lowState += lpA * (x - lowState);
        midState += lpB * (x - midState);
        const hi = x - midState;
        const mid = midState - lowState;
        bandSum[0] += lowState * lowState;
        bandSum[1] += mid * mid;
        bandSum[2] += hi * hi;
        if (fill === hop) {
          endHop(onOnset);
          fill = 0;
          sum = 0;
        }
      }
    },
    floor: () => Math.max(0, noise),
    threshold: thresholdOf,
    reset() {
      fill = 0;
      sum = 0;
      prevX = 0;
      recent.fill(0);
      bandSum.fill(0);
      bandFloor.fill(-1);
      lowState = 0;
      midState = 0;
      noise = -1;
      lastOnset = -Infinity;
    },
  };
}
