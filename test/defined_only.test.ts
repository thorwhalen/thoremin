/**
 * An explicit `undefined` keeps the default (#912, #924). `{ ...DEFAULTS, ...options }` let a caller
 * that passed its own optional argument through (`{ beta: undefined }`) override the default with
 * `undefined`, which then reached the arithmetic as NaN. Every defaults spread over caller options
 * now goes through `definedOnly` (in the leaf `@thoremin/stats`, so `ictus` can use it). Pinned here
 * on one consumer per kind of package: the leaf itself, `ictus`, the games, the SDK.
 */
import { describe, it, expect } from 'vitest';
import { createOneEuro, definedOnly } from '@thoremin/stats';
import { definedOnly as sdkDefinedOnly } from '@thoremin/sdk/util/options';
import { createRangeNormalizer } from '@thoremin/ictus';
import { createLoudnessScale } from '@thoremin/games/loudness';

describe('definedOnly', () => {
  it('drops undefined keys, keeps falsy values, and reads an absent object as empty', () => {
    expect(definedOnly({ a: 1, b: undefined, c: 0, d: false, e: null })).toEqual({ a: 1, c: 0, d: false, e: null });
    expect(definedOnly(undefined)).toEqual({});
    expect(sdkDefinedOnly).toBe(definedOnly);
  });
});

describe('an explicit undefined keeps the default', () => {
  const same = <T>(run: (o: Record<string, unknown>) => T, options: Record<string, unknown>) => expect(run(options)).toEqual(run({}));

  it('the one-euro filter (stats)', () => {
    const run = (o: Record<string, unknown>) => {
      const f = createOneEuro(o);
      return [0, 1, 2, 3].map((i) => f.push(i / 30, Math.sin(i)));
    };
    same(run, { minCutoff: undefined, beta: undefined, dCutoff: undefined });
    expect(run({ beta: undefined }).every(Number.isFinite)).toBe(true);
  });

  it('the range normalizer (ictus)', () => {
    const run = (o: Record<string, unknown>) => {
      const n = createRangeNormalizer(o);
      return [0.1, 0.5, 0.9, 0.3, 0.7, 0.2].map((x, i) => n.push(i * 0.5, x));
    };
    same(run, { windowS: undefined, lo: undefined, hi: undefined });
    expect(run({ lo: undefined }).every(Number.isFinite)).toBe(true);
  });

  it('the loudness scale (games)', () => {
    const run = (o: Record<string, unknown>) => {
      const s = createLoudnessScale(o);
      return [0.01, 0.1, 0.3, 0.05, 0.2].map((r, i) => s.push(i * 0.5, r));
    };
    same(run, { windowS: undefined, lo: undefined, hi: undefined });
  });
});
