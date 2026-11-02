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
import { createPulseFollower, createRangeNormalizer } from '@thoremin/ictus';
import { createOnsetDetector } from '@thoremin/sdk/audio/onset';
import { createLoudnessScale } from '@thoremin/games/loudness';

describe('definedOnly', () => {
  it('drops undefined keys, keeps falsy values, and reads an absent object as empty', () => {
    expect(definedOnly({ a: 1, b: undefined, c: 0, d: false, e: null })).toEqual({ a: 1, c: 0, d: false, e: null });
    expect(definedOnly(undefined)).toEqual({});
    expect(sdkDefinedOnly).toBe(definedOnly);
  });

  it('returns its argument untouched when nothing is undefined, so a per-hop call allocates nothing', () => {
    const o = { a: 1, b: 2 };
    expect(definedOnly(o)).toBe(o);
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

  it('the loudness scale (games), past its warm-up so lo, hi and the window are read', () => {
    const run = (o: Record<string, unknown>) => {
      const s = createLoudnessScale(o);
      return Array.from({ length: 60 }, (_, i) => s.push(i * 0.1, 0.02 + 0.3 * Math.abs(Math.sin(i / 4))));
    };
    same(run, { windowS: undefined, lo: undefined, hi: undefined, warmupS: undefined });
    expect(run({ lo: undefined, hi: undefined }).every(Number.isFinite)).toBe(true);
  });

  it('the pulse follower (ictus, a rest spread): an undefined period bound no longer throws', () => {
    expect(() => createPulseFollower({ maxPeriodS: undefined, minPeriodS: undefined })).not.toThrow();
  });

  it('the onset detector (SDK audio)', () => {
    const run = (o: Record<string, unknown>) => {
      const d = createOnsetDetector({ sampleRate: 48000, ...o } as never);
      const onsets: number[] = [];
      const buf = new Float32Array(4800);
      for (let i = 2400; i < 2600; i++) buf[i] = Math.sin(i) * 0.8;
      d.push(buf, 0, (x) => onsets.push(x.frame));
      return onsets;
    };
    same(run, { hop: undefined, thresholdRatio: undefined, refractoryMs: undefined });
    expect(run({ hop: undefined }).length).toBeGreaterThan(0);
  });
});
