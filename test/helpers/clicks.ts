/**
 * Synthetic click tracks for the song beat tracker (#186 PR G; research map §7): a kick
 * (a decaying low sine) on every beat, optional hi-hat eighths (decaying seeded noise,
 * swung when asked) and a little background noise, rendered at test time rather than
 * committed as audio. The ground truth is returned beside the samples.
 */
import { seeded } from './random';

/** The analysis rate the app decodes songs at (`src/app/song/load.ts`). */
export const SR = 22050;

export interface ClickTrackOptions {
  bpm: number;
  seconds: number;
  /** Time of the first beat, seconds. */
  offset?: number;
  /** Ramp the tempo linearly to this bpm by the end (a drifting song). */
  endBpm?: number;
  /** Hi-hat eighths between the beats. */
  hats?: boolean;
  /** Where the off-beat eighth falls, as a fraction of the beat (0.5 = straight). */
  swing?: number;
  /** The hi-hat's peak amplitude (the kick's is 0.8). */
  hatLevel?: number;
  seed?: number;
}

export function renderClickTrack(o: ClickTrackOptions): { samples: Float32Array; beats: number[] } {
  const n = Math.round(o.seconds * SR);
  const x = new Float32Array(n);
  const rnd = seeded(o.seed ?? 7);
  for (let i = 0; i < n; i++) x[i] = (rnd() - 0.5) * 0.002;
  const beats: number[] = [];
  const end = o.endBpm ?? o.bpm;
  let t = o.offset ?? 0;
  while (t < o.seconds) {
    beats.push(t);
    const bpm = o.bpm + (end - o.bpm) * (t / o.seconds);
    const period = 60 / bpm;
    addBurst(x, t, 0.12, (k) => Math.sin((2 * Math.PI * 60 * k) / SR) * 0.8, 30);
    if (o.hats) addBurst(x, t + period * (o.swing ?? 0.5), 0.03, () => (rnd() - 0.5) * 2 * (o.hatLevel ?? 0.25), 150);
    t += period;
  }
  return { samples: x, beats };
}

/** Add a decaying burst starting at `t` seconds. */
function addBurst(x: Float32Array, t: number, len: number, wave: (k: number) => number, decay: number): void {
  const i0 = Math.round(t * SR);
  const m = Math.round(len * SR);
  for (let k = 0; k < m && i0 + k < x.length; k++) x[i0 + k] += wave(k) * Math.exp((-decay * k) / SR);
}
