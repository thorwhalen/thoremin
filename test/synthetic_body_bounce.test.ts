/**
 * The synthetic body's bounce is sharp at the BOTTOM (#417): a bounce lands, then rises
 * smoothly, which is what a "bottom of the bounce" detector (#374) looks for. Image y grows
 * downward, so the bottom is the hips' largest y: there the path must turn sharply (a cusp,
 * the slope flipping sign at full speed), and at the top it must turn smoothly (the slope
 * passing through zero).
 */
import { describe, expect, it } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { BLM } from '@thoremin/sdk/nodes/domain';
import { syntheticBodyNode } from '@/nodes/sources/synthetic_body';

const P = 0.5;
const node = syntheticBodyNode.make(syntheticBodyNode.params.parse({ bouncePeriod: P, swayPeriod: 1e6, armPeriod: 1e6 }));
/** The hips' height in image pixels at time t (y grows downward). */
const hipY = (t: number): number => {
  const out = node.process({}, { tick: 0, time: t, dt: 0, resources: {} } as unknown as NodeContext) as {
    body: { landmarks: { y: number }[] };
  };
  return out.body.landmarks[BLM.left_hip].y;
};

describe('synthetic-body bounce (#417)', () => {
  it('is lowest at the cusp (whole periods) and highest half a period later', () => {
    const ys = Array.from({ length: 200 }, (_, i) => hipY(1 + (i / 200) * P));
    const bottom = ys.indexOf(Math.max(...ys));
    const top = ys.indexOf(Math.min(...ys));
    expect(Math.min(bottom, 200 - bottom)).toBeLessThanOrEqual(1); // at a whole period
    expect(Math.abs(top - 100)).toBeLessThanOrEqual(1); // half a period later
  });

  it('turns sharply at the bottom and smoothly at the top', () => {
    const h = 1e-3;
    const slope = (t: number) => (hipY(t + h) - hipY(t)) / h;
    const bottomT = 2 * P;
    const topT = 2 * P + P / 2;
    // At the bottom the slope jumps from going down (y growing) to coming up, at speed.
    const before = slope(bottomT - 2 * h);
    const after = slope(bottomT + h);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(0);
    // At the top it passes through zero: both sides are slow beside the bottom's speed.
    const speedAtTop = Math.max(Math.abs(slope(topT - 2 * h)), Math.abs(slope(topT + h)));
    expect(speedAtTop).toBeLessThan(0.05 * Math.min(Math.abs(before), Math.abs(after)));
  });
});
