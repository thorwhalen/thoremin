/**
 * Personal categorizers (#391 item 7): names that collide with built-in object properties,
 * the import's guards (duplicate features, a migration that changes `format`), and the
 * dispatcher's lookup of a category id.
 *
 * A label `constructor`, a cue `toString` or a category id `constructor` reads as PRESENT
 * on any plain `{}` (it is inherited), so a lookup written `out[name] ?? 0` returns a
 * function. The cases named after #393 item 7 guard those lookups, which now read own keys
 * only; the ones named after #393's lower "#338: imported categorizers have no size
 * limits" guard the import's bounds and its refusal of a feature listed twice.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ok, type Result } from 'acture';
import { createInMemoryProvider } from '@zodal/store';
import {
  CATEGORIZER_FORMAT,
  CATEGORIZER_VERSION,
  MAX_CATEGORIZER_FEATURES,
  MAX_CATEGORIZER_SAMPLES,
  carryLabels,
  exportCategorizer,
  importCategorizer,
  modelFromCategorizer,
  trainModel,
  TrainedModelSchema,
  type FeatureVector,
  type PersonalCategorizer,
  type TrainedModel,
} from '@thoremin/sdk/enroll';
import { createCategoryDispatcher, resetCategoryLive } from '@/app/enroll/categoryDispatch';
import { createSavedCategoriesStore, setSavedCategoriesStore, useCategoryBinding, type SavedCategories } from '@/app/enroll/categoryBinding';

/** Two well-separated categories over two features; ids, labels and cues chosen by the caller. */
function file(over: { ids?: [string, string]; labels?: [string, string]; cue?: string } = {}): PersonalCategorizer {
  const [id1, id2] = over.ids ?? ['cat-1', 'cat-2'];
  const [l1, l2] = over.labels ?? ['rest', 'up'];
  const cue = over.cue ?? 'faces';
  return {
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    neutralTrained: true,
    name: 'odd names',
    features: ['x', 'y'],
    weights: { x: 1, y: 1 },
    strangers: 'neutral',
    rejectRadius: 0.5,
    samples: [
      { id: 's-0', vector: { x: 0, y: 0 }, t: 0, cue },
      { id: 's-1', vector: { x: 0.1, y: 0 }, t: 1, cue },
      { id: 's-2', vector: { x: 0, y: 0.1 }, t: 2, cue },
      { id: 's-3', vector: { x: 1, y: 1 }, t: 3, cue },
      { id: 's-4', vector: { x: 1.1, y: 0.9 }, t: 4, cue },
    ],
    categories: [
      { id: id1, label: l1, members: ['s-0', 's-1', 's-2'] },
      { id: id2, label: l2, members: ['s-3', 's-4'] },
    ],
    neutral: [],
  };
}

/** A fresh carve of the same poses, in the other order and unnamed. */
function freshCarve(): TrainedModel {
  const vectors: FeatureVector[] = [
    { x: 1, y: 1 },
    { x: 1.05, y: 0.95 },
    { x: 0, y: 0 },
    { x: 0.05, y: 0.05 },
  ];
  return trainModel(vectors, [[0, 1], [2, 3]], ['x', 'y'], { x: 1, y: 1 }, { defaultRejectRadius: 0.5 });
}

describe('carryLabels: an old name that is a built-in property', () => {
  it('carries ordinary names one-to-one (the baseline)', () => {
    const old = modelFromCategorizer(file());
    expect(carryLabels(old, freshCarve()).map((m) => m.label)).toEqual(['up', 'rest']);
  });

  it('carries "constructor" and "toString" like any other name (#393 item 7)', () => {
    const old = modelFromCategorizer(file({ labels: ['constructor', 'toString'] }));
    const matches = carryLabels(old, freshCarve());
    expect(matches.map((m) => [m.label, m.source])).toEqual([
      ['toString', 'matched'],
      ['constructor', 'matched'],
    ]);
    for (const m of matches) expect(Number.isFinite(m.score)).toBe(true);
  });
});

describe('modelFromCategorizer: a cue that is a built-in property', () => {
  it('counts a cue "toString" as a number, so the derived model persists (#393 item 7)', () => {
    const model = modelFromCategorizer(file({ cue: 'toString' }));
    expect(model.categories[0].cues).toEqual({ toString: 3 });
    expect(model.categories[1].cues).toEqual({ toString: 2 });
    expect(TrainedModelSchema.safeParse(model).success).toBe(true);
  });
});

