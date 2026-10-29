/**
 * Synthetic struck sounds with KNOWN onsets: the ground truth a microphone take cannot supply
 * (the `synthetic-hands` idea, for audio). Each surface is a small modal model (a few damped
 * resonances excited by a short noise burst, the textbook model of an impact sound), and each
 * tap varies the way real taps do: mode frequencies by a few percent, mode amplitudes by where
 * it was struck, overall level by how hard, the burst's brightness by what struck it.
 *
 * Used by the tests and the offline latency harness (`scripts/audio/`), and by a no-microphone
 * source in the browser, so the whole sound mapper runs with no hardware. Seeded: the same seed
 * gives the same take, bit for bit.
 */

export interface Mode {
  hz: number;
  /** Time for the mode to fall by 60 dB / 6.9 (the exp time constant), s. */
  decay: number;
  amp: number;
}

export interface Surface {
  id: string;
  modes: Mode[];
  /** 0..1, how bright the striking burst is (0 = soft finger pad, 1 = fingernail). */
  brightness: number;
  /** Burst length, ms. */
  burstMs: number;
}

/** Four surfaces, chosen to be told apart the way a table's middle, its edge, a pot and a mug are. */
export const SURFACES: readonly Surface[] = [
  { id: 'table-middle', brightness: 0.25, burstMs: 2.5, modes: [{ hz: 170, decay: 0.03, amp: 1 }, { hz: 390, decay: 0.02, amp: 0.6 }, { hz: 720, decay: 0.012, amp: 0.3 }] },
  { id: 'table-edge', brightness: 0.55, burstMs: 1.5, modes: [{ hz: 260, decay: 0.02, amp: 0.7 }, { hz: 610, decay: 0.015, amp: 1 }, { hz: 1350, decay: 0.008, amp: 0.5 }] },
  { id: 'pot', brightness: 0.8, burstMs: 1, modes: [{ hz: 640, decay: 0.35, amp: 1 }, { hz: 1720, decay: 0.25, amp: 0.7 }, { hz: 3050, decay: 0.15, amp: 0.5 }, { hz: 4420, decay: 0.1, amp: 0.3 }] },
  { id: 'mug', brightness: 0.7, burstMs: 1, modes: [{ hz: 1180, decay: 0.12, amp: 1 }, { hz: 3260, decay: 0.07, amp: 0.6 }, { hz: 5900, decay: 0.04, amp: 0.3 }] },
];

/** A small seeded generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rand: () => number): number => {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

export interface TapOptions {
  sampleRate: number;
  /** Peak level, 0..1 (before the room). */
  level?: number;
  /** Variation scale (1 = the default spread of real taps). */
  variation?: number;
  /** Length, s. */
  duration?: number;
}

/** One tap on `surface`, starting at sample 0. */
export function synthTap(surface: Surface, rand: () => number, options: TapOptions): Float32Array {
  const sr = options.sampleRate;
  const v = options.variation ?? 1;
  const longest = Math.max(...surface.modes.map((m) => m.decay));
  const n = Math.round(sr * (options.duration ?? Math.min(1.5, longest * 7 + 0.01)));
  const out = new Float32Array(n);
  // The burst: noise shaped by a one-pole lowpass whose cutoff is the brightness.
  const burstN = Math.max(8, Math.round((surface.burstMs / 1000) * sr * (1 + 0.2 * v * gauss(rand))));
  const bright = Math.min(0.98, Math.max(0.02, surface.brightness + 0.08 * v * gauss(rand)));
  const burst = new Float64Array(burstN);
  let lp = 0;
  for (let i = 0; i < burstN; i++) {
    lp += bright * (gauss(rand) - lp);
    burst[i] = lp * Math.sin((Math.PI * i) / burstN);
  }
  // Each mode is a damped resonator driven by the burst (a two-pole filter), plus a little of
  // the burst itself (the click of contact).
  for (const m of surface.modes) {
    const hz = m.hz * (1 + 0.03 * v * gauss(rand));
    const amp = m.amp * Math.exp(0.3 * v * gauss(rand));
    const r = Math.exp(-1 / (m.decay * sr));
    const w = (2 * Math.PI * hz) / sr;
    const a1 = 2 * r * Math.cos(w);
    const a2 = -r * r;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const x = i < burstN ? burst[i] : 0;
      const y = x + a1 * y1 + a2 * y2;
      y2 = y1;
      y1 = y;
      out[i] += amp * y * Math.sin(w) * 0.5;
    }
  }
  for (let i = 0; i < burstN; i++) out[i] += 0.3 * bright * burst[i];
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const level = options.level ?? 0.3;
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= level / peak;
  return out;
}

export interface TakeOptions {
  sampleRate: number;
  seed?: number;
  /** Taps per surface. */
  perSurface?: number;
  surfaces?: readonly Surface[];
  /** Gap between taps, s: uniform in [min, max]. */
  gapMin?: number;
  gapMax?: number;
  /** Peak level range of a tap. */
  levelMin?: number;
  levelMax?: number;
  /** The room: white noise and mains hum, peak levels. */
  noise?: number;
  hum?: number;
  /** Silence before the first tap, s (the onset detector learns the room in it). */
  lead?: number;
  variation?: number;
}

export interface TakeTap {
  surface: string;
  /** The tap's first sample. */
  frame: number;
  level: number;
}

export interface Take {
  sampleRate: number;
  pcm: Float32Array;
  taps: TakeTap[];
}

/** A take: `perSurface` taps on each surface in a shuffled order, in a room. */
export function synthTake(options: TakeOptions): Take {
  const o = { seed: 1, perSurface: 10, surfaces: SURFACES, gapMin: 0.15, gapMax: 0.4, levelMin: 0.08, levelMax: 0.6, noise: 0.001, hum: 0.004, lead: 0.5, variation: 1, ...options };
  const rand = seededRandom(o.seed);
  const order: Surface[] = [];
  for (const s of o.surfaces) for (let i = 0; i < o.perSurface; i++) order.push(s);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const sr = o.sampleRate;
  const taps: TakeTap[] = [];
  const sounds: Float32Array[] = [];
  let t = Math.round(o.lead * sr);
  for (const s of order) {
    const level = o.levelMin + (o.levelMax - o.levelMin) * rand();
    taps.push({ surface: s.id, frame: t, level });
    sounds.push(synthTap(s, rand, { sampleRate: sr, level, variation: o.variation }));
    t += Math.round((o.gapMin + (o.gapMax - o.gapMin) * rand()) * sr);
  }
  const pcm = new Float32Array(t + sr);
  taps.forEach((tap, k) => {
    const s = sounds[k];
    for (let i = 0; i < s.length && tap.frame + i < pcm.length; i++) pcm[tap.frame + i] += s[i];
  });
  for (let i = 0; i < pcm.length; i++) pcm[i] += o.noise * (2 * rand() - 1) + o.hum * Math.sin((2 * Math.PI * 50 * i) / sr);
  return { sampleRate: sr, pcm, taps };
}
