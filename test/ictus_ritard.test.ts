/**
 * The KTH final-ritard curve (#333; Friberg and Sundberg's stopping runner): a pure function of how far
 * through the ritard the music is. Pinned: it starts at the tempo it is given and ends at the stated
 * ratio of it, the stopping case (q = 2, the final ratio near 0) is a square root of the distance left,
 * it never speeds up, and the ritard has no opinion before it begins.
 */
import { describe, expect, it } from 'vitest';
import { KTH_RITARD_DEFAULTS, createFinalRitard, kthTempoRatio } from '@thoremin/ictus/ritard';

describe('kthTempoRatio', () => {
  it('goes from 1 to the final ratio', () => {
    expect(kthTempoRatio(0)).toBeCloseTo(1, 12);
    expect(kthTempoRatio(1)).toBeCloseTo(KTH_RITARD_DEFAULTS.finalRatio, 12);
    expect(kthTempoRatio(1, { finalRatio: 0.6 })).toBeCloseTo(0.6, 12);
  });
  it('for the stopping runner (q = 2, a stop) the tempo is the square root of the distance left', () => {
    for (const x of [0, 0.2, 0.5, 0.75, 0.9]) expect(kthTempoRatio(x, { q: 2, finalRatio: 0.001 })).toBeCloseTo(Math.sqrt(1 - x * (1 - 1e-6)), 3);
  });
  it('only slows down, and clamps x to 0..1', () => {
    let last = Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = kthTempoRatio(i / 20);
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      last = v;
    }
    expect(kthTempoRatio(-3)).toBeCloseTo(1, 12);
    expect(kthTempoRatio(9)).toBeCloseTo(KTH_RITARD_DEFAULTS.finalRatio, 12);
  });
});

describe('createFinalRitard', () => {
  const r = createFinalRitard({ beats: 8, finalRatio: 0.4 });
  it('has no opinion before the last `beats` beats', () => {
    expect(r.tempoAt(10, 20, 100)).toBeNull();
    expect(r.progress(11.9, 20)).toBeNull();
  });
  it('slows from the given tempo to the final ratio of it at the end', () => {
    expect(r.tempoAt(12, 20, 100)).toBeCloseTo(100, 6);
    expect(r.tempoAt(20, 20, 100)).toBeCloseTo(40, 6);
    expect(r.tempoAt(16, 20, 100)!).toBeGreaterThan(40);
    expect(r.tempoAt(16, 20, 100)!).toBeLessThan(100);
    expect(r.progress(16, 20)).toBe(0.5);
  });
  it('holds at the end past it, and says nothing without a tempo or an end', () => {
    expect(r.tempoAt(25, 20, 100)).toBeCloseTo(40, 6);
    expect(r.tempoAt(16, 20, 0)).toBeNull();
    expect(r.tempoAt(16, Number.NaN, 100)).toBeNull();
  });
});
