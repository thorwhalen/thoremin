/**
 * `one-euro` node — the 1€ filter (Casiez et al. 2012) for smoothing a noisy
 * real-time control signal. Landmark trackers jitter; naive low-pass smoothing
 * adds lag. The 1€ filter adapts its cutoff to signal speed: heavy smoothing
 * when the hand is still (kills jitter), light smoothing when moving fast (stays
 * responsive). Drop it between a feature and a mapping, e.g.
 * `pick('right.x') → one-euro → progression.position`.
 *
 * Pure + deterministic (uses ctx.dt as the timestep), so it replays exactly.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import type { NodeContext } from '@/dag';

const Params = z.object({
  /** Cutoff (Hz) at rest. Lower = smoother (more lag) when the signal is still. */
  minCutoff: z.number().min(0).default(1.0),
  /** Speed coefficient. Higher = more responsive on fast moves (less lag). */
  beta: z.number().min(0).default(0.01),
  /** Cutoff (Hz) for the derivative estimate. */
  dCutoff: z.number().min(0).default(1.0),
  /** Fallback dt (seconds) when ctx.dt is 0 (e.g. the first tick). */
  fallbackDt: z.number().min(1e-6).default(1 / 60),
});
type Params = z.infer<typeof Params>;

/** Smoothing factor for a low-pass with the given cutoff and timestep. */
function smoothingAlpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
}

export const oneEuroNode = defineNode<Params>({
  type: 'one-euro',
  roles: ['mapping'],
  title: 'One-Euro Filter',
  description: 'Adaptive jitter smoothing for a noisy control value (smooth at rest, responsive when fast).',
  inputs: [{ name: 'value', kind: 'number', default: 0 }],
  outputs: [{ name: 'value', kind: 'number' }],
  params: Params,
  make(p) {
    let xPrev: number | undefined;
    let dxPrev = 0;
    return {
      process(inputs, ctx: NodeContext) {
        const x = typeof inputs.value === 'number' && Number.isFinite(inputs.value) ? inputs.value : 0;
        const dt = ctx.dt > 0 ? ctx.dt : p.fallbackDt;
        if (xPrev === undefined) {
          xPrev = x;
          dxPrev = 0;
          return { value: x };
        }
        const dx = (x - xPrev) / dt;
        const dxHat = dxPrev + smoothingAlpha(p.dCutoff, dt) * (dx - dxPrev);
        const cutoff = p.minCutoff + p.beta * Math.abs(dxHat);
        const xHat = xPrev + smoothingAlpha(cutoff, dt) * (x - xPrev);
        xPrev = xHat;
        dxPrev = dxHat;
        return { value: xHat };
      },
    };
  },
});
