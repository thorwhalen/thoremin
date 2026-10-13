/**
 * Personal categorizers, P1 core (#330): the one-to-one label matcher, exemplar selection,
 * the versioned import/export schema and model-from-model, unit by unit, then end to end
 * over the REAL recordings: `video_head_pose` (the trainer's own fixture) through the real
 * session and the real starter cues, and `video_face_expressions` through the matcher.
 */
import { describe, it, expect } from 'vitest';
import {
  CATEGORIZER_FORMAT,
  CATEGORIZER_VERSION,
  MAX_SAMPLE_SUPPORT,
  NO_REJECT_RADIUS,
  SEED_CUE,
  applyLabels,
  assignMax,
  carryBindings,
  carryLabels,
  categorizerFromModel,
  classify,
  createSession,
  createStillPointSampler,
  exemplarsByCategory,
  exportCategorizer,
  importCategorizer,
  matchLabels,
  mergeSession,
  migrateCategorizerV1,
  modelFromCategorizer,
  selectExemplars,
  trainModel,
  TrainedModelSchema,
  type FeatureVector,
  type PersonalCategorizer,
  type SampleInput,
  type StillPoint,
  type TrainedModel,
} from '@thoremin/sdk/enroll';
import { BLENDSHAPE_NAME_BY_FEATURE, FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import { blendshapesOf, generalFaceLabeling } from '@thoremin/sdk/features/face_labels';
import { starterCueById } from '@/app/enroll/starterCues';
import { loadStream } from './helpers/fixtures';

/** A small deterministic PRNG (mulberry32), so the brute-force comparisons are stable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The best total over all injective row->column assignments, by brute force. */
function bruteMax(m: number[][]): number {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  let best = -Infinity;
  const used = new Array(cols).fill(false);
  const go = (i: number, total: number) => {
    if (i === rows) {
      best = Math.max(best, total);
      return;
    }
    let placed = false;
    for (let j = 0; j < cols; j++) {
      if (used[j]) continue;
      placed = true;
      used[j] = true;
      go(i + 1, total + m[i][j]);
      used[j] = false;
    }
    // More rows than columns: this row may go unassigned.
    if (!placed || rows > cols) go(i + 1, total);
  };
  go(0, 0);
  return best;
}

const totalOf = (m: number[][], a: number[]) => a.reduce((s, j, i) => s + (j >= 0 ? m[i][j] : 0), 0);

describe('assignMax: the rectangular assignment (Hungarian)', () => {
  it('matches brute force on square, wide and tall matrices', () => {
    const r = rng(330);
    for (const [rows, cols] of [[3, 3], [4, 4], [2, 5], [5, 2], [6, 7], [7, 3], [1, 4], [4, 1]]) {
      for (let trial = 0; trial < 15; trial++) {
        const m = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.round(r() * 100) / 100));
        const a = assignMax(m);
        expect(a).toHaveLength(rows);
        const usedCols = a.filter((j) => j >= 0);
        expect(new Set(usedCols).size).toBe(usedCols.length); // one-to-one
        expect(usedCols.length).toBe(Math.min(rows, cols)); // every column or every row used
        expect(totalOf(m, a)).toBeCloseTo(bruteMax(m), 9);
      }
    }
  });

  it('is total on degenerate input', () => {
    expect(assignMax([])).toEqual([]);
    expect(assignMax([[], []])).toEqual([-1, -1]);
    expect(assignMax([[NaN, 1], [Infinity, 0]])).toEqual([1, 0]); // non-finite counts as 0
    // Scores near the double range are clamped, so no cost overflows (this used to spin).
    expect(assignMax([[1e308, 1e308], [-1e308, -1e308]]).sort()).toEqual([0, 1]);
  });

  it('prefers the global optimum over the greedy one', () => {
    // Greedy (row 0 takes its best, 0.9) leaves row 1 with 0.1: total 1.0. The optimum is 1.6.
    const m = [
      [0.9, 0.8],
      [0.8, 0.1],
    ];
    expect(assignMax(m)).toEqual([1, 0]);
  });
});

const cat = (id: string, centroid: FeatureVector, label = '') => ({ id, label, centroid });

