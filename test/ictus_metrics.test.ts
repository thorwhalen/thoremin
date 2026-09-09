/**
 * The beat-tracking metrics port (src/ictus/metrics.ts): the mir_eval conventions on
 * hand-computable cases, and `fitGrid` recovering the phase of a stated-tempo grid.
 */
import { describe, it, expect } from 'vitest';
import { fMeasure, cemgil, continuity, fitGrid, medianInterval } from '@/ictus';

const grid = (n: number, period: number, offset = 0) => Array.from({ length: n }, (_, i) => offset + i * period);

describe('beat metrics', () => {
  it('F-measure is 1 on identical sequences and 0 when nothing is within the window', () => {
    const ref = grid(10, 0.5);
    expect(fMeasure(ref, ref)).toBe(1);
    expect(fMeasure(ref, ref.map((t) => t + 0.25))).toBe(0);
  });

  it('F-measure counts each reference at most once (a doubled estimate costs precision)', () => {
    const ref = grid(10, 0.5);
    const est = ref.flatMap((t) => [t, t + 0.01]);
    // precision 0.5, recall 1 → F = 2/3
    expect(fMeasure(ref, est)).toBeCloseTo(2 / 3, 5);
  });

  it('F-measure with a missed beat: recall drops', () => {
    const ref = grid(10, 0.5);
    const est = ref.filter((_, i) => i !== 4);
    // precision 1, recall 0.9
    expect(fMeasure(ref, est)).toBeCloseTo((2 * 0.9) / 1.9, 5);
  });

  it('Cemgil accuracy decays with a Gaussian of the offset', () => {
    const ref = grid(10, 0.5);
    expect(cemgil(ref, ref)).toBeCloseTo(1, 5);
    const shifted = ref.map((t) => t + 0.04); // one sigma
    expect(cemgil(ref, shifted)).toBeCloseTo(Math.exp(-0.5), 3);
  });

  it('continuity (CMLt) needs both phase and period to agree', () => {
    const ref = grid(10, 0.5);
    expect(continuity(ref, ref)).toBe(1);
    // Right phase, wrong period (every other beat): the interval test fails.
    expect(continuity(ref, ref.filter((_, i) => i % 2 === 0))).toBe(0);
    // A constant offset beyond the phase tolerance fails too.
    expect(continuity(ref, ref.map((t) => t + 0.2))).toBe(0);
  });

  it('fitGrid recovers the phase of a stated-tempo grid from noisy detections', () => {
    const period = 60 / 70;
    const truePhase = 0.31;
    const est = grid(12, period, truePhase).map((t, i) => t + (i % 2 ? 0.015 : -0.01));
    const fit = fitGrid(est, 70, 0, 12 * period);
    expect(fit.fMeasure).toBeGreaterThan(0.95);
    // The chosen offset is within one search step (period/64 ≈ 13 ms) plus the jitter.
    expect(Math.abs(fit.offset - truePhase)).toBeLessThan(0.03);
  });

  it('medianInterval is robust to one outlier', () => {
    expect(medianInterval([0, 0.5, 1, 1.5, 2, 3.7])).toBeCloseTo(0.5, 5);
    expect(Number.isNaN(medianInterval([1]))).toBe(true);
  });
});
