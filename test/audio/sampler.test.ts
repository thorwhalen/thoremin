/** The audio thread's one-shot voices: started at an exact sample, corrected without a click. */
import { describe, expect, it } from 'vitest';
import { createSampler } from '@thoremin/sdk/audio/sampler';

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i + 1);

describe('sampler', () => {
  it('starts a sample at the exact offset and carries it across blocks', () => {
    const s = createSampler();
    s.setSample('a', ramp(200));
    expect(s.trigger('a', 1, 100)).toBeGreaterThanOrEqual(0);
    const b1 = new Float32Array(128);
    s.render(b1);
    expect(b1[99]).toBe(0);
    expect(b1[100]).toBe(1);
    expect(b1[127]).toBe(28);
    const b2 = new Float32Array(128);
    s.render(b2);
    expect(b2[0]).toBe(29);
    expect(b2[127]).toBe(156);
    const b3 = new Float32Array(128);
    s.render(b3);
    expect(b3[43]).toBe(200);
    expect(b3[44]).toBe(0); // ended at its 200th sample
    expect(s.active()).toBe(0);
  });

  it('adds into the output and refuses an unknown id', () => {
    const s = createSampler();
    s.setSample('a', ramp(4));
    expect(s.trigger('nope', 1, 0)).toBe(-1);
    s.trigger('a', 0.5, 0);
    const out = new Float32Array(4).fill(10);
    s.render(out);
    expect([...out]).toEqual([10.5, 11, 11.5, 12]);
  });

  it('starts part-way in with a fade-in, and releases with a fade-out from an offset', () => {
    const s = createSampler();
    s.setSample('a', new Float32Array(1000).fill(1));
    const h = s.trigger('a', 1, 0, { startAt: 990, fadeIn: 3 });
    const out = new Float32Array(16);
    s.render(out);
    expect([...out.slice(0, 4)].map((x) => +x.toFixed(2))).toEqual([0.25, 0.5, 0.75, 1]);
    expect(out[9]).toBe(1);
    expect(out[10]).toBe(0); // 10 samples left from 990
    const h2 = s.trigger('a', 1, 0);
    s.release(h2, 4, 4);
    s.release(h, 0, 1); // stale handle: ignored
    const o2 = new Float32Array(16);
    s.render(o2);
    expect([...o2.slice(0, 9)]).toEqual([1, 1, 1, 1, 1, 0.75, 0.5, 0.25, 0]);
  });

  it('steals the oldest voice when the pool is full', () => {
    const s = createSampler({ maxVoices: 2 });
    s.setSample('a', new Float32Array(100).fill(1));
    s.trigger('a', 1, 0);
    s.trigger('a', 1, 0);
    s.trigger('a', 1, 0);
    expect(s.active()).toBe(2);
  });
});