describe('matchLabels: one-to-one default names', () => {
  // A toy general model over two features: "up" likes x, "down" likes y.
  const score = (c: FeatureVector) => ({ up: c.x ?? 0, down: c.y ?? 0, wide: Math.min(c.x ?? 0, c.y ?? 0) });

  it('never gives one label twice, even when two categories prefer it', () => {
    const m = matchLabels([cat('a', { x: 0.9, y: 0.0 }), cat('b', { x: 0.8, y: 0.5 })], { labels: ['up', 'down', 'wide'], score, minScore: 0.3 });
    expect(m.map((x) => x.label)).toEqual(['up', 'down']);
    expect(m.every((x) => x.source === 'matched')).toBe(true);
    expect(m[1].score).toBe(0.5);
  });

  it('a category below the bar gets a fallback name, and the bar can be per label', () => {
    const m = matchLabels([cat('a', { x: 0.9 }), cat('b', { x: 0.05, y: 0.1 })], { labels: ['up', 'down'], score, minScore: 0.3 });
    expect(m[1]).toMatchObject({ label: 'category 2', source: 'fallback', matched: null, score: null });
    const perLabel = matchLabels([cat('a', { x: 0.9 }), cat('b', { y: 0.1 })], { labels: ['up', 'down'], score, minScore: { up: 0.3, down: 0.05 } });
    expect(perLabel[1].label).toBe('down');
  });

  it('scores under the bar are zeroed BEFORE the assignment, so they cannot bend it', () => {
    // a {up .9, down .31}, b {up .6, down .29}, bar .3. Unbarred, the optimum is a=up,
    // b=down (.9 + .29 = 1.19), and dropping b's sub-bar "down" AFTER the assignment would
    // leave b with nothing. Zeroed first, b's .29 counts for nothing, so a=up/b=down is worth
    // .9 and a=down/b=up is worth .91: both categories get an earned label.
    const score = (c: FeatureVector) => ({ up: c.x ?? 0, down: c.y ?? 0 });
    const m = matchLabels([cat('a', { x: 0.9, y: 0.31 }), cat('b', { x: 0.6, y: 0.29 })], { labels: ['up', 'down'], score, minScore: 0.3 });
    expect(m.map((x) => x.label)).toEqual(['down', 'up']);
    // With b's "up" weak too, a keeps "up" and b falls back rather than taking a sub-bar label.
    const weak = matchLabels([cat('a', { x: 0.9, y: 0.31 }), cat('b', { x: 0.25, y: 0.29 })], { labels: ['up', 'down'], score, minScore: 0.3 });
    expect(weak.map((x) => x.label)).toEqual(['up', 'category 2']);
  });

  it('a negative bar cannot make a negative score win a label', () => {
    const m = matchLabels([cat('a', { x: 1, y: -10 }), cat('b', { x: 0.9, y: -100 })], {
      labels: ['x', 'y'],
      score: (c) => ({ x: c.x ?? 0, y: c.y ?? 0 }),
      minScore: -1000,
    });
    expect(m.map((x) => x.label)).toEqual(['x', 'category 2']);
  });

  it('the pool is de-duplicated (case and space), so a matched name is never given twice', () => {
    const m = matchLabels([cat('a', { x: 0.9 }), cat('b', { x: 0.8 })], { labels: ['Up', 'up', ' up ', ''], score: (c) => ({ Up: c.x ?? 0, up: c.x ?? 0, ' up ': c.x ?? 0 }), minScore: 0.1 });
    expect(m.map((x) => x.label)).toEqual(['Up', 'category 2']);
  });

  it("keeps the player's names and takes them out of the pool", () => {
    const m = matchLabels([cat('a', { x: 0.9 }, 'Up'), cat('b', { x: 0.8, y: 0.1 })], { labels: ['up', 'down'], score, minScore: 0.05 });
    expect(m[0]).toMatchObject({ label: 'Up', source: 'kept' });
    expect(m[1].label).toBe('down'); // "up" was taken, case-insensitively
    const off = matchLabels([cat('a', { x: 0.9 }, 'mine')], { labels: ['up'], score, keepExisting: false });
    expect(off[0].label).toBe('up');
  });

  it('a fallback never collides with a kept or matched name', () => {
    const m = matchLabels([cat('a', {}, 'category 2'), cat('b', {})], { labels: [], score });
    expect(m.map((x) => x.label)).toEqual(['category 2', 'category 2 (2)']);
    const named = matchLabels([cat('a', {}), cat('b', {})], { labels: [], score, fallback: (i) => `expression ${i + 1}` });
    expect(named.map((x) => x.label)).toEqual(['expression 1', 'expression 2']);
  });

  it('applyLabels writes the names into a copy of the model', () => {
    const model: TrainedModel = { categories: [{ id: 'cat-1', label: '', centroid: {}, size: 1, radius: 0, members: [0] }], weights: {}, features: [], rejectRadius: 1 };
    const out = applyLabels(model, [{ id: 'cat-1', label: 'happy' }]);
    expect(out.categories[0].label).toBe('happy');
    expect(model.categories[0].label).toBe(''); // not mutated
  });
});