describe('importCategorizer: what a file may not carry', () => {
  it('refuses (or de-duplicates) duplicate `features` entries, which would double their weight (#393 lower: #338 no size limits)', () => {
    const c = file();
    const r = importCategorizer({ ...c, features: ['x', 'x', 'y'] });
    if (r.ok) expect(new Set(r.categorizer.features).size).toBe(r.categorizer.features.length);
    else expect(r.error).toMatch(/feature/i);
    // Either way the derived model cannot weigh x twice.
    if (r.ok) expect(modelFromCategorizer(r.categorizer).features).toEqual(['x', 'y']);
  });

  it('refuses a file over the size limits on samples and features (#393 lower: #338 no size limits)', () => {
    const c = file();
    const samples = Array.from({ length: MAX_CATEGORIZER_SAMPLES + 1 }, (_, i) => ({ ...c.samples[i % c.samples.length], id: i < c.samples.length ? c.samples[i].id : `x-${i}`, t: i }));
    // The extra holds are set aside (every sample is somewhere).
    const aside = (n: number) => samples.slice(c.samples.length, n).map((x) => x.id);
    const many = importCategorizer({ ...c, samples, aside: aside(samples.length) });
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.error).toMatch(/^invalid categorizer: samples:/);
    const features = Array.from({ length: MAX_CATEGORIZER_FEATURES + 1 }, (_, i) => `f${i}`);
    const wide = importCategorizer({ ...c, features });
    expect(wide.ok).toBe(false);
    if (!wide.ok) expect(wide.error).toMatch(/^invalid categorizer: features:/);
    // At the limit it reads.
    expect(importCategorizer({ ...c, samples: samples.slice(0, MAX_CATEGORIZER_SAMPLES), aside: aside(MAX_CATEGORIZER_SAMPLES) }).ok).toBe(true);
  });

  it('a migration that changes `format` is refused by the final validation, saying where', () => {
    const v0 = { ...file(), version: 0 };
    const migrations = {
      0: (d: Record<string, unknown>) => ({ ...d, version: 1 }),
      1: (d: Record<string, unknown>) => ({ ...d, version: 2, format: 'thoremin.categorizer.v2' }),
      2: (d: Record<string, unknown>) => ({ ...d, version: 3 }),
    };
    const r = importCategorizer(v0, { migrations });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^invalid categorizer: format:/);
    // The same chain with the format kept reads the file.
    const keep = importCategorizer(v0, { migrations: { 0: migrations[0], 1: (d: Record<string, unknown>) => ({ ...d, version: 2 }), 2: migrations[2] } });
    expect(keep).toEqual({ ok: true, categorizer: file(), migratedFrom: 0 });
  });
});

describe('the category dispatcher: a category id that is a built-in property', () => {
  beforeEach(() => resetCategoryLive());

  function run(ids: [string, string]) {
    const model = modelFromCategorizer(file({ ids }));
    const set: SavedCategories = { id: 's', name: 's', createdAt: 0, categories: { model, bindings: {} } };
    const dispatched: string[] = [];
    const notes: string[] = [];
    let vector: FeatureVector | null = null;
    const d = createCategoryDispatcher({
      getActive: () => set,
      isEnabled: () => true,
      isPreviewing: () => false,
      holdMs: () => 0,
      isHushed: () => false,
      readVector: () => vector,
      hasCommand: () => true,
      commandTitle: (id) => id,
      isBindable: () => true,
      dispatch: async (command): Promise<Result<unknown>> => {
        dispatched.push(command);
        return ok(undefined);
      },
      notify: (message) => notes.push(message),
    });
    let t = 0;
    const hold = (v: FeatureVector, frames: number) => {
      vector = v;
      for (let i = 0; i < frames; i++) d.tick((t += 33));
    };
    hold({ x: 50, y: 50 }, 5); // the rest pose, far from both
    hold({ x: 0, y: 0 }, 10); // into the first category, which is unbound
    return { dispatched, notes };
  }

  it('an unbound category runs nothing and says nothing (the baseline)', async () => {
    const r = run(['cat-1', 'cat-2']);
    await Promise.resolve();
    expect(r).toEqual({ dispatched: [], notes: [] });
  });

  it('an unbound category whose id is "constructor" runs nothing and says nothing (#393 item 7)', async () => {
    const r = run(['constructor', 'cat-2']);
    await Promise.resolve();
    expect(r).toEqual({ dispatched: [], notes: [] });
  });
});

describe('a categorizer with built-in names: import, save, load, bind (round trip)', () => {
  beforeEach(() => {
    setSavedCategoriesStore(createSavedCategoriesStore(createInMemoryProvider([])));
    useCategoryBinding.setState({ saved: [], active: null, activeId: null, enabled: true });
  });

  it('round-trips ordinary names (the baseline)', async () => {
    const r = importCategorizer(exportCategorizer(file()));
    if (!r.ok) throw new Error(r.error);
    await useCategoryBinding.getState().saveModel('Plain', modelFromCategorizer(r.categorizer));
    await useCategoryBinding.getState().setBinding('cat-1', { command: 'dial.a.set' });
    useCategoryBinding.setState({ active: null });
    await useCategoryBinding.getState().load();
    expect(useCategoryBinding.getState().active?.categories.bindings).toEqual({ 'cat-1': { command: 'dial.a.set' } });
  });

  it('label "constructor", cue "toString", category id "constructor": saves, loads and binds (#393 item 7)', async () => {
    const c = file({ ids: ['constructor', 'cat-2'], labels: ['constructor', 'up'], cue: 'toString' });
    const r = importCategorizer(exportCategorizer(c));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const model = modelFromCategorizer(r.categorizer);
    await useCategoryBinding.getState().saveModel('Odd', model);
    await useCategoryBinding.getState().setBinding('constructor', { command: 'dial.a.set' });
    useCategoryBinding.setState({ active: null });
    await useCategoryBinding.getState().load();
    const back = useCategoryBinding.getState().active!.categories;
    expect(back.model.categories.map((x) => [x.id, x.label, x.cues])).toEqual([
      ['constructor', 'constructor', { toString: 3 }],
      ['cat-2', 'up', { toString: 2 }],
    ]);
    expect(back.bindings).toEqual({ constructor: { command: 'dial.a.set' } });
  });
});
