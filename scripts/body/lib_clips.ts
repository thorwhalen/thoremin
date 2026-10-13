/**
* Clips for the channel measurement (#373): the committed body fixtures, and the synthetic control for the channel measurement (#373): the `synthetic-body`
 * skeleton with every period set to a known level of a 120 bpm grid (bounce at the
 * beat, steps and arms at the half-bar, sway at the bar), plus seeded Gaussian
 * landmark noise of a real tracker's size. A measurement that cannot find the levels
 * here cannot be trusted on a real clip; it is a check of the method, not evidence
 * about bodies, and the write-up says so.
 */
import { syntheticBodyNode } from '../../src/nodes/sources/synthetic_body';
import type { BodyFrame } from '@thoremin/sdk/nodes/domain';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseRecords } from '@thoremin/dag';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(HERE, '..', '..', 'test', 'fixtures');

export interface BodyClip {
  name: string;
  frames: BodyFrame[];
  fps: number;
  grid: number[];
  beatsPerBar: number;
  /** False when the grid's phase is not known (a stated tempo only): raw F, BAS and
   *  Cemgil are then meaningless, and only R and the lag-free F are reported. */
  phaseKnown: boolean;
}

interface GridMeta {
  beats?: number[];
  beatsPerBar?: number;
}

export function loadClip(name: string): BodyClip {
  const dir = join(FIXTURES, name);
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { fps: number; grid?: GridMeta; music?: { bpm: number } | null };
  const raw = readFileSync(join(dir, 'camBody.body.ndjson.gz'));
  const frames = parseRecords(gunzipSync(raw).toString('utf8')).map((r) => r.value) as BodyFrame[];
  const dur = frames.length / meta.fps;
  if (meta.grid?.beats?.length) {
    return { name, frames, fps: meta.fps, grid: meta.grid.beats, beatsPerBar: meta.grid.beatsPerBar ?? 4, phaseKnown: true };
  }
  if (!meta.music?.bpm) throw new Error(`${name}: meta.json has neither grid.beats nor music.bpm`);
  const p = 60 / meta.music.bpm;
  const grid = Array.from({ length: Math.floor(dur / p) + 1 }, (_, i) => i * p);
  return { name, frames, fps: meta.fps, grid, beatsPerBar: meta.grid?.beatsPerBar ?? 4, phaseKnown: false };
}

/** The control's beat period (120 bpm) and bar. */
export const SYNTH_BEAT_S = 0.5;
export const SYNTH_BEATS_PER_BAR = 4;

/** mulberry32: a tiny seeded generator, so the control is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticOptions {
  seconds?: number;
  fps?: number;
  /** Landmark noise, pixels (σ) on a 120 px torso. */
  noisePx?: number;
  seed?: number;
}

export function syntheticClip({ seconds = 30, fps = 30, noisePx = 1.5, seed = 373 }: SyntheticOptions = {}): BodyClip {
  const params = syntheticBodyNode.params.parse({
    bouncePeriod: SYNTH_BEAT_S,
    stepPeriod: 2 * SYNTH_BEAT_S,
    armPeriod: 2 * SYNTH_BEAT_S,
    swayPeriod: SYNTH_BEATS_PER_BAR * SYNTH_BEAT_S,
  });
  const node = syntheticBodyNode.make(params);
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const frames: BodyFrame[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const out = node.process({}, { time: i / fps } as never) as { body: BodyFrame };
    const f = out.body;
    frames.push({ ...f, landmarks: f.landmarks.map((p) => ({ ...p, x: p.x + noisePx * gauss(), y: p.y + noisePx * gauss() })) });
  }
  const grid = Array.from({ length: Math.floor(seconds / SYNTH_BEAT_S) + 1 }, (_, k) => k * SYNTH_BEAT_S);
  return { name: 'synthetic', frames, fps, grid, beatsPerBar: SYNTH_BEATS_PER_BAR, phaseKnown: true };
}
