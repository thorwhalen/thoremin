import { describe, expect, it } from 'vitest';
import { createStrikeTrigger } from '@/latency/strike';

const FPS = 30;

/** A hand falling at `speed` heights/s until it hits the table at `hitT`, then resting. */
function fall(hitT: number, speed: number, frames: number): Array<[number, number]> {
  return Array.from({ length: frames }, (_, i) => {
    const t = i / FPS;
    return [t, 0.8 - speed * Math.max(0, hitT - t)];
  });
}

describe('reactive strike trigger', () => {
  it('fires on the first frame after the hand stops, never before the impact', () => {
    const trig = createStrikeTrigger();
    const hitT = 0.31;
    const fired = fall(hitT, 2, 20).filter(([t, y]) => trig.push(t, y)).map(([t]) => t);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(hitT);
    // Confirmation costs at most two frame periods past the impact.
    expect(fired[0] - hitT).toBeLessThanOrEqual(2 / FPS + 1e-9);
  });

  it('ignores slow motion, and a lost hand resets it', () => {
    const slow = createStrikeTrigger();
    expect(fall(0.3, 0.3, 20).some(([t, y]) => slow.push(t, y))).toBe(false);
    const lost = createStrikeTrigger();
    const frames = fall(0.31, 2, 20);
    const hitIdx = frames.findIndex(([t]) => t >= 0.31);
    const fired = frames.some(([t, y], i) => lost.push(t, i === hitIdx - 1 ? undefined : y));
    expect(fired).toBe(false);
  });

  it('respects the refractory period', () => {
    const trig = createStrikeTrigger({ refractory: 1 });
    const a = fall(0.2, 2, 12);
    const b = fall(0.2, 2, 12).map(([t, y]) => [t + 0.4, y] as [number, number]);
    const fired = [...a, ...b].filter(([t, y]) => trig.push(t, y));
    expect(fired).toHaveLength(1);
  });
});
