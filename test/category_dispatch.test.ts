/**
 * Category dispatch (#160): a saved category's entry runs its bound command through the
 * registry, under the same refusals as a gesture; and the saved-categories store keeps the
 * model durable, carries bindings across a retrain, and claims the model's feature groups.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ok, err, type Result } from 'acture';
import { createInMemoryProvider } from '@zodal/store';
import { trainModel, type FeatureVector, type TrainedModel } from '@thoremin/sdk/enroll';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { createCategoryDispatcher, readCategoryLive, resetCategoryLive, type CategoryDispatcherDeps } from '@/app/enroll/categoryDispatch';
import {
  CATEGORY_DEMAND_OWNER,
  createSavedCategoriesStore,
  installCategoryDemand,
  modelGroups,
  setSavedCategoriesStore,
  useCategoryBinding,
  type SavedCategories,
} from '@/app/enroll/categoryBinding';
import { createThoreminRegistry } from '@/app/commands/registry';
import { isGestureBindable } from '@/app/gestureDispatch';

function model(): TrainedModel {
  const vectors: FeatureVector[] = [0, 0.02, 0.01, 1, 0.98, 1.01].map((x) => ({ x }));
  const m = trainModel(vectors, [[0, 1, 2], [3, 4, 5]], ['x'], { x: 1 });
  m.categories[0].label = 'low';
  m.categories[1].label = 'high';
  return m;
}

function harness(bindings: SavedCategories['categories']['bindings'], over: Partial<CategoryDispatcherDeps> = {}) {
  const set: SavedCategories = { id: 's', name: 's', createdAt: 0, categories: { model: model(), bindings } };
  let vector: FeatureVector | null = null;
  const dispatched: { command: string; args: unknown }[] = [];
  const notes: { message: string; level?: string }[] = [];
  let active: SavedCategories | null = set;
  let enabled = true;
  let hushed = false;
  const d = createCategoryDispatcher({
    getActive: () => active,
    isEnabled: () => enabled,
    holdMs: () => 0,
    isHushed: () => hushed,
    readVector: () => vector,
    hasCommand: (id) => id !== 'gone',
    commandTitle: (id) => id.toUpperCase(),
    isBindable: (id) => id !== 'instrument.load',
    dispatch: async (command, args): Promise<Result<unknown>> => {
      dispatched.push({ command, args });
      return command === 'fails' ? err('invalid_value', 'nope') : ok(undefined);
    },
    notify: (message, level) => notes.push({ message, level }),
    ...over,
  });
  let t = 0;
  const hold = (v: FeatureVector | null, frames: number) => {
    vector = v;
    for (let i = 0; i < frames; i++) d.tick((t += 33));
  };
  return {
    hold,
    dispatched,
    notes,
    set,
    setActive: (a: SavedCategories | null) => (active = a),
    setEnabled: (on: boolean) => (enabled = on),
    setHushed: (on: boolean) => (hushed = on),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createCategoryDispatcher', () => {
  beforeEach(() => resetCategoryLive());

  it('moving into a bound category dispatches its command with its args, once per entry', async () => {
    const h = harness({ 'cat-1': { command: 'dial.a.set', args: { value: 1 } }, 'cat-2': { command: 'dial.b.set' } });
    h.hold({ x: 0 }, 20);
    h.hold({ x: 1 }, 20);
    h.hold({ x: 0 }, 20);
    await flush();
    expect(h.dispatched).toEqual([
      { command: 'dial.a.set', args: { value: 1 } },
      { command: 'dial.b.set', args: undefined },
      { command: 'dial.a.set', args: { value: 1 } },
    ]);
    expect(h.notes.at(-1)).toEqual({ message: 'low → DIAL.A.SET', level: undefined });
  });

  it('an unbound category is recognised but runs nothing', async () => {
    const h = harness({ 'cat-2': { command: 'dial.b.set' } });
    h.hold({ x: 0 }, 20);
    await flush();
    expect(h.dispatched).toEqual([]);
    expect(readCategoryLive()?.scores).toMatchObject({ present: true, label: 'low' });
  });

  it('unknown and confirmation-gated commands are refused with a toast, never dispatched', async () => {
    const h = harness({ 'cat-1': { command: 'gone' }, 'cat-2': { command: 'instrument.load' } });
    h.hold({ x: 0 }, 20);
    h.hold({ x: 1 }, 20);
    await flush();
    expect(h.dispatched).toEqual([]);
    expect(h.notes.map((n) => n.level)).toEqual(['error', 'error']);
    expect(h.notes[1].message).toMatch(/confirmation/);
  });

  it('a failed dispatch is reported', async () => {
    const h = harness({ 'cat-1': { command: 'fails' } });
    h.hold({ x: 0 }, 20);
    await flush();
    expect(h.notes).toEqual([{ message: 'low: nope', level: 'error' }]);
  });

  it('off, no active set, or hushed by a trainer: nothing runs, and the held category is a fresh entry after', async () => {
    const h = harness({ 'cat-1': { command: 'dial.a.set' } });
    h.setEnabled(false);
    h.hold({ x: 0 }, 20);
    expect(readCategoryLive()).toBeNull();
    h.setEnabled(true);
    h.setHushed(true);
    h.hold({ x: 0 }, 20);
    h.setHushed(false);
    h.setActive(null);
    h.hold({ x: 0 }, 20);
    await flush();
    expect(h.dispatched).toEqual([]);
    h.setActive(h.set);
    h.hold({ x: 0 }, 20);
    await flush();
    expect(h.dispatched.map((x) => x.command)).toEqual(['dial.a.set']);
  });

  it('editing a binding while holding a category does not fire it (same model object)', async () => {
    const h = harness({});
    h.hold({ x: 0 }, 20);
    h.setActive({ ...h.set, categories: { ...h.set.categories, bindings: { 'cat-1': { command: 'dial.a.set' } } } });
    h.hold({ x: 0 }, 20);
    await flush();
    expect(h.dispatched).toEqual([]);
  });

  it('the default bindability rule is the gestures\' one: real registry, no instrument.* commands', () => {
    const registry = createThoreminRegistry();
    expect(registry.has('dial.master.volume.set')).toBe(true);
    expect(isGestureBindable('dial.master.volume.set')).toBe(true);
    expect(isGestureBindable('instrument.load')).toBe(false);
  });
});

describe('useCategoryBinding: saved categories are durable, and bindings survive a retrain', () => {
  beforeEach(() => {
    setSavedCategoriesStore(createSavedCategoriesStore(createInMemoryProvider([])));
    useCategoryBinding.setState({ saved: [], active: null, activeId: null, enabled: true });
    appFeatureDemand.reset();
  });

  it('saves, lists, binds, reloads from storage, and carries bindings by name on re-save', async () => {
    const s = useCategoryBinding.getState();
    const rec = await s.saveModel('Faces', model());
    expect(useCategoryBinding.getState().activeId).toBe(rec.id);
    expect(useCategoryBinding.getState().saved.map((x) => x.name)).toEqual(['Faces']);

    const modelRef = useCategoryBinding.getState().active!.categories.model;
    await s.setBinding('cat-2', { command: 'dial.b.set' });
    expect(useCategoryBinding.getState().active!.categories.model).toBe(modelRef);

    // A reload: drop the in-memory copy, keep the persisted id.
    useCategoryBinding.setState({ active: null });
    await useCategoryBinding.getState().load();
    expect(useCategoryBinding.getState().active?.categories.bindings).toEqual({ 'cat-2': { command: 'dial.b.set' } });

    // Retrain with the categories in the other order: "high" keeps its binding.
    const retrained = model();
    retrained.categories = [
      { ...retrained.categories[1], id: 'cat-1' },
      { ...retrained.categories[0], id: 'cat-2' },
    ];
    await s.saveModel('Faces', retrained);
    expect(useCategoryBinding.getState().active?.categories.bindings).toEqual({ 'cat-1': { command: 'dial.b.set' } });
    expect(useCategoryBinding.getState().saved).toHaveLength(1);

    await s.remove(rec.id);
    expect(useCategoryBinding.getState().active).toBeNull();
    expect(useCategoryBinding.getState().saved).toEqual([]);
  });

  it('claims the model\'s feature groups while binding is on, and releases them when off', async () => {
    const m = model();
    m.features = ['face.blendshape.jaw.open'];
    const uninstall = installCategoryDemand();
    expect(appFeatureDemand.owners()).not.toContain(CATEGORY_DEMAND_OWNER);
    await useCategoryBinding.getState().saveModel('Faces', m);
    expect(modelGroups(m).length).toBe(1);
    expect([...(appFeatureDemand.groups() ?? [])]).toEqual(modelGroups(m));
    useCategoryBinding.getState().setEnabled(false);
    expect(appFeatureDemand.owners()).not.toContain(CATEGORY_DEMAND_OWNER);
    useCategoryBinding.getState().setEnabled(true);
    expect(appFeatureDemand.owners()).toContain(CATEGORY_DEMAND_OWNER);
    uninstall();
    expect(appFeatureDemand.owners()).not.toContain(CATEGORY_DEMAND_OWNER);
  });
});
