/**
 * A synthetic multi-joint body that marks a beat (#374): the beating wrist strokes, its
 * elbow follows a little late, and the trunk bounces with a sharp bottom, all at one
 * beat whose tempo may change (`bpm` as a function of time). Image pixels, `y` down,
 * a torso of `torsoPx`; seeded tracker noise. The beat times are returned exactly, so
 * a detector's anchors are scored against the truth, not against another detector.
 */
import type { ChannelFrame } from '@thoremin/ictus';
import { gaussian, seeded } from './random';

export interface BounceOptions {
  seconds?: number;
  fps?: number;
  /** Tempo at time t (seconds), bpm. Default a constant 100. */
  bpm?: (t: number) => number;
  /** The first beat's time, seconds. */
  firstBeat?: number;
  noisePx?: number;
  torsoPx?: number;
  seed?: number;
  /** Visibility of a channel at time t (default 0.99 everywhere). */
  visibility?: (channel: string, t: number) => number;
}

export interface Bounce {
  frames: ChannelFrame[];
  beats: number[];
}

export function bounce({ seconds = 20, fps = 30, bpm = () => 100, firstBeat = 0.4, noisePx = 1, torsoPx = 150, seed = 374, visibility = () => 0.99 }: BounceOptions = {}): Bounce {
  const rnd = seeded(seed);
  const n = () => noisePx * gaussian(rnd);
  const frames: ChannelFrame[] = [];
  const beats: number[] = [];
  // The beat position by integration on a fine step (so a tempo ramp is exact enough).
  const h = 1e-4;
  let phi = -firstBeat * (bpm(0) / 60);
  let tPrev = 0;
  let nextFrame = 0;
  for (let t = 0; t <= seconds + 1e-9; t += h) {
    const before = phi;
    phi += (bpm(t) / 60) * h;
    if (Math.floor(phi) > Math.floor(before) && phi >= 0) beats.push(t + h * ((Math.floor(phi) - phi) / (phi - before)) + h);
    if (t + 1e-12 >= nextFrame / fps) {
      const u = 2 * Math.PI * phi;
      const ch = (name: string, x: number, y: number) => ({ x: x + n(), y: y + n(), visibility: visibility(name, t) });
      frames.push({
        t: nextFrame / fps,
        scale: torsoPx * (1 + 0.01 * gaussian(rnd)),
        channels: {
          wrist: ch('wrist', 400 + 30 * Math.sin(u / 2), 300 + 60 * (Math.cos(u) + 1) / 2),
          elbow: ch('elbow', 380 + 15 * Math.sin(u / 2), 330 + 30 * (Math.cos(u - 0.2) + 1) / 2),
          trunk: ch('trunk', 320, 420 + 10 * (1 - Math.abs(Math.sin(Math.PI * phi)))),
        },
      });
      nextFrame++;
    }
    tPrev = t;
  }
  void tPrev;
  return { frames, beats };
}
