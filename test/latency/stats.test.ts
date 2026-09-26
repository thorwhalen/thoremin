import { describe, expect, it } from 'vitest';
import { formatSummary, quantileSorted, RingSamples, summarize } from '@/latency/stats';

describe('latency stats', () => {
  it('summarises mean, jitter and percentiles, dropping non-finite samples', () => {
    const s = summarize([1, 2, 3, 4, 5, NaN, Infinity]);
    expect(s.n).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.sd).toBeCloseTo(Math.sqrt(2));
    expect(s.p50).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.p95).toBeCloseTo(4.8);
  });

  it('reports an empty summary as n 0 and NaN, not zeros', () => {
    const s = summarize([]);
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.mean)).toBe(true);
    expect(formatSummary(s)).toBe('no samples');
  });

  it('interpolates quantiles linearly', () => {
    expect(quantileSorted([0, 10], 0.25)).toBe(2.5);
    expect(Number.isNaN(quantileSorted([], 0.5))).toBe(true);
  });

  it('keeps only the most recent samples in the ring', () => {
    const r = new RingSamples(3);
    [1, 2, 3, 4, 5].forEach((x) => r.push(x));
    expect(r.values().sort()).toEqual([3, 4, 5]);
    expect(r.summary().mean).toBe(4);
    r.clear();
    expect(r.size).toBe(0);
    expect(() => new RingSamples(0)).toThrow(RangeError);
  });
});
