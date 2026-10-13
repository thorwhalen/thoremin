/**
 * The pure binding layer (#160): the entry edge over the category tracker, the
 * CategoryScores adapter, carrying bindings across a retrain, and the persisted schema.
 * Ends with a fixture replay: a real recorded hand opening and closing, trained into two
 * categories, fires an entry each time the hand changes state.
 */
import { describe, it, expect } from 'vitest';
import { replayNode } from '@thoremin/dag';
import {
  BoundCategoriesSchema,
  carryBindings,
  categoryName,
  createCategoryEdge,
  hasReading,
  toCategoryScores,
  trainModel,
  type FeatureVector,
  type TrainedModel,
} from '@thoremin/sdk/enroll';
import { handFeatureVectorNode, type HandsFrame } from '@/nodes';
import { loadStream } from './helpers/fixtures';

/** Two well-separated 1-D categories on feature `x`: "low" near 0, "high" near 1. */
function twoCategoryModel(): TrainedModel {
  const vectors: FeatureVector[] = [0, 0.02, 0.04, 0.01, 1, 0.98, 1.02, 0.99].map((x) => ({ x }));
  const model = trainModel(vectors, [[0, 1, 2, 3], [4, 5, 6, 7]], ['x'], { x: 1 });
  model.categories[0].label = 'low';
  model.categories[1].label = 'high';
  return model;
}

/** Push a run of frames at 30 fps from `t0`; returns every entry fired, with its time. */
function run(edge: ReturnType<typeof createCategoryEdge>, frames: (FeatureVector | null)[], t0 = 0) {
  const fired: { id: string; t: number }[] = [];
  frames.forEach((v, i) => {
    const t = t0 + i * 33;
    const step = edge.push(v, t);
    if (step.entered) fired.push({ id: step.entered, t });
  });
  return fired;
}
const repeat = (v: FeatureVector | null, n: number) => Array.from({ length: n }, () => v);

describe('createCategoryEdge: a category entry fires once, after the hold', () => {
  it('fires on entry after the tracker commits and the hold elapses, and never again while held', () => {
    const model = twoCategoryModel();
    const edge = createCategoryEdge(model, { holdMs: 100 });
    const fired = run(edge, repeat({ x: 0 }, 60));
    expect(fired.map((f) => f.id)).toEqual(['cat-1']);
    // enterFrames (3) to commit, then >= 100 ms of hold: not on the first frame.
    expect(fired[0].t).toBeGreaterThanOrEqual(2 * 33 + 100);
  });

  it('A -> B -> A fires A twice; a flicker shorter than the tracker entry fires nothing', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0 });
    const frames = [...repeat({ x: 0 }, 10), { x: 1 }, { x: 1 }, ...repeat({ x: 0 }, 5), ...repeat({ x: 1 }, 10), ...repeat({ x: 0 }, 10)];
    expect(run(edge, frames).map((f) => f.id)).toEqual(['cat-1', 'cat-2', 'cat-1']);
  });

  it('an excursion into no-man\'s-land does not re-fire the category it returns to', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0 });
    const frames = [...repeat({ x: 0 }, 10), ...repeat({ x: 50 }, 20), ...repeat({ x: 0 }, 10)];
    expect(run(edge, frames).map((f) => f.id)).toEqual(['cat-1']);
  });

  it('a frame with no reading is not classified (an empty vector would sit at distance 0 from everything)', () => {
    const model = twoCategoryModel();
    expect(hasReading(model, {}, 0.5)).toBe(false);
    expect(hasReading(model, { other: 1 }, 0.5)).toBe(false);
    expect(hasReading(model, { x: Number.NaN }, 0.5)).toBe(false);
    expect(hasReading(model, { x: 0 }, 0.5)).toBe(true);
    const edge = createCategoryEdge(model, { holdMs: 0 });
    expect(run(edge, repeat({}, 30))).toEqual([]);
    expect(edge.push(null, 0).reading).toBeNull();
  });

  it('changing the hold does not reset what is committed (a slider drag must not re-fire)', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0 });
    expect(run(edge, repeat({ x: 0 }, 10)).length).toBe(1);
    edge.setHoldMs(500);
    expect(run(edge, repeat({ x: 0 }, 30), 1000)).toEqual([]);
  });

  it('reset makes the held category a fresh entry', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0 });
    run(edge, repeat({ x: 1 }, 10));
    edge.reset();
    expect(run(edge, repeat({ x: 1 }, 10)).map((f) => f.id)).toEqual(['cat-2']);
  });
});

