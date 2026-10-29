/**
 * A percussion kit synthesised in code: the sound mapper's default targets (a tap on the table's
 * middle becomes a kick, its edge a snare, a pot a cowbell). Synthesised rather than shipped as
 * files: no bytes in the bundle, no licence to track, any sample rate exactly (a recorded kit
 * would be resampled to the context's rate on every load).
 *
 * Each voice is a textbook recipe (a pitch-swept sine for a kick, a tone and filtered noise for a
 * snare, square partials for a cowbell...), short and with an attack at sample 0, since a mapped
 * sample's first sample is the moment the player hears the hit.
 */
import { seededRandom } from './synthetic_taps';

export const KIT_SOUNDS = ['kick', 'snare', 'hat', 'clap', 'tom', 'woodblock', 'cowbell', 'rim'] as const;
export type KitSound = (typeof KIT_SOUNDS)[number];

export const KIT_LABELS: Record<KitSound, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hat: 'Hi-hat',
  clap: 'Clap',
  tom: 'Tom',
  woodblock: 'Woodblock',
  cowbell: 'Cowbell',
  rim: 'Rim',
};

const TAU = 2 * Math.PI;

/** A one-pole high-pass over `x`, in place. */
function highpass(x: Float32Array, hz: number, sr: number): void {
  const a = Math.exp((-TAU * hz) / sr);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    const y = a * (prevY + x[i] - prevX);
    prevX = x[i];
    prevY = y;
    x[i] = y;
  }
}

/** A two-pole band-pass (resonator) over `x`, in place. */
function bandpass(x: Float32Array, hz: number, q: number, sr: number): void {
  const w = (TAU * hz) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(w);
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

function normalise(x: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) for (let i = 0; i < x.length; i++) x[i] *= peak / m;
  return x;
}

/** One kit voice at `sampleRate`, peak 0.9. Deterministic (seeded noise). */
export function synthKitSound(sound: KitSound, sampleRate: number): Float32Array {
  const sr = sampleRate;
  const rand = seededRandom(KIT_SOUNDS.indexOf(sound) + 101);
  const noise = (n: number) => Float32Array.from({ length: n }, () => 2 * rand() - 1);
  const len = (s: number) => Math.round(s * sr);
  switch (sound) {
    case 'kick': {
      const x = new Float32Array(len(0.45));
      let phase = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        phase += (TAU * (45 + 110 * Math.exp(-t / 0.03))) / sr;
        x[i] = Math.sin(phase) * Math.exp(-t / 0.12) + (i < len(0.002) ? 0.5 * (2 * rand() - 1) : 0);
      }
      return normalise(x);
    }
    case 'snare': {
      const n = noise(len(0.25));
      highpass(n, 1500, sr);
      const x = new Float32Array(n.length);
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        x[i] = 0.6 * Math.sin(TAU * 185 * t) * Math.exp(-t / 0.04) + n[i] * Math.exp(-t / 0.07);
      }
      return normalise(x);
    }
    case 'hat': {
      const n = noise(len(0.09));
      highpass(n, 7000, sr);
      for (let i = 0; i < n.length; i++) n[i] *= Math.exp(-i / sr / 0.022);
      return normalise(n, 0.6);
    }
    case 'clap': {
      const n = noise(len(0.3));
      bandpass(n, 1200, 1.2, sr);
      const x = new Float32Array(n.length);
      // Three quick bursts, then the tail: the hands meeting a little apart.
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        let env = Math.exp(-t / 0.09);
        for (const at of [0, 0.011, 0.022]) if (t >= at && t < at + 0.009) env = Math.max(env, Math.exp(-(t - at) / 0.003));
        x[i] = n[i] * env;
      }
      return normalise(x);
    }
    case 'tom': {
      const x = new Float32Array(len(0.4));
      let phase = 0;
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        phase += (TAU * (110 + 60 * Math.exp(-t / 0.05))) / sr;
        x[i] = Math.sin(phase) * Math.exp(-t / 0.15);
      }
      return normalise(x);
    }
    case 'woodblock': {
      const x = noise(len(0.12));
      for (let i = 0; i < x.length; i++) x[i] *= i < len(0.0015) ? 1 : 0;
      bandpass(x, 1800, 25, sr);
      return normalise(x);
    }
    case 'cowbell': {
      const x = new Float32Array(len(0.35));
      for (let i = 0; i < x.length; i++) {
        const t = i / sr;
        const sq = (hz: number) => (Math.sin(TAU * hz * t) >= 0 ? 1 : -1);
        x[i] = (sq(540) + sq(800)) * (0.6 * Math.exp(-t / 0.012) + 0.4 * Math.exp(-t / 0.12));
      }
      bandpass(x, 900, 2, sr);
      return normalise(x, 0.7);
    }
    case 'rim': {
      const x = noise(len(0.06));
      for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / sr / 0.004);
      bandpass(x, 2600, 8, sr);
      return normalise(x);
    }
  }
}
