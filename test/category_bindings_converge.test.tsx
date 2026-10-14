// @vitest-environment jsdom
/**
 * #371: the category bindings converge onto the categorizers. One collection
 * (`thoremin.categorizers`) holds every categorizer and the Trainer's models; bindings ride the
 * record they name, keyed by its id; one dispatcher plays every kind.
 *
 * The migration is tested against REAL saved shapes: the old bound sets are written by the very
 * facade the old store used (`createNamedCollectionStore` over `thoremin-categories`, payload
 * `categories`), so the bytes in localStorage are the ones a player's browser holds. The pin is
 * behavioural: the migrated set fires the same commands, on the same frames, as the old one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { ok, type Result } from 'acture';
import { createInMemoryProvider } from '@zodal/store';
import { trainModel, BoundCategoriesSchema, type FeatureVector, type TrainedModel } from '@thoremin/sdk/enroll';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { liveModel } from '@thoremin/sdk/enroll/live';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { createNamedCollectionStore, localStorageCollectionProvider } from '@thoremin/sdk-ui/namedCollection';
import { createCategorizerIndex, createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { categoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import { createCategoryDispatcher } from '@/app/enroll/categoryDispatch';
import { setSavedCategoriesStore, useCategoryBinding, playable, type SavedCategories } from '@/app/enroll/categoryBinding';
import { BOUND_SETS_MIGRATED_KEY, LegacyBoundSetSchema, migrateBoundSets, SAVED_CATEGORIES_STORAGE_KEY } from '@/app/enroll/boundSets';
import { localStorageFlag } from '@thoremin/sdk-ui/enroll/categorizers';
import CategoryBindings from '@/app/enroll/CategoryBindings';
import { useTools } from '@/app/toolsStore';

/** The demo face categorizer (smile, open smile; Neutral taught). */
function demo(): PersonalCategorizer {
  const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!file.ok) throw new Error(file.error);
  return file.categorizer;
}

/** The Trainer's kind of model: two categories over one feature. */
function trainerModel(): TrainedModel {
  const vectors: FeatureVector[] = [0, 0.02, 0.01, 1, 0.98, 1.01].map((x) => ({ x }));
  const m = trainModel(vectors, [[0, 1, 2], [3, 4, 5]], ['x'], { x: 1 });
  m.categories = m.categories.map((c, i) => ({ ...c, id: `cat-${i + 1}`, label: ['low', 'high'][i] }));
  return m;
}

/** The old store's facade, exactly as main had it before #371: what wrote a player's bound sets. */
const oldBoundSets = () =>
  createNamedCollectionStore({
    schema: LegacyBoundSetSchema,
    storageKey: SAVED_CATEGORIES_STORAGE_KEY,
    payloadKey: 'categories',
    idFallback: 'categories',
  })();

/** Frames that hold each of the face categorizer's categories in turn, with its Neutral between. */
function faceTake(c: PersonalCategorizer): FeatureVector[] {
  const vec = (id: string) => c.samples.find((s) => s.id === id)!.vector;
  const rest = c.neutral.slice(0, 1).map(vec);
  const out: FeatureVector[] = [];
  const hold = (v: FeatureVector) => {
    for (let f = 0; f < 20; f++) out.push(v);
  };
  for (const cat of c.categories) {
    for (const m of cat.members.slice(0, 3)) {
      hold(rest[0]);
      hold(vec(m));
    }
  }
  return out;
}

const trainerTake = (): FeatureVector[] => [0, 1, 0, 1, 0].flatMap((x) => Array.from({ length: 20 }, () => ({ x })));

/** The commands a set fires over `frames` (binding on, no hold, everything bindable). */
function fired(set: SavedCategories, frames: readonly FeatureVector[]): string[] {
  let vector: FeatureVector | null = null;
  const out: string[] = [];
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
      out.push(command);
      return ok(undefined);
    },
    notify: () => {},
  });
  frames.forEach((v, i) => {
    vector = v;
    d.tick(1000 + i * 33);
  });
  return out;
}

/** The bound set as the old dispatcher played it (the record's `categories`, no tuning). */
const oldSet = (r: { id: string; name: string; createdAt: number; categories: unknown }): SavedCategories => ({ id: r.id, name: r.name, createdAt: r.createdAt, categories: BoundCategoriesSchema.parse(r.categories) });

beforeEach(() => {
  localStorage.clear();
  setSavedCategoriesStore(null);
  useCategoryBinding.setState({ saved: [], active: null, activeId: null, enabled: true, holdMs: 0 });
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
});
afterEach(() => {
  cleanup();
  setSavedCategoriesStore(null);
});

