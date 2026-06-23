/**
 * `synthetic-hands` node — a deterministic, camera-free source of
 * {@link HandsFrame}s. The right hand's index finger sweeps left→right while
 * openness and pinch oscillate. Used for demos, headless end-to-end DAG runs,
 * and as a generator of test fixtures (record its downstream once, replay
 * forever).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { makeHandKeypoints, type Hand, type HandsFrame } from '../domain';

const Params = z.object({
  width: z.number().default(640),
  height: z.number().default(480),
  /** Seconds for the index finger to sweep the full width once. */
  sweepPeriod: z.number().default(4),
  /** Seconds for one openness oscillation. */
  opennessPeriod: z.number().default(3),
  /** Seconds for one pinch oscillation. */
  pinchPeriod: z.number().default(2.5),
  /** Which hand(s) to emit. */
  hands: z.enum(['right', 'left', 'both']).default('right'),
  /** Vertical position of the hand, normalized 0 (top) .. 1 (bottom). */
  yNorm: z.number().default(0.5),
  /** Hand size in pixels. */
  scale: z.number().default(80),
});
type Params = z.infer<typeof Params>;

function osc(time: number, period: number, phase = 0): number {
  return 0.5 + 0.5 * Math.sin((2 * Math.PI * time) / period + phase);
}

export const syntheticHandsNode = defineNode<Params>({
  type: 'synthetic-hands',
  roles: ['source'],
  title: 'Synthetic Hands',
  description: 'Camera-free animated hand landmark source for tests & demos.',
  inputs: [],
  outputs: [{ name: 'hands', kind: 'hands-frame' }],
  params: Params,
  process(_inputs, p, ctx) {
    const margin = p.scale;
    const phase = (ctx.time / p.sweepPeriod) % 1;
    const cx = margin + phase * (p.width - 2 * margin);
    const cy = p.yNorm * p.height;
    const spread = osc(ctx.time, p.opennessPeriod);
    const pinch = osc(ctx.time, p.pinchPeriod, Math.PI / 2);

    const hands: Hand[] = [];
    if (p.hands === 'right' || p.hands === 'both') {
      hands.push({
        handedness: 'Right',
        keypoints: makeHandKeypoints({ cx, cy, scale: p.scale, spread, pinch, handedness: 'Right' }),
        score: 1,
      });
    }
    if (p.hands === 'left' || p.hands === 'both') {
      // Left hand sweeps in the opposite phase for visual contrast.
      const lcx = p.width - cx;
      hands.push({
        handedness: 'Left',
        keypoints: makeHandKeypoints({ cx: lcx, cy, scale: p.scale, spread: 1 - spread, pinch, handedness: 'Left' }),
        score: 1,
      });
    }
    const frame: HandsFrame = { width: p.width, height: p.height, hands };
    return { hands: frame };
  },
});
