/**
 * The Feature Lab's rolling correlation (#150) and the exponentially-weighted moments
 * (`src/features/ewMoments.ts`) it shares with #131's `residual`/`deconfound` helpers.
 *
 * Two things are pinned here:
 *
 *  1. **The extraction is behaviour-preserving.** `makeEwRegression` inside `formula.ts`
 *     was rewritten to consume `makeEwPair`; its guards (a non-finite x, z or window
 *     returns without touching state) and its seeding rule must survive verbatim, because
 *     a single NaN folded into an EW accumulator poisons it for the rest of the session.
 *  2. **The cost guards are real.** The matrix is O(k^2) per computed frame over a
 *     catalog of ~200 features, so a cap that does not cap, or a stride that does not
 *     skip, is not a missing nicety — it is a dropped-frame bug in an instrument.
 *
 * Pure + headless: no canvas, no camera.
 */
import { describe, it, expect } from 'vitest';
import { makeEwPair } from '@/features/ewMoments';
import { makeCorrelationMatrix, pairIndex, DEFAULT_CORRELATION_WINDOW } from '@/features/labCorrelation';
import { compileFormula } from '@/features/formula';
import type { FeatureVector } from '@/features/catalog';

describe('makeEwPair — the shared moments', () => {
  it('reports the three outcomes distinctly', () => {
    const p = makeEwPair();
    expect(p.isSeeded()).toBe(false);
    expect(p.update(NaN, 1, 10)).toBe('rejected');
    expect(p.isSeeded()).toBe(false); // a rejected update did not seed it either
    expect(p.update(1, 1, 10)).toBe('seeded');
    expect(p.update(2, 2, 10)).toBe('updated');
  });

  it('REJECTS a non-finite x, z, or window and leaves the state untouched', () => {
    const p = makeEwPair();
    for (let i = 0; i < 60; i++) p.update(i % 7, i % 7, 20); // perfectly correlated
    const before = { beta: p.beta(), corr: p.corr(), meanZ: p.meanZ() };
    // Each of the three guards, including `window` — a formula may pass one that is
    // absent this frame, and Infinity is a silent never-learn.
    expect(p.update(NaN, 1, 20)).toBe('rejected');
    expect(p.update(1, Infinity, 20)).toBe('rejected');
    expect(p.update(1, 1, NaN)).toBe('rejected');
    expect(p.update(1, 1, Infinity)).toBe('rejected');
    expect({ beta: p.beta(), corr: p.corr(), meanZ: p.meanZ() }).toEqual(before);
  });

  it('recovers r = +1 for an identical pair and -1 for a negated one', () => {
    const same = makeEwPair();
    const opp = makeEwPair();
    for (let i = 0; i < 400; i++) {
      const x = Math.sin(i / 5);
      same.update(x, x, 60);
      opp.update(x, -x, 60);
    }
    expect(same.corr()).toBeCloseTo(1, 3);
    expect(opp.corr()).toBeCloseTo(-1, 3);
  });

  it('beta() is 0 before any second moment exists — what the seeding return relies on', () => {
    // `makeEwRegression` returns plain x on the seeding sample. That early return is
    // currently REDUNDANT (mutation-tested: removing it changes nothing), because a
    // one-sample estimator has vz = 0 and `beta()` therefore returns 0, making
    // `x - beta*(z - mz)` equal x anyway. It is kept because it states the intent at the
    // call site instead of depending on this coincidence — so pin the coincidence, and
    // the day `beta()`'s zero-variance rule changes, the early return starts mattering
    // and is already covered.
    const p = makeEwPair();
    expect(p.beta()).toBe(0);
    p.update(3, 7, 20);
    expect(p.beta()).toBe(0);
    expect(p.meanZ()).toBe(7);
  });

  it('returns 0, never NaN, while a signal is constant', () => {
    const p = makeEwPair();
    for (let i = 0; i < 50; i++) p.update(Math.sin(i), 0.5, 30); // z never moves
    expect(p.corr()).toBe(0);
    expect(p.beta()).toBe(0);
  });

  it('clamps |r| to 1 — the EW recurrence really does overshoot by a rounding epsilon', () => {
    // Not a hypothetical. A perfectly-correlated pair whose two signals differ by ~17
    // orders of magnitude makes `cxz / sqrt(vx*vz)` reach 1.0000000000000027 — the
    // covariance and the two variances accumulate through different roundings, so the
    // ratio is not forced to 1 by the arithmetic. An |r| just over 1 is a NaN waiting for
    // anything that takes its arccos, and a colour ramp that walks off its own domain.
    //
    // (This exact case was found by search, after a mutation test showed the previous,
    // gentler input could not tell the clamp from its absence.)
    const p = makeEwPair();
    let peak = 0;
    for (let i = 0; i < 5000; i++) {
      const v = Math.sin(i / 3) * 1e8;
      p.update(v, v * 1e-9, 180);
      peak = Math.max(peak, Math.abs(p.corr()));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeCloseTo(1, 10); // it really is riding the boundary, not far from it
  });

  it('reset() forgets everything, including the seeding', () => {
    const p = makeEwPair();
    for (let i = 0; i < 50; i++) p.update(i, i, 20);
    p.reset();
    expect(p.isSeeded()).toBe(false);
    expect(p.corr()).toBe(0);
    expect(p.meanZ()).toBe(0);
  });
});

describe('the residual helper still behaves exactly as before the extraction (#131)', () => {
  const VARS = new Set(['x', 'z']);
  const residual = (formula: string) => compileFormula(formula, { variables: VARS });

  it('returns plain x on the first sample (beta is 0 with one observation)', () => {
    const f = residual('residual(x, z)');
    expect(f.eval({ x: 3, z: 7 })).toBe(3);
  });

  /** Warm a `residual(x, z, 120)` on x = 5 + 2z, with z varying much FASTER than the
   *  window (period ~19 frames), so beta converges — the same setup, and the same
   *  reasoning, as the pre-existing #131 test in feature_formula.test.ts. */
  function warmed(): ReturnType<typeof compileFormula> {
    const f = residual('residual(x, z, 120)');
    for (let i = 0; i < 600; i++) {
      const z = Math.sin(i / 3);
      f.eval({ x: 5 + 2 * z, z });
    }
    return f;
  }

  it('regresses z out of x once warmed up', () => {
    // x is exactly 2*z plus a constant: the residual must converge on the constant.
    expect(warmed().eval({ x: 5 + 2 * 0.3, z: 0.3 })).toBeCloseTo(5, 1);
  });

  it('a non-finite input returns NaN WITHOUT poisoning the running moments', () => {
    // Two identically-warmed regressions. One is fed a burst of non-finite frames; the
    // other is not. If the guard let ANY of that reach the accumulators, the poisoned one
    // would diverge — and, because a NaN never washes out of an exponentially-weighted
    // sum, it would stay wrong for the rest of the session rather than recovering.
    const poisoned = warmed();
    const control = warmed();
    expect(Number.isNaN(poisoned.eval({ x: NaN, z: 0.3 }))).toBe(true);
    expect(Number.isNaN(poisoned.eval({ x: 1, z: Infinity }))).toBe(true);

    for (let i = 0; i < 40; i++) {
      const z = Math.sin(i / 3);
      poisoned.eval({ x: 5 + 2 * z, z });
      control.eval({ x: 5 + 2 * z, z });
    }
    expect(poisoned.eval({ x: 5 + 2 * 0.3, z: 0.3 })).toBe(control.eval({ x: 5 + 2 * 0.3, z: 0.3 }));
  });

  it('two call sites in one formula keep SEPARATE state', () => {
    const f = compileFormula('residual(x, z) + residual(z, x)', { variables: VARS });
    expect(Number.isFinite(f.eval({ x: 1, z: 2 }))).toBe(true);
  });
});

describe('pairIndex — the strict upper-triangle layout', () => {
  it('is a bijection onto 0..k(k-1)/2-1 for every k', () => {
    for (let k = 2; k <= 9; k++) {
      const seen: number[] = [];
      for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) seen.push(pairIndex(i, j, k));
      expect(seen.sort((a, b) => a - b)).toEqual([...Array((k * (k - 1)) / 2).keys()]);
    }
  });
});

