/**
 * Tests the one-euro filter: passes the first sample through, holds a constant,
 * reduces jitter (variance) while still tracking a step change, and is
 * deterministic given the tick timing.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@/dag';
import { oneEuroNode } from '@/nodes';

const variance = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
};

const run = (values: number[], dt = 1 / 60) =>
  replayNode(oneEuroNode.make(oneEuroNode.params.parse({})), { value: values }, { dt }).then((o) =>
    o.map((r) => r.value as number),
  );

describe('one-euro filter', () => {
  it('passes the first sample through and holds a constant', async () => {
    const out = await run(Array(20).fill(0.7));
    expect(out[0]).toBe(0.7);
    expect(out.every((v) => Math.abs(v - 0.7) < 1e-9)).toBe(true);
  });

  it('reduces jitter: output variance << input variance', async () => {
    const noisy = Array.from({ length: 80 }, (_, i) => 0.5 + (i % 2 === 0 ? 0.12 : -0.12)); // ±0.12 chatter
    const out = await run(noisy);
    // ignore the warm-up; compare steady-state variance
    expect(variance(out.slice(20))).toBeLessThan(variance(noisy.slice(20)) * 0.25);
    // still centered around the mean
    expect(Math.abs(out[60] - 0.5)).toBeLessThan(0.1);
  });

  it('still tracks a step change (responsive, not stuck)', async () => {
    const step = [...Array(30).fill(0), ...Array(90).fill(1)];
    const out = await run(step);
    expect(out[20]).toBeLessThan(0.1); // settled low before the step
    expect(out[out.length - 1]).toBeGreaterThan(0.9); // reached the new level
    // a higher beta tracks faster than a lower one
    const slow = (await replayNode(oneEuroNode.make(oneEuroNode.params.parse({ beta: 0 })), { value: step })).map((r) => r.value as number);
    const fast = (await replayNode(oneEuroNode.make(oneEuroNode.params.parse({ beta: 2 })), { value: step })).map((r) => r.value as number);
    expect(fast[45]).toBeGreaterThan(slow[45]);
  });

  it('is deterministic', async () => {
    const sig = Array.from({ length: 40 }, (_, i) => Math.sin(i / 5) + (i % 3 ? 0.05 : -0.05));
    expect(await run(sig)).toEqual(await run(sig));
  });
});
