/**
 * `synthetic-body` node (#186) — a deterministic, camera-free source of
 * {@link BodyFrame}s: an upright skeleton that bounces at a known period, sways,
 * raises and lowers its arms and bends its knees. The body-pipeline analogue of
 * `synthetic-hands`, and the ground truth for the pulse estimator: the bounce
 * period is a param, so a test knows the answer before asking.
 *
 * Pure `process()` over `ctx.time`, so it is reproducible under the engine's
 * injected clock (the determinism rule `test/body_slot.test.ts` enforces).
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { BODY_LANDMARK_COUNT, makeBodyKeypoints, type BodyFrame, type BodyStatus } from '../domain';
import { BODY_SLOT_OUTPUT } from './body_contract';

const Params = z.object({
  width: z.number().default(640),
  height: z.number().default(480),
  /** Seconds per vertical bounce (the pulse a test can measure). */
  bouncePeriod: z.number().positive().default(0.5),
  /** Bounce amplitude as a fraction of the frame height. */
  bounceAmount: z.number().min(0).max(0.3).default(0.04),
  /** Seconds per lateral sway cycle. */
  swayPeriod: z.number().positive().default(2.4),
  /** Seconds per arm raise/lower cycle. */
  armPeriod: z.number().positive().default(3.2),
  /** Knee bend depth 0..1 at the bottom of each bounce. */
  kneeBend: z.number().min(0).max(1).default(0.3),
  /** Torso length in pixels. */
  torso: z.number().positive().default(120),
});
type Params = z.infer<typeof Params>;

const osc = (t: number, period: number, phase = 0) => 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + phase);

export const syntheticBodyNode = defineNode<Params>({
  type: 'synthetic-body',
  roles: ['source'],
  title: 'Synthetic Body',
  description: 'Camera-free animated full-body skeleton (bounce / sway / arms) for tests & demos.',
  inputs: [],
  outputs: [
    BODY_SLOT_OUTPUT,
    // Every body candidate reports a status so the overlay edge stays valid across a
    // swap; a synthetic body is always 'ready' and always present.
    { name: 'status', kind: 'body-status' },
  ],
  params: Params,
  process(_inputs, p, ctx) {
    const t = ctx.time;
    // A bounce is a |sin|-shaped dip: sharp at the bottom (the impact), which is
    // what makes the deceleration-peak anchor detector's job well-posed.
    const dip = Math.abs(Math.sin((Math.PI * t) / p.bouncePeriod));
    const cy = 0.62 + p.bounceAmount * dip;
    const sway = (osc(t, p.swayPeriod) - 0.5) * 0.25;
    const { landmarks, world } = makeBodyKeypoints({
      width: p.width,
      height: p.height,
      cx: 0.5 + sway * 0.4,
      cy,
      torso: p.torso,
      leftArm: osc(t, p.armPeriod),
      rightArm: osc(t, p.armPeriod, Math.PI),
      kneeBend: p.kneeBend * dip,
      lean: sway,
    });
    const frame: BodyFrame = {
      width: p.width,
      height: p.height,
      present: true,
      landmarks,
      world,
      visibility: new Array(BODY_LANDMARK_COUNT).fill(1),
    };
    const status: BodyStatus = { phase: 'ready', bodyDetected: true };
    return { body: frame, status };
  },
});