describe('#371 migration of the old bound sets (real saved shapes)', () => {
  it("the Trainer's set becomes a trained record that fires the same commands; the old key is kept; the active set follows", async () => {
    const legacy = await oldBoundSets().save('My categories', { model: trainerModel(), bindings: { 'cat-1': { command: 'transport.stop' }, 'cat-2': { command: 'transport.toggle' } } });
    expect(legacy.id).toBe('my-categories');
    useCategoryBinding.setState({ activeId: legacy.id });
    const before = localStorage.getItem(SAVED_CATEGORIES_STORAGE_KEY);

    await useCategoryBinding.getState().load();

    const active = useCategoryBinding.getState().active!;
    expect(useCategoryBinding.getState().activeId).toBe('trained:my-categories');
    expect(active.kind).toBe('trained');
    expect(active.categories.model).toEqual(legacy.categories.model);
    expect(active.categories.bindings).toEqual(legacy.categories.bindings);
    const want = fired(oldSet(legacy), trainerTake());
    expect(want).toEqual(['transport.toggle', 'transport.stop', 'transport.toggle', 'transport.stop']); // the first rest is adopted, not fired
    expect(fired(active, trainerTake())).toEqual(want);
    // The migrate step leaves the old collection readable (#385 E10 removes it).
    expect(localStorage.getItem(SAVED_CATEGORIES_STORAGE_KEY)).toBe(before);
    expect(localStorage.getItem(BOUND_SETS_MIGRATED_KEY)).toBe('1');
  });

  it('a bound copy of a face categorizer that is still saved: its bindings move onto the categorizer, no copy is kept, the same commands fire', async () => {
    const c = demo();
    const faces = createCategorizerStore(faceModality);
    const rec = await faces.save('Smiles', { categorizer: c });
    // What `bindSaved` handed the old binder (#385 E8): the live model, read through the face.
    const copy = await oldBoundSets().save('Smiles', {
      model: liveModel(rec.model.categorizer, {}).model,
      bindings: { 'cat-1': { command: 'transport.toggle' }, 'cat-2': { command: 'transport.stop' } },
      read: { modality: 'face' },
    });
    useCategoryBinding.setState({ activeId: copy.id });

    await useCategoryBinding.getState().load();

    const active = useCategoryBinding.getState().active!;
    expect(active.id).toBe(rec.id); // the categorizer itself
    expect(active.kind).toBe('face');
    expect(active.categories.bindings).toEqual(copy.categories.bindings);
    expect(useCategoryBinding.getState().saved.map((s) => s.kind)).toEqual(['face']);
    const want = fired(oldSet(copy), faceTake(c));
    expect(want.length).toBeGreaterThan(2);
    expect(fired(active, faceTake(c))).toEqual(want);
    // On the record, not in the exported file.
    const stored = await faces.load(rec.id);
    expect(stored!.model.bindings).toEqual(copy.categories.bindings);
    expect('bindings' in stored!.model.categorizer).toBe(false);
  });

  it('a copy whose categorizer was deleted, or renamed a bound category, is kept as a trained record that fires as before', async () => {
    const c = demo();
    // Deleted: never saved in the new collection.
    const gone = await oldBoundSets().save('Gone', { model: liveModel(c, {}).model, bindings: { 'cat-1': { command: 'transport.toggle' } }, read: { modality: 'face' } });
    // Renamed: "smile" is now "grin", so the binding on "smile" cannot be carried.
    const faces = createCategorizerStore(faceModality);
    await faces.save('Renamed', { categorizer: { ...c, categories: c.categories.map((k) => (k.label === 'smile' ? { ...k, label: 'grin' } : k)) } });
    const renamed = await oldBoundSets().save('Renamed', { model: liveModel(c, {}).model, bindings: { 'cat-1': { command: 'transport.stop' } }, read: { modality: 'face' } });

    await useCategoryBinding.getState().load();

    const kinds = Object.fromEntries(useCategoryBinding.getState().saved.map((s) => [s.id, s.kind]));
    expect(kinds).toEqual({ 'trained:gone': 'trained', 'trained:renamed': 'trained', renamed: 'face' });
    for (const legacy of [gone, renamed]) {
      await useCategoryBinding.getState().activate(`trained:${legacy.id}`);
      const active = useCategoryBinding.getState().active!;
      expect(active.categories.read).toEqual({ modality: 'face' });
      const want = fired(oldSet(legacy), faceTake(c));
      expect(want.length).toBeGreaterThan(0);
      expect(fired(active, faceTake(c))).toEqual(want);
    }
    // The categorizer the copy could not take over is left unbound.
    expect((await faces.load('renamed'))!.model.bindings).toBeUndefined();
  });

  it('runs once: a migrated set the player deletes is not migrated back', async () => {
    const index = createCategorizerIndex({ provider: createInMemoryProvider<CategorizerRecord>([]) });
    const legacy = localStorageCollectionProvider(SAVED_CATEGORIES_STORAGE_KEY);
    await oldBoundSets().save('Once', { model: trainerModel(), bindings: {} });
    const flag = localStorageFlag(BOUND_SETS_MIGRATED_KEY);
    expect([...(await migrateBoundSets(index, legacy as never, flag))]).toEqual([['once', 'trained:once']]);
    await index.remove('trained:once');
    expect((await migrateBoundSets(index, legacy as never, flag)).size).toBe(0);
    expect(await index.list()).toEqual([]);
  });
});