describe('the general face model as a label scorer', () => {
  it('maps every raw blendshape feature id to its MediaPipe name', () => {
    const raw = FACE_FEATURES.filter((f) => f.id.startsWith('face.blendshape.'));
    expect(Object.keys(BLENDSHAPE_NAME_BY_FEATURE).sort()).toEqual(raw.map((f) => f.id).sort());
    expect(BLENDSHAPE_NAME_BY_FEATURE['face.blendshape.mouth.smileLeft']).toBe('mouthSmileLeft');
    expect(blendshapesOf({ 'face.blendshape.jaw.open': 0.5, 'face.head.yaw': 10, 'face.blendshape.mouth.smileLeft': NaN })).toEqual({ jawOpen: 0.5 });
  });

  it('a smiling centroid is "happy" and a resting one earns no label', () => {
    const smile = { 'face.blendshape.mouth.smileLeft': 0.8, 'face.blendshape.mouth.smileRight': 0.8 };
    const m = matchLabels([cat('a', smile), cat('b', {})], { ...generalFaceLabeling(), fallback: (i) => `expression ${i + 1}` });
    expect(m.map((x) => x.label)).toEqual(['happy', 'expression 2']);
  });
});

describe('selectExemplars: medoid first, then a spread toward the edge', () => {
  const features = ['x'];
  const weights = { x: 1 };
  // 1-D members: a dense centre and a long tail, plus one far outlier.
  const xs = [0, 0.1, -0.1, 0.2, -0.2, 0.4, 0.6, 0.8, 1.0, 5.0];
  const vectors = xs.map((x) => ({ x }));
  const members = xs.map((_, i) => i);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const category = { centroid: { x: mean }, members };

  it('the first is the medoid: a real member with the least total distance to the rest', () => {
    const ex = selectExemplars({ features, weights }, category, vectors);
    const total = (j: number) => members.reduce((s, k) => s + Math.abs(xs[j] - xs[k]), 0);
    const best = Math.min(...members.map(total));
    expect(ex[0].role).toBe('medoid');
    expect(total(ex[0].index)).toBeCloseTo(best, 12);
  });

  it('the rest grow in distance from the centroid, repeat nothing and leave the far tail out', () => {
    const ex = selectExemplars({ features, weights }, category, vectors, { count: 5 });
    expect(ex).toHaveLength(5);
    expect(new Set(ex.map((e) => e.index)).size).toBe(5);
    const spread = ex.slice(1).map((e) => e.distance);
    for (let i = 1; i < spread.length; i++) expect(spread[i]).toBeGreaterThan(spread[i - 1]);
    expect(ex.some((e) => xs[e.index] === 5.0)).toBe(false); // beyond the 0.9 quantile
    expect(selectExemplars({ features, weights }, category, vectors, { count: 4, edge: 1 }).at(-1)!.index).toBe(9);
  });

  it('clamps to the members it has', () => {
    const two = { centroid: { x: 0 }, members: [0, 1] };
    expect(selectExemplars({ features, weights }, two, vectors, { count: 9 })).toHaveLength(2);
    expect(selectExemplars({ features, weights }, { centroid: {}, members: [] }, vectors)).toEqual([]);
    // A non-finite option falls back to its default rather than producing holes.
    const odd = selectExemplars({ features, weights }, category, vectors, { count: NaN, edge: NaN });
    expect(odd).toHaveLength(4);
    expect(odd.every((e) => Number.isInteger(e.index) && Number.isFinite(e.distance))).toBe(true);
    for (let n = 1; n <= 9; n++) {
      const ex = selectExemplars({ features, weights }, category, vectors, { count: n });
      expect(new Set(ex.map((e) => e.index)).size).toBe(ex.length);
    }
  });
});

/** A small two-category model over two features, for the schema and merge tests. */
function toyTake() {
  const points: StillPoint[] = [
    { vector: { x: 0, y: 0 }, t: 0, cue: 'faces' },
    { vector: { x: 0.1, y: 0 }, t: 1, cue: 'faces' },
    { vector: { x: 0, y: 0.1, z: NaN }, t: 2, cue: 'faces' },
    { vector: { x: 1, y: 1 }, t: 3, cue: 'faces' },
    { vector: { x: 1.1, y: 0.9 }, t: 4, cue: 'faces' },
    { vector: { x: 5, y: -5 }, t: 5, cue: 'stray' },
  ];
  const features = ['x', 'y'];
  const weights = { x: 1, y: 1 };
  const model = trainModel(points.map((p) => p.vector), [[0, 1, 2], [3, 4]], features, weights, { defaultRejectRadius: 0.5 });
  model.categories[0].label = 'rest';
  model.categories[1].label = 'up';
  return { points, model };
}

