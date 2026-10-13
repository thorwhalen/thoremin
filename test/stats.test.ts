/**
 * `@thoremin/stats` (#392): every index rule on a small window, where the rules disagree by
 * a whole sample (the reason the rule is an option), the medians, the line and the EW step.
 */
import { describe, it, expect } from 'vitest';
import { quantileSorted, quantile, median, median3, olsLine, ewUpdate, clamp01 } from '@thoremin/stats';

describe('quantileSorted', () => {
  const s = [10, 20, 30, 40, 50];

  it('states its index rule: each picks a different sample on a small window', () => {
    // pos = 0.3 * 4 = 1.2; q n = 1.5.
    expect(quantileSorted(s, 0.3)).toBeCloseTo(22, 12);
    expect(quantileSorted(s, 0.3, { index: 'interpolate' })).toBeCloseTo(22, 12);
    expect(quantileSorted(s, 0.3, { index: 'floor' })).toBe(20);
    expect(quantileSorted(s, 0.3, { index: 'round' })).toBe(20);
    expect(quantileSorted(s, 0.3, { index: 'ceil' })).toBe(30);
    expect(quantileSorted(s, 0.3, { index: 'nearestRank' })).toBe(20);
    expect(quantileSorted(s, 0.9, { index: 'nearestRank' })).toBe(50);
    expect(quantileSorted(s, 0.6, { index: 'round' })).toBe(30);
  });

  it('clamps q and the index, and is NaN when empty', () => {
    for (const index of ['interpolate', 'floor', 'round', 'ceil', 'nearestRank'] as const) {
      expect(quantileSorted(s, -1, { index })).toBe(10);
      expect(quantileSorted(s, 2, { index })).toBe(50);
      expect(quantileSorted(s, 0, { index })).toBe(10);
      expect(quantileSorted(s, 1, { index })).toBe(50);
      expect(Number.isNaN(quantileSorted([], 0.5, { index }))).toBe(true);
    }
  });

  it('quantile sorts a copy and leaves the input alone', () => {
    const xs = [50, 10, 40, 20, 30];
    expect(quantile(xs, 0.3, { index: 'floor' })).toBe(20);
    expect(xs).toEqual([50, 10, 40, 20, 30]);
  });
});

describe('median', () => {
  it('takes the stated middle of an even sample', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([4, 1, 3, 2], { even: 'upper' })).toBe(3);
    expect(median([4, 1, 3, 2], { even: 'lower' })).toBe(2);
    expect(median([3, 1, 2], { even: 'upper' })).toBe(2);
    expect(Number.isNaN(median([]))).toBe(true);
  });

  it('median3 is the middle of three', () => {
    expect(median3(1, 2, 3)).toBe(2);
    expect(median3(3, 1, 2)).toBe(2);
    expect(median3(2, 3, 1)).toBe(2);
    expect(median3(5, 5, 1)).toBe(5);
  });
});

describe('olsLine', () => {
  it('fits a line, from an origin', () => {
    const xs = [10, 11, 12, 13];
    const ys = xs.map((x) => 3 + 2 * (x - 10));
    const f = olsLine(xs, ys, { origin: 10 });
    expect(f).not.toBeNull();
    expect(f!.intercept).toBeCloseTo(3, 12);
    expect(f!.slope).toBeCloseTo(2, 12);
    expect(f!.rss).toBeCloseTo(0, 12);
    expect(f!.sxx).toBeCloseTo(5, 12);
    expect(f!.n).toBe(4);
  });

  it('keeps precision on stamps near a million milliseconds', () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const ys = xs.map((x) => 1_234_567.25 + 33.3 * x + (x % 2 ? 0.5 : -0.5));
    const f = olsLine(xs, ys)!;
    expect(f.slope).toBeCloseTo(33.3 + 3 / 35, 9);
  });

  it('is null when degenerate', () => {
    expect(olsLine([1], [1])).toBeNull();
    expect(olsLine([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(olsLine([1, 2], [1])).toBeNull();
    // A spread whose square overflows is no fit, not a NaN or zero slope.
    expect(olsLine([1e200, 2e200, 3e200], [1, 2, 3])).toBeNull();
  });
});

describe('ewUpdate and clamp01', () => {
  it('seeds from NaN, then steps by the gain', () => {
    expect(ewUpdate(NaN, 4, 0.25)).toBe(4);
    expect(ewUpdate(4, 8, 0.25)).toBe(5);
  });

  it('clamps into [0, 1] and keeps NaN', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(3)).toBe(1);
    expect(Number.isNaN(clamp01(NaN))).toBe(true);
  });
});
