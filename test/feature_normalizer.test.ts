/**
 * Online normalizer unit tests — the correctness surface behind every meter.
 * Covers the load-bearing #119 corrections: NaN/Inf inputs must never poison the
 * running stats; a degenerate (constant) feature must map to a safe mid-level, not
 * NaN/Infinity; the percentile band must be monotone and bounded; reset re-zeros;
 * and the mode switch is live + lossless.
 */
import { describe, it, expect } from 'vitest';
import { OnlineNormalizer } from '@/features/normalizer';

const DT = 1 / 60;

/** Feed `n` cycles of the ramp 0..10 (a known uniform distribution). */
function feedRamp(nz: OnlineNormalizer, id: string, cycles: number): void {
  for (let i = 0; i < cycles; i++) nz.observe(id, i % 11, DT);
}

describe('OnlineNormalizer — guards', () => {
  it('rejects NaN and Infinity without incrementing the sample count', () => {
    const nz = new OnlineNormalizer();
    nz.observe('f', 1, DT);
    nz.observe('f', NaN, DT);
    nz.observe('f', Infinity, DT);
    nz.observe('f', -Infinity, DT);
    nz.observe('f', 3, DT);
    expect(nz.count('f')).toBe(2); // only the two finite samples
    // A poisoned mean would make level() NaN; assert it is a finite 0..1.
    const lvl = nz.level('f', 2);
    expect(Number.isFinite(lvl)).toBe(true);
    expect(lvl).toBeGreaterThanOrEqual(0);
    expect(lvl).toBeLessThanOrEqual(1);
  });

  it('a constant feature maps to a safe mid-level (no divide-by-zero)', () => {
    const nz = new OnlineNormalizer();
    for (let i = 0; i < 100; i++) nz.observe('const', 7, DT);
    const lvl = nz.level('const', 7);
    expect(Number.isFinite(lvl)).toBe(true);
    expect(lvl).toBeCloseTo(0.5, 5);
  });

  it('unknown / un-warmed features return NaN (the meter draws nothing)', () => {
    const nz = new OnlineNormalizer();
    expect(Number.isNaN(nz.level('never', 1))).toBe(true);
    nz.observe('f', NaN, DT); // rejected → still no samples
    expect(Number.isNaN(nz.level('f', 1))).toBe(true);
  });
});

describe('OnlineNormalizer — minmax mapping', () => {
  it('maps the observed range to [0,1] with the extremes at the ends', () => {
    const nz = new OnlineNormalizer({ mode: 'minmax' });
    feedRamp(nz, 'f', 300);
    expect(nz.level('f', 0)).toBeCloseTo(0, 1);
    expect(nz.level('f', 10)).toBeCloseTo(1, 1);
    expect(nz.level('f', 5)).toBeCloseTo(0.5, 1);
  });

  it('clamps values outside the current envelope to [0,1]', () => {
    const nz = new OnlineNormalizer({ mode: 'minmax' });
    feedRamp(nz, 'f', 300);
    expect(nz.level('f', -100)).toBe(0);
    expect(nz.level('f', 100)).toBe(1);
  });
});

describe('OnlineNormalizer — percentile band', () => {
  it('is empty during warm-up, then monotone non-decreasing and in [0,1]', () => {
    const nz = new OnlineNormalizer();
    nz.observe('f', 1, DT);
    nz.observe('f', 2, DT);
    expect(nz.markers('f')).toEqual([]); // < 5 samples
    feedRamp(nz, 'f', 2000);
    const m = nz.markers('f');
    expect(m.length).toBe(5); // [min, p25, p50, p75, max]
    for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThanOrEqual(m[i - 1] - 1e-9);
    expect(m[0]).toBeGreaterThanOrEqual(0);
    expect(m[m.length - 1]).toBeLessThanOrEqual(1);
    expect(m[0]).toBeCloseTo(0, 2); // envelope min → 0
    expect(m[4]).toBeCloseTo(1, 2); // envelope max → 1
    expect(m[2]).toBeCloseTo(0.5, 1); // median of a uniform 0..10 ramp ≈ 5 → 0.5
  });
});

describe('OnlineNormalizer — zscore mapping', () => {
  it('reads 0.5 at the running mean and is bounded', () => {
    const nz = new OnlineNormalizer({ mode: 'zscore' });
    for (let i = 0; i < 500; i++) nz.observe('f', (i % 21) - 10, DT); // symmetric about 0
    const lvl = nz.level('f', 0);
    expect(lvl).toBeGreaterThan(0.35);
    expect(lvl).toBeLessThan(0.65);
    expect(nz.level('f', 1e6)).toBeLessThanOrEqual(1);
    expect(nz.level('f', -1e6)).toBeGreaterThanOrEqual(0);
  });
});

describe('OnlineNormalizer — drift', () => {
  it('the envelope follows a shifted range (recent extremes win)', () => {
    const nz = new OnlineNormalizer({ mode: 'minmax', envelopeTau: 0.5 });
    for (let i = 0; i < 500; i++) nz.observe('f', i % 11, DT); // range 0..10
    // Now the performer's range shifts up to 100..110 for a long stretch.
    for (let i = 0; i < 3000; i++) nz.observe('f', 100 + (i % 11), DT);
    // A value in the OLD range now reads at/below the bottom of the bar.
    expect(nz.level('f', 5)).toBeLessThan(0.2);
    // A value in the NEW range reads across the bar.
    expect(nz.level('f', 105)).toBeGreaterThan(0.2);
    expect(nz.level('f', 105)).toBeLessThan(0.8);
  });
});

describe('OnlineNormalizer — lifecycle', () => {
  it('reset(id) clears one feature; reset() clears all', () => {
    const nz = new OnlineNormalizer();
    feedRamp(nz, 'a', 50);
    feedRamp(nz, 'b', 50);
    nz.reset('a');
    expect(nz.count('a')).toBe(0);
    expect(nz.count('b')).toBe(50);
    nz.reset();
    expect(nz.count('b')).toBe(0);
  });

  it('setMode switches the mapping live without losing stats', () => {
    const nz = new OnlineNormalizer({ mode: 'minmax' });
    feedRamp(nz, 'f', 300);
    const before = nz.count('f');
    nz.setMode('zscore');
    expect(nz.mode).toBe('zscore');
    expect(nz.count('f')).toBe(before); // stats preserved
    expect(Number.isFinite(nz.level('f', 5))).toBe(true);
  });
});
