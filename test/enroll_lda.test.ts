/**
 * The LDA map of the holds (#434): it separates classes the raw axes do not, places a live vector
 * in the same plane, falls back to principal axes with fewer than three classes, and survives
 * degenerate input.
 */
import { describe, expect, it } from 'vitest';
import { ldaProjection } from '@thoremin/sdk/enroll/lda';
import type { FeatureVector } from '@thoremin/sdk/enroll';

const FEATURES = Array.from({ length: 12 }, (_, i) => `f${i}`);
const WEIGHTS = Object.fromEntries(FEATURES.map((f) => [f, 1]));

/** Small deterministic noise. */
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5);

/** `k` classes whose means differ along feature f(c) only, buried in noisy nuisance features. */
function data(k: number, per = 8) {
  const vectors: FeatureVector[] = [];
  const classes: number[] = [];
  for (let c = 0; c < k; c++)
    for (let i = 0; i < per; i++) {
      const v: FeatureVector = {};
      FEATURES.forEach((f, j) => (v[f] = rnd() * (j < 4 ? 6 : 0.4) + (j === c ? 1 : 0)));
      vectors.push(v);
      classes.push(c);
    }
  return { vectors, classes };
}

/** Between-class over within-class spread along an axis of the map. */
function separation(points: readonly [number, number][], classes: readonly number[], axis: 0 | 1) {
  const ks = [...new Set(classes)];
  const m = ks.map((k) => {
    const xs = points.filter((_, i) => classes[i] === k).map((p) => p[axis]);
    return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, xs };
  });
  const within = m.flatMap((g) => g.xs.map((x) => (x - g.mean) ** 2)).reduce((a, b) => a + b, 0) / classes.length;
  const all = m.reduce((a, g) => a + g.mean, 0) / m.length;
  const between = m.reduce((a, g) => a + (g.mean - all) ** 2, 0) / m.length;
  return between / within;
}

describe('ldaProjection', () => {
  it('with three or more classes it is an LDA map that separates them, beyond the noisy axes', () => {
    const { vectors, classes } = data(4);
    const map = ldaProjection(vectors, classes, FEATURES, WEIGHTS)!;
    expect(map.method).toBe('lda');
    expect(map.points).toHaveLength(vectors.length);
    const pca = ldaProjection(vectors, classes.map(() => 0), FEATURES, WEIGHTS)!;
    expect(pca.method).toBe('pca');
    const best = (m: typeof map) => Math.max(separation(m.points, classes, 0), separation(m.points, classes, 1));
    expect(best(map)).toBeGreaterThan(best(pca));
  });

  it('puts a live vector in the same plane: a hold projects to its own point', () => {
    const { vectors, classes } = data(3);
    const map = ldaProjection(vectors, classes, FEATURES, WEIGHTS)!;
    const p = map.project(vectors[5]);
    expect(p[0]).toBeCloseTo(map.points[5][0], 9);
    expect(p[1]).toBeCloseTo(map.points[5][1], 9);
    // A vector with every feature missing reads as the holds' mean: finite, at the middle.
    const mid = map.project({});
    expect(Number.isFinite(mid[0]) && Number.isFinite(mid[1])).toBe(true);
  });

  it('falls back to principal axes with two classes, and draws unlabelled holds without using them', () => {
    const { vectors, classes } = data(2);
    expect(ldaProjection(vectors, classes, FEATURES, WEIGHTS)!.method).toBe('pca');
    const three = data(3);
    const half = three.classes.map((c, i) => (i % 4 === 0 ? -1 : c));
    const map = ldaProjection(three.vectors, half, FEATURES, WEIGHTS)!;
    expect(map.method).toBe('lda');
    expect(map.points).toHaveLength(three.vectors.length);
  });

  it('is deterministic, and survives degenerate input', () => {
    const { vectors, classes } = data(3);
    expect(ldaProjection(vectors, classes, FEATURES, WEIGHTS)!.points).toEqual(ldaProjection(vectors, classes, FEATURES, WEIGHTS)!.points);
    expect(ldaProjection([], [], FEATURES, WEIGHTS)).toBeNull();
    expect(ldaProjection(vectors, classes, [], WEIGHTS)).toBeNull();
    const same = vectors.map(() => ({ f0: 1 }));
    const flat = ldaProjection(same, classes, FEATURES, WEIGHTS)!;
    expect(flat.points.every((p) => p.every(Number.isFinite))).toBe(true);
    // More features than holds (the usual carve) is still a map.
    const wide = ldaProjection(vectors.slice(0, 6), [0, 0, 1, 1, 2, 2], FEATURES, WEIGHTS)!;
    expect(wide.points.every((p) => p.every(Number.isFinite))).toBe(true);
  });
});
