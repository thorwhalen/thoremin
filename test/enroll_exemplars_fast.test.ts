/**
 * Exemplar selection past a few hundred members is linear, not quadratic (#398): the medoid is
 * exact up to `exactUpTo` members (every earlier result unchanged), and estimated against a
 * strided subsample beyond. A 2000-member category is picked in well under 200 ms, the estimate
 * is a typical member (its total distance within 2 % of the true medoid's), and it is the same
 * member every run.
 */
import { describe, expect, it } from 'vitest';
import { pointDistance } from '../packages/sdk/src/enroll/cluster';
import { EXEMPLAR_DEFAULTS, selectExemplars } from '../packages/sdk/src/enroll/exemplars';

const D = 24;
const features = Array.from({ length: D }, (_, i) => `f${i}`);
const model = { features, weights: Object.fromEntries(features.map((f) => [f, 1])) };
const centroid = Object.fromEntries(features.map((f, k) => [f, 0.3 * (k % 2)]));

/** Two sub-poses of one category plus noise, from a seeded generator (the same every run). */
function category(n: number) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const noise = () => 0.05 * (rnd() + rnd() + rnd() - 1.5);
  return Array.from({ length: n }, (_, i) => Object.fromEntries(features.map((f, k) => [f, (i % 3 ? 0.3 : 0.6) * (k % 2) + noise()])));
}
const all = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('exemplar selection at scale', () => {
  it('picks the exact medoid up to exactUpTo members', () => {
    const n = EXEMPLAR_DEFAULTS.exactUpTo;
    const vectors = category(n);
    const [m] = selectExemplars(model, { centroid, members: all(n) }, vectors, { count: 1 });
    const between = pointDistance(vectors, features, model.weights);
    const totals = vectors.map((_, a) => vectors.reduce((s, _v, b) => (a === b ? s : s + between(a, b)), 0));
    expect(totals[m.index]).toBeCloseTo(Math.min(...totals), 9);
  });

  it('builds the exemplars of a 2000-member category in under 200 ms', () => {
    const vectors = category(2000);
    const t = performance.now();
    const out = selectExemplars(model, { centroid, members: all(2000) }, vectors, { count: 4 });
    expect(performance.now() - t).toBeLessThan(200);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((e) => e.index)).size).toBe(4);
  });

  it('estimates a typical medoid: total distance within 2 % of the exact one', () => {
    const vectors = category(1500);
    const [m] = selectExemplars(model, { centroid, members: all(1500) }, vectors, { count: 1 });
    const between = pointDistance(vectors, features, model.weights);
    const total = (a: number) => vectors.reduce((s, _v, b) => (a === b ? s : s + between(a, b)), 0);
    const best = Math.min(...vectors.map((_, a) => total(a)));
    expect(total(m.index)).toBeLessThan(best * 1.02);
  });

  it('is deterministic', () => {
    const vectors = category(1200);
    const run = () => selectExemplars(model, { centroid, members: all(1200) }, vectors, { count: 4 }).map((e) => e.index);
    expect(run()).toEqual(run());
  });

  it('exactUpTo and references are options', () => {
    const vectors = category(400);
    const exact = selectExemplars(model, { centroid, members: all(400) }, vectors, { count: 1, exactUpTo: 400 })[0].index;
    const same = selectExemplars(model, { centroid, members: all(400) }, vectors, { count: 1, exactUpTo: 10, references: 400 })[0].index;
    expect(same).toBe(exact);
  });
});
