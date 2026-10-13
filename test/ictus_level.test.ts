/**
 * ictus's one level relation (#376, body-movement A4): `relateLevel` (the instantaneous
 * ratio) and `createLevelHold` (held over time: persistence, stickiness, a first relation
 * followed at once or only once it persists). The pace controller, the beat servo and the
 * conductor's `markLevel` all read it; their own tests are the end-to-end ones.
 */
import { describe, expect, it } from 'vitest';
import { conductorRatios, createLevelHold, inCapture, paceRatios, relateLevel } from '@thoremin/ictus';

const P = 0.5;

describe('relateLevel', () => {
  it('the ratio whose rate is nearest the base, and that rate', () => {
    expect(relateLevel(2 * P, P, { ratios: conductorRatios() })).toEqual({ ratio: 2, rate: 1 });
    expect(relateLevel(P / 2, P, { ratios: conductorRatios() })).toEqual({ ratio: 0.5, rate: 1 });
    expect(relateLevel(4 * P, P, { ratios: conductorRatios(4) })).toEqual({ ratio: 4, rate: 1 });
    // Without the bar in the set, four beats a stroke is two at half the tempo.
    expect(relateLevel(4 * P, P, { ratios: conductorRatios() })).toEqual({ ratio: 2, rate: 0.5 });
    expect(relateLevel(6 * P, P, { ratios: paceRatios(8) })?.ratio).toBe(6);
  });

  it('none outside the capture, none for a period that is not a positive number', () => {
    expect(relateLevel(1.3 * P, P, { ratios: [1], captureRange: 0.2 })).toBeNull();
    expect(relateLevel(1.3 * P, P, { ratios: [1], captureRange: 0.4 })).not.toBeNull();
    expect(relateLevel(1.3 * P, P, { ratios: [1] })).not.toBeNull();
    for (const bad of [NaN, 0, -1, Infinity]) expect(relateLevel(bad, P, { ratios: [1] })).toBeNull();
  });

  it('a base moves what "nearest" means', () => {
    expect(relateLevel(4 * P, P, { ratios: paceRatios(8), base: 0.8 })?.ratio).toBe(3);
  });

  it('the conductor ratio set: the beat first, the bar only when it adds one', () => {
    expect(conductorRatios()).toEqual([1, 0.5, 2]);
    expect(conductorRatios(2)).toEqual([1, 0.5, 2]);
    expect(conductorRatios(3)).toEqual([1, 0.5, 2, 3]);
    expect(inCapture(1.45, 1, 0.5)).toBe(true);
    expect(inCapture(0.65, 1, 0.5)).toBe(false);
  });
});

describe('createLevelHold', () => {
  it('a first relation is followed only once it has persisted, then held while nothing relates', () => {
    const h = createLevelHold({ ratios: conductorRatios(), persistS: 3 });
    expect(h.step(0, NaN, P).mode).toBe('waiting');
    expect(h.step(1, 2 * P, P)).toMatchObject({ mode: 'locking', ratio: null, match: { ratio: 2 } });
    expect(h.step(3.9, 2 * P, P).mode).toBe('locking');
    expect(h.step(4, 2 * P, P)).toMatchObject({ mode: 'following', ratio: 2, adopted: true });
    expect(h.step(5, 2 * P, P)).toMatchObject({ mode: 'following', adopted: false });
    expect(h.step(6, NaN, P)).toMatchObject({ mode: 'holding', ratio: 2, match: null });
  });

  it('a change persists too, and an interrupted one starts over', () => {
    const h = createLevelHold({ ratios: conductorRatios(), persistS: 3, persistFirst: false });
    expect(h.step(0, P, P)).toMatchObject({ mode: 'following', ratio: 1, adopted: true });
    expect(h.step(1, 2 * P, P)).toMatchObject({ mode: 'switching', ratio: 1 });
    h.step(2, P, P);
    expect(h.step(3, 2 * P, P).mode).toBe('switching');
    expect(h.step(5.9, 2 * P, P).mode).toBe('switching');
    expect(h.step(6, 2 * P, P)).toMatchObject({ mode: 'following', ratio: 2, adopted: true });
  });

  it('sticky: the followed ratio is kept while it is still in capture, even when another is nearer', () => {
    const h = createLevelHold({ ratios: conductorRatios(), captureRange: 0.5, persistS: 0, persistFirst: false, sticky: true });
    h.step(0, P, P);
    // 70 % of the tempo: 2 is nearer (rate 1.4) but 1 (rate 0.7) is still in capture.
    expect(h.step(1, P / 0.7, P)).toMatchObject({ mode: 'following', ratio: 1, match: { ratio: 1 } });
    // Half the tempo: 1 is out of capture, 2 takes over.
    expect(h.step(2, 2 * P, P)).toMatchObject({ ratio: 2, adopted: true });
  });

  it('prefer: while nothing is followed, the preferred ratio relates whenever it is in capture', () => {
    const h = createLevelHold({ ratios: conductorRatios(), captureRange: 0.5, persistFirst: false, sticky: true, prefer: 1 });
    // 70 % of the tempo from the start: 2 is nearer, 1 is in capture, 1 is chosen.
    expect(h.step(0, P / 0.7, P)).toMatchObject({ ratio: 1, adopted: true });
    // Out of capture for 1 from the start: the nearest.
    const g = createLevelHold({ ratios: conductorRatios(), captureRange: 0.5, persistFirst: false, sticky: true, prefer: 1 });
    expect(g.step(0, 2 * P, P)).toMatchObject({ ratio: 2, adopted: true });
  });

  it('set states a ratio at once; reset forgets it', () => {
    const h = createLevelHold({ ratios: conductorRatios(4) });
    h.set(4);
    expect(h.ratio()).toBe(4);
    expect(h.step(0, NaN, P).mode).toBe('holding');
    h.reset();
    expect(h.ratio()).toBeNull();
  });
});