describe('toCategoryScores: the generic classifier contract (#303)', () => {
  it('names the committed category and bars every category by membership', () => {
    const model = twoCategoryModel();
    const edge = createCategoryEdge(model, { holdMs: 0 });
    let step = edge.push({ x: 1 }, 0);
    for (let i = 1; i < 5; i++) step = edge.push({ x: 1 }, i * 33);
    const s = toCategoryScores(model, step.reading, 'Mine');
    expect(s).toMatchObject({ present: true, label: 'high', labels: ['low', 'high'], title: 'Mine' });
    expect(s.scores[1]).toBeGreaterThan(s.scores[0]);
    expect(s.scores[0] + s.scores[1]).toBeCloseTo(1, 6);
  });

  it('no reading is present:false with zero bars; an unnamed category is called by position', () => {
    const model = twoCategoryModel();
    model.categories[1].label = '  ';
    const s = toCategoryScores(model, null);
    expect(s).toEqual({ present: false, label: null, labels: ['low', 'category 2'], scores: [0, 0] });
    expect(categoryName(model, 'nope')).toBe('nope');
  });
});

describe('carryBindings: a retrain keeps bindings by NAME, never by position', () => {
  it('moves a binding to the new category of the same name and drops a vanished name', () => {
    const old = twoCategoryModel();
    const bindings = { 'cat-1': { command: 'a' }, 'cat-2': { command: 'b' } };
    const next = twoCategoryModel();
    // Retrained: the order flipped and "high" became "top".
    next.categories = [
      { ...next.categories[1], id: 'cat-1', label: 'top' },
      { ...next.categories[0], id: 'cat-2', label: 'low' },
    ];
    expect(carryBindings({ model: old, bindings }, next)).toEqual({ 'cat-2': { command: 'a' } });
    expect(carryBindings(null, next)).toEqual({});
  });
});

describe('BoundCategoriesSchema: a saved model round-trips as plain data', () => {
  it('parses what JSON gives back, and defaults missing bindings to none', () => {
    const model = twoCategoryModel();
    const back = BoundCategoriesSchema.parse(JSON.parse(JSON.stringify({ model })));
    expect(back.model).toEqual(model);
    expect(back.bindings).toEqual({});
    expect(BoundCategoriesSchema.safeParse({ model: { ...model, rejectRadius: 'far' } }).success).toBe(false);
  });
});

describe('fixture replay (video_hand_open_close): an open/closed hand fires an entry per change', () => {
  it('trains two categories from the recorded hand and fires alternating entries along the clip', async () => {
    const frames = loadStream('video_hand_open_close', 'src.hands') as HandsFrame[];
    const vectors = (await replayNode(handFeatureVectorNode.make(handFeatureVectorNode.params.parse({})), { hands: frames }, { dt: 1 / 30 })).map(
      (o) => o.vector as FeatureVector,
    );
    const key = Object.keys(vectors.find((v) => Object.keys(v).length) ?? {}).find((k) => k.endsWith('.openness'))!;
    const series = vectors.map((v) => v[key]).filter((x): x is number => Number.isFinite(x));
    const lo = Math.min(...series);
    const hi = Math.max(...series);
    const mid = (lo + hi) / 2;
    // The player's demonstration: the clearly closed and clearly open frames.
    const held: FeatureVector[] = series.filter((x) => Math.abs(x - mid) > (hi - lo) * 0.3).map((x) => ({ [key]: x }));
    const closed = held.map((v, i) => (v[key] < mid ? i : -1)).filter((i) => i >= 0);
    const open = held.map((v, i) => (v[key] >= mid ? i : -1)).filter((i) => i >= 0);
    expect(closed.length).toBeGreaterThan(5);
    expect(open.length).toBeGreaterThan(5);
    const model = trainModel(held, [closed, open], [key], { [key]: 1 });

    const edge = createCategoryEdge(model);
    const fired = run(edge, vectors);
    expect(fired.length).toBeGreaterThanOrEqual(3);
    // Entries alternate: a category never fires twice in a row (one entry, one fire).
    for (let i = 1; i < fired.length; i++) expect(fired[i].id).not.toBe(fired[i - 1].id);
    expect(new Set(fired.map((f) => f.id))).toEqual(new Set(['cat-1', 'cat-2']));
  });
});