describe('makeCorrelationMatrix (#150)', () => {
  const cfg = (over: Partial<{ maxFeatures: number; everyNFrames: number; window: number }> = {}) => ({
    maxFeatures: 12,
    everyNFrames: 1,
    ...over,
  });

  /** Drive `n` frames of three signals: b tracks a exactly, c is its negation. */
  function drive(fold: ReturnType<typeof makeCorrelationMatrix>, n: number, config = cfg()) {
    const ids = ['a', 'b', 'c'];
    let last;
    for (let i = 0; i < n; i++) {
      const v = Math.sin(i / 5);
      const values: FeatureVector = { a: v, b: v, c: -v };
      last = fold.fold(ids, values, config);
    }
    return last;
  }

  it('recovers the sign and strength of a coupling', () => {
    const out = drive(makeCorrelationMatrix(), 500)!;
    expect(out.ids).toEqual(['a', 'b', 'c']);
    expect(out.r[pairIndex(0, 1, 3)]).toBeCloseTo(1, 2); // a vs b
    expect(out.r[pairIndex(0, 2, 3)]).toBeCloseTo(-1, 2); // a vs c
  });

  it('stores only the strict upper triangle — k(k-1)/2 values, no mirrored duplicates', () => {
    const out = drive(makeCorrelationMatrix(), 50)!;
    expect(out.r.length).toBe(3); // 3 features → 3 pairs, not 9
  });

  it('returns undefined below two features (nothing to correlate)', () => {
    const fold = makeCorrelationMatrix();
    expect(fold.fold(['a'], { a: 1 }, cfg())).toBeUndefined();
    expect(fold.fold([], {}, cfg())).toBeUndefined();
  });

  it('CAPS the feature count and reports what it dropped', () => {
    const fold = makeCorrelationMatrix();
    const ids = Array.from({ length: 40 }, (_, i) => `f${i}`);
    const values: FeatureVector = Object.fromEntries(ids.map((id, i) => [id, i]));
    const out = fold.fold(ids, values, cfg({ maxFeatures: 5 }))!;
    expect(out.ids.length).toBe(5);
    expect(out.r.length).toBe(10); // 5*4/2 — the cap really bounds the QUADRATIC work
    // Not silently swallowed: a diagnostic that shows a subset without saying so is
    // worse than one that refuses.
    expect(out.truncated).toBe(35);
  });

  it('SKIPS frames on the stride, returning the previous result unchanged', () => {
    const fold = makeCorrelationMatrix();
    const config = cfg({ everyNFrames: 4 });
    const ids = ['a', 'b'];
    const results = [];
    for (let i = 0; i < 12; i++) results.push(fold.fold(ids, { a: Math.sin(i), b: Math.cos(i) }, config)!);
    // 12 frames at a stride of 4 = 3 computed frames. `frames` counts folds that actually
    // advanced the moments (the first is the seeding sample, which does not).
    expect(results[results.length - 1].frames).toBe(2);
    // A skipped frame returns the SAME object — the display holds steady rather than
    // flickering between a matrix and nothing.
    expect(results[5]).toBe(results[4]);
  });

  it('scales the EW window by the stride, so the stride costs speed and not memory', () => {
    // The trap: the window is counted in UPDATES. Fold one frame in N without scaling it
    // and the matrix reacts N times more slowly than the meters beside it.
    //
    // Measuring this needs a pair whose correlation CHANGES — a permanently-correlated
    // pair sits at r=1 for any window, which is how the first version of this test
    // managed to pass with the scaling removed. So: 400 frames anti-correlated, then 120
    // correlated, and compare how far r has travelled at the same WALL-CLOCK frame.
    const run = (stride: number) => {
      const fold = makeCorrelationMatrix();
      const ids = ['a', 'b'];
      let out;
      for (let i = 0; i < 520; i++) {
        const v = Math.sin(i / 9);
        const b = i < 400 ? -v : v;
        out = fold.fold(ids, { a: v, b }, cfg({ everyNFrames: stride, window: DEFAULT_CORRELATION_WINDOW }));
      }
      return out!.r[0];
    };
    const fast = run(1);
    const slow = run(6);
    // Both must have travelled a comparable distance out of the anti-correlated regime.
    expect(slow).toBeCloseTo(fast, 1);
    // …and both must actually have moved, or the assertion above would be vacuous.
    expect(fast).toBeGreaterThan(-0.5);
  });

  it('a feature ABSENT this frame leaves its pairs untouched (not read as decorrelated)', () => {
    const fold = makeCorrelationMatrix();
    const ids = ['a', 'b'];
    for (let i = 0; i < 300; i++) {
      const v = Math.sin(i / 5);
      fold.fold(ids, { a: v, b: v }, cfg());
    }
    const before = fold.fold(ids, { a: 0.5, b: 0.5 }, cfg())!.r[0];
    // A hand leaving the frame drops its features from the vector entirely.
    for (let i = 0; i < 50; i++) fold.fold(ids, { a: 0.5 } as FeatureVector, cfg());
    const after = fold.fold(ids, { a: 0.5, b: 0.5 }, cfg())!.r[0];
    expect(after).toBeCloseTo(before, 6);
  });

  it('KEEPS the warm-up of existing pairs when a feature joins the watched set', () => {
    const fold = makeCorrelationMatrix();
    for (let i = 0; i < 400; i++) {
      const v = Math.sin(i / 5);
      fold.fold(['a', 'b'], { a: v, b: v }, cfg());
    }
    // Add a third feature. If the estimator map were rebuilt on a set change, a/b would
    // restart from zero and a warmed-up coefficient would visibly collapse.
    const out = fold.fold(['a', 'b', 'c'], { a: 0.4, b: 0.4, c: 0.1 }, cfg())!;
    expect(out.r[pairIndex(0, 1, 3)]).toBeCloseTo(1, 2);
  });

  it('reset() re-zeroes every estimator', () => {
    const fold = makeCorrelationMatrix();
    drive(fold, 400);
    fold.reset();
    const out = fold.fold(['a', 'b', 'c'], { a: 1, b: 1, c: -1 }, cfg())!;
    expect(out.frames).toBe(0); // the seeding sample only
    expect(out.r.every((v) => v === 0)).toBe(true);
  });
});
