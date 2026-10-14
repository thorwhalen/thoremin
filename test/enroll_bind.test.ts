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
  rekeyBindings,
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

/** The rest pose: far from both categories (no-man's-land, as the baseline cue makes it). */
const REST: FeatureVector = { x: 50 };

describe('createCategoryEdge: a category entry fires once, after the hold', () => {
  it('fires on entry after the tracker commits and the hold elapses, and never again while held', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 100 });
    const fired = run(edge, [...repeat(REST, 10), ...repeat({ x: 0 }, 60)]);
    expect(fired.map((f) => f.id)).toEqual(['cat-1']);
    // enterFrames (3) to commit, then >= 100 ms ON it: not on the first frame of the pose.
    expect(fired[0].t).toBeGreaterThanOrEqual(10 * 33 + 2 * 33 + 100);
  });

  it('A -> B -> A fires A twice; a flicker shorter than the tracker entry fires nothing', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0, cooldownMs: 0 });
    const frames = [REST, ...repeat({ x: 0 }, 10), { x: 1 }, { x: 1 }, ...repeat({ x: 0 }, 5), ...repeat({ x: 1 }, 10), ...repeat({ x: 0 }, 10)];
    expect(run(edge, frames).map((f) => f.id)).toEqual(['cat-1', 'cat-2', 'cat-1']);
  });

  it('A -> rest -> A fires A twice (the rest pose is no-man\'s-land); a blink shorter than the exit hysteresis does not', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0, cooldownMs: 0 });
    const blink = [REST, ...repeat({ x: 0 }, 10), ...repeat(REST, 3), ...repeat({ x: 0 }, 10)];
    expect(run(edge, blink).map((f) => f.id)).toEqual(['cat-1']);
    edge.reset();
    const rest = [REST, ...repeat({ x: 0 }, 10), ...repeat(REST, 20), ...repeat({ x: 0 }, 10)];
    expect(run(edge, rest).map((f) => f.id)).toEqual(['cat-1', 'cat-1']);
  });

  it('the hold is time ON the category: three frames of A and away again fire nothing', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 150 });
    expect(run(edge, [REST, ...repeat({ x: 0 }, 3), ...repeat(REST, 30)])).toEqual([]);
  });

  it('a gap with no reading breaks the hold: A, the face lost, then B never fires A late', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 150 });
    const fired = run(edge, [REST, ...repeat({ x: 0 }, 3), ...repeat(null, 20), ...repeat({ x: 1 }, 20)]);
    expect(fired.map((f) => f.id)).toEqual(['cat-2']);
  });

  it('a fresh or reset edge ADOPTS the category the player is already in (enabling arms future entries)', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0 });
    expect(run(edge, repeat({ x: 1 }, 20))).toEqual([]);
    expect(edge.current()).toBe('cat-2');
    expect(run(edge, repeat({ x: 0 }, 20)).map((f) => f.id)).toEqual(['cat-1']);
    edge.reset();
    expect(run(edge, repeat({ x: 0 }, 20))).toEqual([]);
  });

  it('a re-entry of the same category inside the cooldown is spent silently', () => {
    const edge = createCategoryEdge(twoCategoryModel(), { holdMs: 0, cooldownMs: 2000 });
    const frames = [REST, ...repeat({ x: 0 }, 5), ...repeat(REST, 12), ...repeat({ x: 0 }, 5)];
    expect(run(edge, frames).map((f) => f.id)).toEqual(['cat-1']);
  });

  it('a frame with no reading is not classified (a sparse vector would sit close to everything)', () => {
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
    expect(run(edge, [REST, ...repeat({ x: 0 }, 10)]).length).toBe(1);
    edge.setHoldMs(500);
    expect(run(edge, repeat({ x: 0 }, 30), 1000)).toEqual([]);
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

  it('a name two categories share is ambiguous and carries nothing', () => {
    const old = twoCategoryModel();
    old.categories[1].label = 'low';
    const next = twoCategoryModel();
    expect(carryBindings({ model: old, bindings: { 'cat-1': { command: 'a' } } }, next)).toEqual({});
    const fresh = twoCategoryModel();
    const dup = twoCategoryModel();
    dup.categories[1].label = 'low';
    expect(carryBindings({ model: fresh, bindings: { 'cat-1': { command: 'a' } } }, dup)).toEqual({});
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

describe('rekeyBindings: an edit keeps bindings by id-and-name, then by name (#371)', () => {
  const cats = (...xs: [string, string][]) => ({ categories: xs.map(([id, label]) => ({ id, label })) });
  it('an unnamed category keeps its binding while the edit leaves it as it was', () => {
    const before = cats(['c1', ''], ['c2', 'fist']);
    expect(rekeyBindings(before, { c1: { command: 'a' }, c2: { command: 'b' } }, before)).toEqual({ c1: { command: 'a' }, c2: { command: 'b' } });
  });
  it('a renumbered category keeps its binding by name; a renamed one loses it', () => {
    const before = cats(['c1', 'open'], ['c2', 'fist']);
    const after = cats(['c1', 'fist'], ['c2', 'flat']);
    expect(rekeyBindings(before, { c1: { command: 'a' }, c2: { command: 'b' } }, after)).toEqual({ c1: { command: 'b' } });
  });
});
