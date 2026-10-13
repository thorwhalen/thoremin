/**
 * The live feature bars' pure model (#385 E2, `@thoremin/sdk/enroll/bars`): labels from ids,
 * values in noise units from the rest (or a running baseline before it), the online carve of
 * the holds so far (numbered by their first hold), the between/within ratio that ranks the
 * separating features, the sticky choice of shown bars, and the ticks at each category.
 */
import { describe, expect, it } from 'vitest';
import { createLiveBars, featureWords, liveCarve, noiseUnit, pickBars, separationRatios, type LiveBarsContext } from '@thoremin/sdk/enroll/bars';
import type { FeatureVector } from '@thoremin/sdk/enroll';

const one = () => 1;

describe('feature words and units', () => {
  it('drops the source and the namespace, and splits camel case', () => {
    expect(featureWords('face.blendshape.mouth.smileLeft')).toBe('mouth smile left');
    expect(featureWords('face.head.yaw')).toBe('head yaw');
    expect(featureWords('face.geom.jaw.lateralShift')).toBe('jaw lateral shift');
    expect(featureWords('x')).toBe('x');
  });

  it('a value in noise units needs both values and a known unit', () => {
    expect(noiseUnit(3, 1, 0.5)).toBe(4);
    expect(noiseUnit(undefined, 1, 1)).toBeNull();
    expect(noiseUnit(1, Number.NaN, 1)).toBeNull();
    expect(noiseUnit(1, 0, Number.NaN)).toBeNull();
    expect(noiseUnit(1, 0, 0)).toBeNull();
  });
});

describe('the online carve and the separation ratio', () => {
  // Two faces, a and b, each held three times; `noise` barely moves.
  const holds: FeatureVector[] = [
    { a: 10, b: 0, noise: 0.1 },
    { a: 0, b: 10, noise: 0.2 },
    { a: 10.2, b: 0.1, noise: 0 },
    { a: 0.1, b: 9.8, noise: 0.1 },
    { a: 9.9, b: 0, noise: 0.2 },
    { a: 0, b: 10.1, noise: 0 },
  ];
  const ids = ['a', 'b', 'noise'];

  it('carves the holds and numbers the categories by their first hold', () => {
    expect(liveCarve(holds, ids, one)).toEqual([
      [0, 2, 4],
      [1, 3, 5],
    ]);
    expect(liveCarve([], ids, one)).toEqual([]);
    expect(liveCarve([holds[0]], ids, one)).toEqual([[0]]);
  });

  it('ranks the features that separate the categories, the within spread floored at one unit', () => {
    const r = separationRatios(holds, liveCarve(holds, ids, one), ids, one);
    expect(r.a).toBeGreaterThan(50);
    expect(r.b).toBeGreaterThan(50);
    expect(r.noise).toBeLessThan(1);
    // One category: nothing separates anything.
    expect(separationRatios(holds, [[0, 1, 2, 3, 4, 5]], ids, one).a).toBe(0);
    // A feature with no unit scores nothing.
    expect(separationRatios(holds, liveCarve(holds, ids, one), ids, (id) => (id === 'a' ? Number.NaN : 1)).a).toBe(0);
  });
});

describe('the shown bars are sticky', () => {
  it('fills from the best, keeps what is shown, and swaps only for a clearly better feature', () => {
    expect(pickBars({ a: 5, b: 4, c: 3 }, [], { count: 2 })).toEqual(['a', 'b']);
    // c is now best, but not 1.5 times b: the shown pair stays.
    expect(pickBars({ a: 5, b: 4, c: 5.5 }, ['a', 'b'], { count: 2 })).toEqual(['a', 'b']);
    // c is far better than the weakest shown: it takes b's place.
    expect(pickBars({ a: 5, b: 4, c: 9 }, ['a', 'b'], { count: 2 })).toEqual(['a', 'c']);
    // Pinned first, always.
    expect(pickBars({ a: 5, b: 4, c: 0 }, [], { count: 2, pinned: ['c'] })).toEqual(['c', 'a']);
  });
});

describe('the live bars model', () => {
  it('measures from a running baseline, then from the rest, with the rest band and the category ticks', () => {
    const ctx: LiveBarsContext = { ids: ['a', 'b'], sigma: () => 0.5, rest: null, restSpread: null, holds: [] };
    const bars = createLiveBars(() => ctx, { recentMs: 1000, baselineMs: 1000 });
    for (let t = 0; t <= 3000; t += 33) bars.push({ a: 0, b: 0 }, t);
    // a moves: it is ranked first by recent movement, measured from the baseline.
    for (let t = 3033; t <= 3300; t += 33) bars.push({ a: 2, b: 0 }, t);
    let s = bars.snapshot({ count: 1 });
    expect(s.reference).toBe('running');
    expect(s.ranking).toBe('movement');
    expect(s.bars.map((b) => b.id)).toEqual(['a']);
    expect(s.bars[0].value).toBeGreaterThan(0);
    expect(s.bars[0].band).toBeNull();

    // A rest, and two categories that differ in b only.
    ctx.rest = { a: 0, b: 0 };
    ctx.restSpread = { a: 0.25, b: 0.25 };
    ctx.holds = [{ a: 1, b: 5 }, { a: 1, b: -5 }, { a: 1, b: 5.1 }];
    bars.push({ a: 1, b: 5 }, 3400);
    s = bars.snapshot({ count: 1 });
    expect(s.reference).toBe('rest');
    expect(s.ranking).toBe('separation');
    expect(s.categories).toBe(2);
    expect(s.bars.map((b) => b.id)).toEqual(['b']);
    const [bar] = s.bars;
    expect(bar.value).toBeCloseTo(10);
    expect(bar.band).toBeCloseTo(0.5);
    expect(bar.ticks[0]).toBeCloseTo(10.1);
    expect(bar.ticks[1]).toBeCloseTo(-10);
    // Nothing in view: the bar stays, with no value.
    bars.push(null, 3500);
    expect(bars.snapshot({ count: 1 }).bars[0].value).toBeNull();
  });
});
