/**
 * `performance` node — the conductor's hand. Maps a continuous control signal
 * (0..1, e.g. hand height via `pick`) into a tempo (`bpm`) and a `velocityScale`
 * (dynamics) that drive `transport` + `score`. Optional *humanization* adds a
 * small deterministic jitter to tempo/velocity so a fixed piece breathes — the
 * same overlay mechanism, driven by noise instead of a gesture.
 *
 * Pure + deterministic: the jitter is a hash of `ctx.time` (no Math.random), so
 * runs replay exactly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';
import { clamp01, rangeMap } from '@/music/theory';

const Params = z.object({
  bpmMin: z.number().default(60),
  bpmMax: z.number().default(160),
  dynMin: z.number().min(0).max(1).default(0.4),
  dynMax: z.number().min(0).max(1).default(1),
  /** Tempo jitter amplitude in BPM (humanization). */
  humanizeBpm: z.number().min(0).default(0),
  /** Velocity jitter amplitude 0..1 (humanization). */
  humanizeVel: z.number().min(0).default(0),
});
type Params = z.infer<typeof Params>;

/** Deterministic pseudo-noise in [-0.5, 0.5] from a scalar seed (classic hash). */
function hashNoise(t: number): number {
  const x = Math.sin(t * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) - 0.5;
}

export const performanceNode = defineNode<Params>({
  type: 'performance',
  title: 'Performance',
  description: 'Control signal → tempo (bpm) + dynamics (velocityScale), with optional humanization.',
  inputs: [{ name: 'control', kind: 'number', default: 0.5 }],
  outputs: [
    { name: 'bpm', kind: 'number' },
    { name: 'velocityScale', kind: 'number' },
  ],
  params: Params,
  process(inputs, p, ctx: NodeContext) {
    const c = clamp01(typeof inputs.control === 'number' ? inputs.control : 0.5);
    const n = hashNoise(ctx.time);
    const bpm = Math.max(1, rangeMap(c, 0, 1, p.bpmMin, p.bpmMax) + p.humanizeBpm * n);
    const velocityScale = clamp01(rangeMap(c, 0, 1, p.dynMin, p.dynMax) + p.humanizeVel * n);
    return { bpm, velocityScale };
  },
});