describe('#371 bindings keyed by categorizer id', () => {
  it('a tool binds by id; a re-cut that renumbers the categories keeps each binding on its name, and the dispatcher plays the edit', async () => {
    const c = demo();
    const faces = createCategorizerStore(faceModality);
    const rec = await faces.save('Smiles', { categorizer: c });
    await categoryBinder()!.bind({ id: rec.id });
    expect(useCategoryBinding.getState().active!.id).toBe(rec.id);
    const smile = c.categories.find((k) => k.label === 'smile')!.id;
    await useCategoryBinding.getState().setBinding(smile, { command: 'transport.toggle' });

    // The tool re-saves it with the categories in the other order and new ids (a re-cut).
    const swapped = { ...c, categories: [...c.categories].reverse().map((k, i) => ({ ...k, id: `cut-${i + 1}` })) };
    const { withChangeNotice } = await import('@thoremin/sdk-ui/enroll/categorizers');
    await withChangeNotice(faces).save('Smiles', { categorizer: swapped });

    const newSmile = swapped.categories.find((k) => k.label === 'smile')!.id;
    await waitFor(() => expect(useCategoryBinding.getState().active!.categories.bindings).toEqual({ [newSmile]: { command: 'transport.toggle' } }));
    const active = useCategoryBinding.getState().active!;
    expect(active.categories.model.categories.map((k) => k.id)).toEqual(['cut-1', 'cut-2']);
    expect(fired(active, faceTake(swapped)).length).toBeGreaterThan(0);
  });

  it('a binding edit keeps the model object (the tracker survives), and a re-save that leaves the model as it was keeps it too', async () => {
    const faces = createCategorizerStore(handModality);
    const c = { ...demo(), modality: 'hand' };
    const rec = await faces.save('Shapes', { categorizer: c });
    await useCategoryBinding.getState().activate(rec.id);
    const model = useCategoryBinding.getState().active!.categories.model;
    await useCategoryBinding.getState().setBinding('cat-1', { command: 'transport.toggle' });
    expect(useCategoryBinding.getState().active!.categories.model).toBe(model);
    const { withChangeNotice } = await import('@thoremin/sdk-ui/enroll/categorizers');
    await withChangeNotice(faces).save('Shapes', { categorizer: c });
    await new Promise((r) => setTimeout(r, 0));
    expect(useCategoryBinding.getState().active!.categories.model).toBe(model);
    expect(useCategoryBinding.getState().active!.categories.bindings).toEqual({ 'cat-1': { command: 'transport.toggle' } });
  });

  it("a carved categorizer is played under its saved tuning: sizes and radius in the model, sensitivity on each frame (#453)", async () => {
    const c = demo();
    const plain = playable({ id: 'a', name: 'a', createdAt: 0, model: { categorizer: c } });
    expect(plain.tune).toBeUndefined();
    expect(plain.categories.model).toEqual(liveModel(c, {}).model);
    const tuned = playable({ id: 'a', name: 'a', createdAt: 0, model: { categorizer: c, tuning: { sensitivity: 1.5, rejectScale: 1, distance: 0, sizes: {} } } });
    expect(tuned.tune).toBeDefined();
    const v = c.samples[0].vector;
    expect(tuned.tune!(v)).not.toEqual(v);
  });
});

describe('#371 the Gestures tool lists every categorizer', () => {
  it('the Trainer\'s models and every carved kind, grouped; Delete only for a Trainer model', async () => {
    const c = demo();
    await createCategorizerStore(faceModality).save('Smiles', { categorizer: c });
    await createCategorizerStore(handModality).save('Fists', { categorizer: { ...c, modality: 'hand' } });
    await useCategoryBinding.getState().saveModel('Mine', trainerModel());
    render(<CategoryBindings />);
    const picker = (await screen.findByLabelText('Active categories')) as HTMLSelectElement;
    await waitFor(() => expect(picker.querySelectorAll('optgroup').length).toBe(3));
    const groups = [...picker.querySelectorAll('optgroup')].map((g) => [g.label, [...g.querySelectorAll('option')].map((o) => o.textContent)]);
    expect(groups).toEqual([
      ['From the Trainer', ['Mine']],
      ['Your faces', ['Smiles']],
      ['Your hand shapes', ['Fists']],
    ]);
    const section = screen.getByRole('region', { name: 'Your categories' });
    expect(within(section).getByRole('button', { name: 'Delete the saved categories Mine' })).toBeTruthy();
    await useCategoryBinding.getState().activate('hand:fists');
    await waitFor(() => expect(within(section).getByText(/Made in Your hand shapes/)).toBeTruthy());
    expect(within(section).queryByRole('button', { name: /Delete the saved categories/ })).toBeNull();
  });
});
