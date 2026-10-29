/**
 * A cascade formant synthesiser's design (Klatt 1980, the cascade branch): a voice-like source
 * through five two-pole resonators in series, F1 to F3 from the vowel and F4, F5 fixed. In a
 * cascade the formants' relative levels come out of the resonators themselves (each has unity gain
 * at 0 Hz and its peak at its frequency), so a front vowel's high F2 and F3 sound at their natural
 * strength; the parallel branch needs a level per formant per vowel, and with fixed levels its [i]
 * is mostly F1 (heard as [u]).
 *
 * A two-pole resonator with unity gain at 0 Hz is the RBJ low-pass biquad with Q = F / bandwidth,
 * which is what a browser's `BiquadFilterNode` of type `lowpass` computes (its Q in dB, `qDb`), so
 * the browser synth (`play/src/vowel_synth.ts`) is five of those; `renderVowel` runs the same
 * filters offline, for tests. The source is a sawtooth: its -6 dB per octave is the glottal pulse's
 * -12 with the lips' +6.
 *
 * Pure: arithmetic.
 */

export interface Resonance {
  hz: number;
  bw: number;
}

/** Klatt's bandwidths for F1-F3 and his fixed F4 and F5, Hz. */
export const CASCADE = {
  bw: [60, 90, 150] as const,
  fixed: [
    { hz: 3300, bw: 250 },
    { hz: 3750, bw: 200 },
  ] as const,
};

/** The five resonators sounding formants F1-F3 (Hz); F4 and F5 move up with a higher voice. */
export function cascadeOf(f: { f1: number; f2: number; f3: number }, voiceScale = 1): Resonance[] {
  const fixed = CASCADE.fixed.map((r) => ({ hz: Math.max(r.hz * voiceScale, f.f3 + 300), bw: r.bw }));
  return [
    { hz: f.f1, bw: CASCADE.bw[0] },
    { hz: f.f2, bw: CASCADE.bw[1] },
    { hz: f.f3, bw: CASCADE.bw[2] },
    ...fixed,
  ];
}

/** A resonator's Q as a browser's low-pass biquad takes it: decibels. */
export const qDb = (r: Resonance): number => 20 * Math.log10(r.hz / r.bw);

/** The cascade's gain at `hz` (the analog resonators' product; the biquads match it well below Nyquist). */
export function cascadeGain(rs: readonly Resonance[], hz: number): number {
  let g = 1;
  for (const r of rs) {
    const u = hz / r.hz;
    const q = r.hz / r.bw;
    g /= Math.hypot(1 - u * u, u / q);
  }
  return g;
}

/**
 * The output gain that sounds every vowel equally loud: one over the RMS of the sawtooth's
 * harmonics (amplitude 1/k) through the cascade, up to 5 kHz.
 */
export function levelFor(rs: readonly Resonance[], pitchHz: number): number {
  let e = 0;
  for (let k = 1; k * pitchHz < 5000; k++) e += (cascadeGain(rs, k * pitchHz) / k) ** 2;
  return 1 / Math.sqrt(e);
}

/**
 * Render `seconds` of the vowel offline at `sampleRate`: a naive sawtooth at `pitchHz` through the
 * cascade, as RBJ low-pass biquads (the browser's own formulas), scaled by `levelFor`.
 */
export function renderVowel(f: { f1: number; f2: number; f3: number }, { sampleRate = 48000, seconds = 0.5, pitchHz = 130, voiceScale = 1, level = 0.3 } = {}): Float32Array {
  const rs = cascadeOf(f, voiceScale);
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const filters = rs.map((r) => {
    const w0 = (2 * Math.PI * r.hz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * (r.hz / r.bw));
    const c = Math.cos(w0);
    const a0 = 1 + alpha;
    return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  });
  const gain = level * levelFor(rs, pitchHz);
  let phase = 0;
  for (let n = 0; n < out.length; n++) {
    let s = 2 * phase - 1;
    phase = (phase + pitchHz / sampleRate) % 1;
    for (const q of filters) {
      const y = q.b0 * s + q.b1 * q.x1 + q.b2 * q.x2 - q.a1 * q.y1 - q.a2 * q.y2;
      q.x2 = q.x1;
      q.x1 = s;
      q.y2 = q.y1;
      q.y1 = y;
      s = y;
    }
    out[n] = s * gain;
  }
  return out;
}