describe('the categorizer file: versioned, samples as the SSOT', () => {
  it('round-trips through export and import unchanged, and derives the same model', () => {
    const { points, model } = toyTake();
    const c = categorizerFromModel(model, points, { name: 'mine', mode: 'reject', modality: 'face', createdAt: '2026-10-13T00:00:00Z' });
    expect(c).toMatchObject({ format: CATEGORIZER_FORMAT, version: CATEGORIZER_VERSION, strangers: 'neutral' });
    expect(c.categories.map((x) => x.members)).toEqual([['s-0', 's-1', 's-2'], ['s-3', 's-4']]);
    // The stray sample no category claims is "none of these" (reject mode).
    expect(c.neutral).toEqual(['s-5']);
    expect(c.samples[2].vector).toEqual({ x: 0, y: 0.1 }); // the NaN was dropped
    const back = importCategorizer(exportCategorizer(c));
    expect(back).toEqual({ ok: true, categorizer: c, migratedFrom: null });
    const derived = modelFromCategorizer(c);
    expect(derived.rejectRadius).toBe(model.rejectRadius);
    expect(derived.categories.map((x) => [x.id, x.label, x.members])).toEqual(model.categories.map((x) => [x.id, x.label, x.members]));
    derived.categories.forEach((x, i) => {
      for (const f of ['x', 'y']) expect(x.centroid[f]).toBeCloseTo(model.categories[i].centroid[f], 12);
    });
    expect(derived.categories[0].cues).toEqual({ faces: 3 });
    // The stray sample belongs to no category, and still classifies the same both ways.
    for (const p of points) expect(classify(derived, p.vector)).toEqual(classify(model, p.vector));
  });

  it('partition mode rejects nothing, and the derived model still persists', () => {
    const { points, model } = toyTake();
    const c = categorizerFromModel(model, points, { name: 'all', mode: 'partition' });
    expect(c.rejectRadius).toBeUndefined();
    // Nothing is neutral in partition mode: a sample no category claims is set aside.
    expect(c).toMatchObject({ strangers: 'nearest', neutral: [], aside: ['s-5'] });
    const derived = modelFromCategorizer(c);
    expect(derived.rejectRadius).toBe(NO_REJECT_RADIUS);
    expect(classify(derived, { x: 100, y: 100 }).rejected).toBe(false);
    expect(TrainedModelSchema.safeParse(derived).success).toBe(true);
  });

  it('refuses what is not a categorizer, a newer version and an invalid one, saying why', () => {
    const { points, model } = toyTake();
    const c = categorizerFromModel(model, points, { name: 'mine', mode: 'reject' });
    const err = (x: unknown) => {
      const r = importCategorizer(x);
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.error;
    };
    expect(err('{nope')).toMatch(/not JSON/);
    expect(err([])).toMatch(/expected an object/);
    expect(err({ ...c, format: 'other' })).toMatch(/not a categorizer/);
    expect(err({ ...c, version: CATEGORIZER_VERSION + 1 })).toMatch(/newer thoremin/);
    expect(err({ ...c, version: 1.5 })).toMatch(/bad version/);
    expect(err({ ...c, rejectRadius: undefined })).toMatch(/rejectRadius/);
    expect(err({ ...c, categories: [c.categories[0], { ...c.categories[1], members: ['s-2', 's-3', 's-4'] }] })).toMatch(/s-2" is in category "cat-1" and in category "cat-2/);
    expect(err({ ...c, categories: [c.categories[0], { ...c.categories[1], members: ['s-3', 's-4', 's-99'] }] })).toMatch(/not in samples/);
    expect(err({ ...c, categories: [c.categories[0], { ...c.categories[1], id: c.categories[0].id }] })).toMatch(/duplicate category id/);
    expect(err({ ...c, categories: [c.categories[0], { ...c.categories[1], members: ['s-3', 's-3', 's-4'] }] })).toMatch(/s-3" is in category "cat-2" and in category "cat-2/);
    // Every sample is in exactly one place, and ids are unique.
    expect(err({ ...c, neutral: [] })).toMatch(/s-5" is in no category, neutral or aside/);
    expect(err({ ...c, aside: ['s-5'] })).toMatch(/s-5" is in neutral and in aside/);
    expect(err({ ...c, samples: c.samples.map((x, i) => (i === 1 ? { ...x, id: 's-0' } : x)) })).toMatch(/used twice/);
    expect(err({ ...c, categories: [{ ...c.categories[0], id: 'neutral' }, c.categories[1]] })).toMatch(/a bin's name/);
    // A pin names a sample and a category or a bin.
    expect(err({ ...c, pins: { 's-0': 'cat-9' } })).toMatch(/no category or bin/);
    expect(err({ ...c, pins: { 's-9': 'neutral' } })).toMatch(/pin names sample "s-9"/);
    expect(importCategorizer({ ...c, pins: { 's-0': 'cat-2', 's-5': 'aside' } }).ok).toBe(true);
    expect(err({ ...c, categories: [] })).toMatch(/categories/);
    // modelFromCategorizer validates too: an empty category must not shift ids onto members.
    expect(() => modelFromCategorizer({ ...c, categories: [{ ...c.categories[0], members: [] }, c.categories[1]] })).toThrow();
  });

  it('reads a hand-edited file whose feature values include null (a NaN written out)', () => {
    const { points, model } = toyTake();
    const c = categorizerFromModel(model, points, { name: 'mine', mode: 'reject' });
    const text = exportCategorizer(c).replace('"x": 0.1', '"x": null');
    const r = importCategorizer(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.categorizer.samples[1].vector).toEqual({ y: 0 });
  });

  it('migrates an older version through the hook, and refuses a gap in the chain', () => {
    const { points, model } = toyTake();
    const c = categorizerFromModel(model, points, { name: 'mine', mode: 'reject' });
    // A hypothetical version 0 that named the strangers setting "open".
    const v0 = { ...c, version: 0, strangers: 'open' };
    const migrations = {
      0: (d: Record<string, unknown>) => ({ ...d, version: 1 }),
      1: (d: Record<string, unknown>) => ({ ...d, version: 2, strangers: d.strangers === 'open' ? 'neutral' : d.strangers }),
    };
    expect(importCategorizer(v0, { migrations })).toEqual({ ok: true, categorizer: c, migratedFrom: 0 });
    const missing = importCategorizer(v0, { migrations: { 1: migrations[1] } });
    expect(missing).toEqual({ ok: false, error: 'no migration from version 0' });
    const stuck = importCategorizer(v0, { migrations: { 0: (d) => d, 1: migrations[1] } });
    expect(stuck.ok).toBe(false);
    const throws = importCategorizer(v0, {
      migrations: {
        0: () => {
          throw new Error('boom');
        },
        1: migrations[1],
      },
    });
    expect(throws).toEqual({ ok: false, error: 'migration from version 0 failed (boom)' });
    const empty = importCategorizer(v0, { migrations: { 0: () => null as unknown as Record<string, unknown>, 1: migrations[1] } });
    expect(empty).toEqual({ ok: false, error: 'migration from version 0 returned no document' });
  });
});

describe('version 1 to version 2 (#385 E3)', () => {
  /** A version-1 file as this build wrote it before E3: positions, `mode`, `k`. */
  const v1Of = (c: PersonalCategorizer, mode: 'reject' | 'partition'): Record<string, unknown> => {
    const at = new Map(c.samples.map((x, i) => [x.id, i]));
    const { strangers: _s, neutral: _n, aside: _a, pins: _p, ...rest } = c;
    void [_s, _n, _a, _p];
    return {
      ...rest,
      version: 1,
      mode,
      k: c.categories.length,
      samples: c.samples.map(({ id: _id, ...x }) => x),
      categories: c.categories.map((cat) => ({ ...cat, members: cat.members.map((id) => at.get(id)) })),
    };
  };

  for (const mode of ['reject', 'partition'] as const) {
    it(`migrates a ${mode} file to the same model, and back to the same file`, () => {
      const { points, model } = toyTake();
      const v2 = categorizerFromModel(model, points, { name: 'mine', mode });
      const v1 = v1Of(v2, mode);
      const r = importCategorizer(JSON.stringify(v1));
      expect(r).toEqual({ ok: true, categorizer: v2, migratedFrom: 1 });
      // Byte-identical derived model, and lossless back to version 1.
      if (r.ok) {
        expect(JSON.stringify(modelFromCategorizer(r.categorizer))).toBe(JSON.stringify(modelFromCategorizer(v2)));
        expect(v1Of(r.categorizer, mode)).toEqual(v1);
      }
    });
  }

  it('keeps member order as stored (a centroid sums in that order), and takes ids from the caller', () => {
    const { points, model } = toyTake();
    const v1 = { ...v1Of(categorizerFromModel(model, points, { name: 'mine', mode: 'reject' }), 'reject'), categories: [
      { id: 'cat-1', label: 'rest', members: [2, 0, 1] },
      { id: 'cat-2', label: 'up', members: [4, 3] },
    ] };
    const out = migrateCategorizerV1(v1, { idFor: (i) => `take-1:${i}` });
    expect(out).toMatchObject({ version: 2, strangers: 'neutral', neutral: ['take-1:5'] });
    expect((out.categories as { members: string[] }[]).map((c) => c.members)).toEqual([['take-1:2', 'take-1:0', 'take-1:1'], ['take-1:4', 'take-1:3']]);
    expect(out).not.toHaveProperty('k');
    expect(out).not.toHaveProperty('mode');
  });

  it('passes a malformed version 1 through for validation to name what is wrong', () => {
    const r = importCategorizer({ format: CATEGORIZER_FORMAT, version: 1, name: 'x', mode: 'reject', k: 1, features: ['x'], weights: {}, rejectRadius: 1, samples: 'nope', categories: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid categorizer: samples/);
  });

  it('keeps a sample\'s supporting frames over the model\'s features only, and at most a few', () => {
    const { points, model } = toyTake();
    const frames = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 1 - i, z: 7, w: NaN }));
    const c = categorizerFromModel(model, points.map((p, i) => ({ ...p, id: `t:${i}`, support: i === 0 ? frames : [] })), { name: 'mine', mode: 'reject' });
    expect(c.samples[0].support).toHaveLength(MAX_SAMPLE_SUPPORT);
    expect(c.samples[0].support![1]).toEqual({ x: 1, y: 0 });
    expect(c.samples[1]).not.toHaveProperty('support');
    expect(importCategorizer(exportCategorizer(c))).toEqual({ ok: true, categorizer: c, migratedFrom: null });
    // An imported file may carry no more than the bound.
    const tooMany = { ...c, samples: c.samples.map((x, i) => (i === 0 ? { ...x, support: [...frames, ...frames] } : x)) };
    expect(importCategorizer(tooMany).ok).toBe(false);
  });
});

describe('a model from a model', () => {
  const base = (): PersonalCategorizer => {
    const { points, model } = toyTake();
    return categorizerFromModel(model, points, { name: 'theirs', mode: 'reject' });
  };
  // Someone else's face: the same two poses, shifted by 0.3 on x.
  const shifted: SampleInput[] = [
    { id: 'take-2:0', vector: { x: 0.3, y: 0 }, t: 10, cue: 'faces' },
    { id: 'take-2:1', vector: { x: 0.35, y: 0.05 }, t: 11, cue: 'faces' },
    { id: 'take-2:2', vector: { x: 1.3, y: 1 }, t: 12, cue: 'faces' },
    { id: 'take-2:3', vector: { x: 40, y: 40 }, t: 13, cue: 'faces' },
  ];

  it('merge keeps ids and labels, joins each new pose to its nearest category, and keeps a far one as a free sample', () => {
    const b = base();
    const r = mergeSession(b, shifted);
    expect(r.assigned).toEqual([0, 0, 1, -1]);
    expect(r.untouched).toEqual([]);
    expect(r.converged).toBe(true);
    const c = r.categorizer;
    expect(c.categories.map((x) => [x.id, x.label])).toEqual(b.categories.map((x) => [x.id, x.label]));
    expect(c.samples).toHaveLength(b.samples.length + shifted.length);
    // Members by id: the base's keep theirs, the new ones bring their own.
    expect(c.categories[0].members).toEqual(['s-0', 's-1', 's-2', 'take-2:0', 'take-2:1']);
    // The far one is "none of these", beside the base's stray.
    expect(c.neutral).toEqual(['s-5', 'take-2:3']);
    expect(c.rejectRadius).toBeGreaterThanOrEqual(b.rejectRadius!); // never lowered
    expect(b.samples).toHaveLength(6); // the base is not modified
    // Bindings keyed by id carry with no work at all.
    const bindings = { [b.categories[1].id]: { command: 'x' } };
    expect(carryBindings({ model: modelFromCategorizer(b), bindings }, modelFromCategorizer(c))).toEqual(bindings);
  });

  it('seeding from centroids lets the new player dominate, and keeps a category they never reached', () => {
    const b = base();
    const fromSamples = modelFromCategorizer(mergeSession(b, shifted.slice(0, 2)).categorizer);
    const r = mergeSession(b, shifted.slice(0, 2), { seed: 'centroids' });
    const fromCentroids = modelFromCategorizer(r.categorizer);
    // Two new points against one seed: the rest centroid moves most of the way to them.
    expect(fromCentroids.categories[0].centroid.x).toBeGreaterThan(fromSamples.categories[0].centroid.x);
    expect(fromCentroids.categories[0].centroid.x).toBeGreaterThan(0.2);
    expect(r.untouched).toEqual([b.categories[1].id]);
    expect(r.categorizer.samples.filter((s) => s.cue === SEED_CUE).map((s) => s.id)).toEqual(['seed:cat-1', 'seed:cat-2']);
    // The base's samples are gone, and so is its neutral.
    expect(r.categorizer.neutral).toEqual([]);
    expect(fromCentroids.categories[1].label).toBe('up');
    // A seed centroid stores only features its members had (no invented 0 for `z`).
    const noZ = mergeSession({ ...b, features: ['x', 'y', 'z'] }, [], { seed: 'centroids' });
    expect(noZ.categorizer.samples.every((s) => !('z' in s.vector))).toBe(true);
  });

  it('carryLabels names a fresh model after the old one, one-to-one by nearest centroid', () => {
    const { points, model } = toyTake();
    // A fresh carve of the shifted take, in the other order.
    const fresh = trainModel(shifted.slice(0, 3).map((p) => p.vector).reverse(), [[0], [1, 2]], ['x', 'y'], { x: 1, y: 1 }, { defaultRejectRadius: 0.5 });
    const m = carryLabels(model, fresh);
    expect(m.map((x) => x.label)).toEqual(['up', 'rest']);
    // Too far apart to be the same category: a fallback, not a stranger's name.
    const far = carryLabels(model, fresh, { maxDistance: 0.01 });
    expect(far.every((x) => x.source === 'fallback')).toBe(true);
    // The names, then the bindings, travel.
    const relabelled = applyLabels(fresh, m);
    const bindings = { [model.categories[1].id]: { command: 'up!' } };
    expect(carryBindings({ model, bindings }, relabelled)).toEqual({ [relabelled.categories[0].id]: { command: 'up!' } });
    void points;
  });
});

describe('end to end over the REAL recordings (acceptance)', () => {
  interface PoseRecord {
    blendshapes: Record<string, number>;
  }
  const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
  const FPS = 29.3;
  /** A frame in catalog ids: exactly what the catalog's blendshape features compute. */
  const vecAt = (i: number): FeatureVector =>
    Object.fromEntries(Object.entries(BLENDSHAPE_NAME_BY_FEATURE).map(([id, name]) => [id, frames[i].blendshapes[name] ?? 0]));
  const range = (from: number, to: number) => {
    const out: { v: FeatureVector; t: number }[] = [];
    for (let i = Math.round(from * FPS); i <= Math.round(to * FPS) && i < frames.length; i++) out.push({ v: vecAt(i), t: (i / FPS) * 1000 });
    return out;
  };
  const trained = () => {
    // The real starter cues, in the trainer's order of meaning: rest (baseline), the dolly
    // (nuisance: the phone moves while a smile is held), then the player's faces.
    const session = createSession();
    const feed = (id: string, from: number, to: number) => {
      session.beginCue(starterCueById(id)!);
      for (const { v, t } of range(from, to)) session.push(v, t);
      session.endCue();
    };
    feed('rest', 7.7, 8.5);
    feed('closer-and-further', 10.9, 13.6);
    feed('your-faces', 0, 10.5);
    session.build();
    return session;
  };

  it('carve, name one-to-one, show, save, load, and classify the same', () => {
    const session = trained();
    const points = session.points();
    expect(points.length).toBeGreaterThanOrEqual(4);
    const model = session.retrain(3);

    // Default names: unique, earned (each over the general model's own firing bar), the
    // held smile at ~5.3 s called "happy", the rest falling back to "expression n".
    const labeling = generalFaceLabeling();
    const names = matchLabels(model.categories, { ...labeling, fallback: (i) => `expression ${i + 1}` });
    expect(new Set(names.map((n) => n.label.toLowerCase())).size).toBe(names.length);
    for (const n of names) if (n.source === 'matched') expect(n.score!).toBeGreaterThanOrEqual(labeling.minScore[n.matched as keyof typeof labeling.minScore]);
    const smileIdx = points.findIndex((p) => Math.abs(p.t / 1000 - 5.3) < 0.2);
    expect(smileIdx).toBeGreaterThanOrEqual(0);
    const smileCat = model.categories.findIndex((c) => c.members.includes(smileIdx));
    expect(names[smileCat].label).toBe('happy');
    const named = applyLabels(model, names);

    // Exemplars: one per category at least, the medoid a member, in noise units.
    const ex = exemplarsByCategory(named, points.map((p) => p.vector));
    for (const c of named.categories) {
      expect(ex[c.id].length).toBe(Math.min(c.size, 4));
      expect(c.members).toContain(ex[c.id][0].index);
      expect(ex[c.id].every((e) => Number.isFinite(e.distance))).toBe(true);
    }

    // Save and load: the file round-trips, and the derived model classifies every held
    // pose of the take exactly as the trained one does.
    const file = exportCategorizer(categorizerFromModel(named, points, { name: 'my faces', mode: 'reject', modality: 'face' }));
    const back = importCategorizer(file);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const derived = modelFromCategorizer(back.categorizer);
    expect(derived.categories.map((c) => c.label)).toEqual(named.categories.map((c) => c.label));
    for (const p of points) {
      const a = classify(named, p.vector);
      const b = classify(derived, p.vector);
      expect(b.categoryId).toBe(a.categoryId);
      expect(b.distance).toBeCloseTo(a.distance, 9);
    }

    // Re-carve at k=4 from scratch and carry the names: the smile keeps "happy".
    const k4 = session.retrain(4);
    const carried = applyLabels(k4, carryLabels(named, k4));
    expect(carried.categories.find((c) => c.members.includes(smileIdx))!.label).toBe('happy');
  });

  it('a new session merges into the saved model: ids and labels kept, each new pose in its nearest merged category', () => {
    const session = trained();
    const points = session.points();
    const model = session.retrain(3);
    const named = applyLabels(model, matchLabels(model.categories, generalFaceLabeling()));
    const saved = categorizerFromModel(named, points, { name: 'my faces', mode: 'reject', modality: 'face' });
    const before = modelFromCategorizer(saved);

    // A second session: the still-points of 10.9-13.6 s (a smile held while the phone moves
    // in and out, the README's dolly), sampled the way a session samples.
    const sampler = createStillPointSampler({ noise: session.noise(), features: session.features(), cue: 'your-faces' });
    for (const { v, t } of range(10.9, 13.6)) sampler.push(v, t);
    const fresh = sampler.points().map((p, i) => ({ ...p, id: `take-2:${i}` }));
    expect(fresh.length).toBeGreaterThan(0);

    const merged = mergeSession(saved, fresh);
    expect(merged.converged).toBe(true);
    expect(merged.categorizer.categories.map((c) => [c.id, c.label])).toEqual(saved.categories.map((c) => [c.id, c.label]));
    expect(merged.categorizer.samples).toHaveLength(points.length + fresh.length);
    const after = modelFromCategorizer(merged.categorizer);
    // Converged, the merge is a fixed point: each new pose sits in the category whose MOVED
    // centroid is nearest, or beyond the saved reject radius of every one. (Not necessarily
    // where the saved model first read it: other new poses move the centroids, the point.)
    fresh.forEach((p, i) => {
      const joined = merged.assigned[i];
      const read = classify(after, p.vector);
      if (joined >= 0) expect(read.categoryId).toBe(after.categories[joined].id);
      else expect(read.distance).toBeGreaterThan(before.rejectRadius);
    });
    expect(after.rejectRadius).toBeGreaterThanOrEqual(before.rejectRadius);
  });
});

describe('the general model scores the face-expressions recording', () => {
  // `video_face_expressions`: neutral (frames 0-12), a smile (20-60), a smile with the
  // mouth open (66-96). Each segment's mean, in catalog ids, stands for a category.
  const frames = loadStream('video_face_expressions', 'face.blendshapes') as { present: boolean; blendshapes: Record<string, number> }[];
  const segment = (from: number, to: number): FeatureVector => {
    const out: FeatureVector = {};
    for (const [id, name] of Object.entries(BLENDSHAPE_NAME_BY_FEATURE)) {
      let s = 0;
      for (let i = from; i <= to; i++) s += frames[i].blendshapes[name] ?? 0;
      out[id] = s / (to - from + 1);
    }
    return out;
  };

  it('the smile is "happy", the open smile takes another label, neutral earns none', () => {
    const cats = [cat('neutral', segment(0, 12)), cat('smile', segment(20, 60)), cat('open', segment(66, 96))];
    const m = matchLabels(cats, { ...generalFaceLabeling(), fallback: (i) => `expression ${i + 1}` });
    expect(m[0]).toMatchObject({ label: 'expression 1', source: 'fallback' });
    expect(m[1].label).toBe('happy');
    expect(m[2].source).toBe('matched');
    expect(m[2].label).not.toBe('happy');
  });
});
