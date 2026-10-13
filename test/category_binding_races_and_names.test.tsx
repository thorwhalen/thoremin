// @vitest-environment jsdom
/**
 * Saved categories and their bindings (#391 item 7, #160/#327): two activations that
 * overlap, a corrupt persisted hold, the Trainer's save-name warning, and a category id
 * that is a built-in object property, in the panel the player binds it in.
 *
 * The `it.fails` cases pin defects named in #393 ("#327: two category bindings and the
 * save name", item 7 for the `constructor` id); each flips to `it` when fixed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { trainModel, type FeatureVector, type TrainedModel } from '@thoremin/sdk/enroll';
import TrainerPanel from '@/app/TrainerPanel';
import GesturesPanel from '@/app/GesturesPanel';
import { useTools } from '@/app/toolsStore';
import { useTrainer } from '@/app/enroll/store';
import { useTrainerPrefs } from '@/app/enroll/prefs';
import {
  CATEGORY_PREFS_STORAGE_KEY,
  MAX_CATEGORY_HOLD_MS,
  createSavedCategoriesStore,
  setSavedCategoriesStore,
  useCategoryBinding,
  type SavedCategoriesStore,
} from '@/app/enroll/categoryBinding';

function model(ids: [string, string] = ['cat-1', 'cat-2'], labels: [string, string] = ['', '']): TrainedModel {
  const vectors: FeatureVector[] = [0, 0.02, 0.01, 1, 0.98, 1.01].map((x) => ({ x }));
  const m = trainModel(vectors, [[0, 1, 2], [3, 4, 5]], ['x'], { x: 1 });
  m.categories = m.categories.map((c, i) => ({ ...c, id: ids[i], label: labels[i] }));
  return m;
}

/** A store whose `load` of the ids in `slow` waits until `release()`. */
function gatedStore(inner: SavedCategoriesStore, slow: string[]) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const store: SavedCategoriesStore = {
    list: () => inner.list(),
    save: (name, payload, now) => inner.save(name, payload, now),
    remove: (id) => inner.remove(id),
    load: async (id) => {
      if (slow.includes(id)) await gate;
      return inner.load(id);
    },
  };
  return { store, release };
}

let inner: SavedCategoriesStore;
beforeEach(() => {
  inner = createSavedCategoriesStore(createInMemoryProvider([]));
  setSavedCategoriesStore(inner);
  useCategoryBinding.setState({ saved: [], active: null, activeId: null, enabled: true, holdMs: 0 });
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  useTrainer.getState().reset();
  useTrainerPrefs.setState({ recordTake: false, manualAdvance: false });
  localStorage.clear();
});
afterEach(cleanup);

describe('useCategoryBinding.activate: the one requested last wins', () => {
  it('two sequential activations end on the second (the baseline)', async () => {
    const a = await useCategoryBinding.getState().saveModel('A', model());
    const b = await useCategoryBinding.getState().saveModel('B', model());
    await useCategoryBinding.getState().activate(a.id);
    await useCategoryBinding.getState().activate(b.id);
    expect(useCategoryBinding.getState().activeId).toBe(b.id);
    expect(useCategoryBinding.getState().active?.name).toBe('B');
  });

  it.fails('a slow activate(A) then a fast activate(B) ends on B (#393 lower: #327 two category bindings)', async () => {
    const a = await useCategoryBinding.getState().saveModel('A', model());
    const b = await useCategoryBinding.getState().saveModel('B', model());
    const { store, release } = gatedStore(inner, [a.id]);
    setSavedCategoriesStore(store);
    const slow = useCategoryBinding.getState().activate(a.id);
    await useCategoryBinding.getState().activate(b.id);
    expect(useCategoryBinding.getState().activeId).toBe(b.id);
    release();
    await slow;
    expect(useCategoryBinding.getState().activeId).toBe(b.id);
    expect(useCategoryBinding.getState().active?.name).toBe('B');
  });

  it.fails('a slow activate(A) then activate(null) ends on none (#393 lower: #327 two category bindings)', async () => {
    const a = await useCategoryBinding.getState().saveModel('A', model());
    useCategoryBinding.setState({ active: null, activeId: null });
    const { store, release } = gatedStore(inner, [a.id]);
    setSavedCategoriesStore(store);
    const slow = useCategoryBinding.getState().activate(a.id);
    await useCategoryBinding.getState().activate(null);
    release();
    await slow;
    expect(useCategoryBinding.getState().activeId).toBeNull();
    expect(useCategoryBinding.getState().active).toBeNull();
  });
});

describe('useCategoryBinding: the persisted hold is validated on rehydrate', () => {
  const persisted = (holdMs: unknown) =>
    localStorage.setItem(CATEGORY_PREFS_STORAGE_KEY, JSON.stringify({ state: { activeId: null, enabled: true, holdMs }, version: 0 }));

  it('a sane persisted hold is restored as saved (the baseline)', async () => {
    persisted(250);
    await useCategoryBinding.persist.rehydrate();
    expect(useCategoryBinding.getState().holdMs).toBe(250);
  });

  it('setHoldMs clamps to [0, MAX_CATEGORY_HOLD_MS]', () => {
    useCategoryBinding.getState().setHoldMs(-5);
    expect(useCategoryBinding.getState().holdMs).toBe(0);
    useCategoryBinding.getState().setHoldMs(MAX_CATEGORY_HOLD_MS * 10);
    expect(useCategoryBinding.getState().holdMs).toBe(MAX_CATEGORY_HOLD_MS);
  });

  for (const [what, bad] of [
    ['too long', MAX_CATEGORY_HOLD_MS * 100],
    ['negative', -400],
    ['not a number', 'soon'],
  ] as const) {
    it.fails(`a corrupt persisted hold (${what}) is clamped to [0, MAX_CATEGORY_HOLD_MS] (#393 lower: #327 holdMs not re-validated)`, async () => {
      persisted(bad);
      await useCategoryBinding.persist.rehydrate();
      const h = useCategoryBinding.getState().holdMs;
      expect(typeof h).toBe('number');
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(MAX_CATEGORY_HOLD_MS);
    });
  }
});

describe('TrainerPanel: "Save and bind" warns before it replaces a saved set', () => {
  async function renderWithSaved() {
    await useCategoryBinding.getState().saveModel('My categories', model());
    useCategoryBinding.setState({ active: null, activeId: null });
    useTrainer.setState({ built: true, model: model(), labels: {}, categorySource: 'cut', k: 2, suggestedK: 2 });
    useTools.setState({ open: 'trainer' });
    render(<TrainerPanel />);
    const input = screen.getByLabelText('Name for these categories') as HTMLInputElement;
    await waitFor(() => expect(useCategoryBinding.getState().saved).toHaveLength(1));
    return input;
  }

  it('the default name "My categories" shows the warning when that set exists (the baseline)', async () => {
    const input = await renderWithSaved();
    expect(input.value).toBe('My categories');
    expect(await screen.findByText(/Replaces your saved .My categories./)).toBeTruthy();
  });

  it.fails('a blank name, which saves as "My categories", shows the same warning (#393 lower: #327 the save name)', async () => {
    const input = await renderWithSaved();
    fireEvent.change(input, { target: { value: '   ' } });
    expect(await screen.findByText(/Replaces your saved .My categories./, {}, { timeout: 200 })).toBeTruthy();
  });

  it('a blank name does save under "My categories" (what the warning must announce)', async () => {
    const input = await renderWithSaved();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and bind' }));
    await waitFor(() => expect(useTools.getState().open).toBe('gestures'));
    expect(useCategoryBinding.getState().saved.map((s) => s.name)).toEqual(['My categories']);
  });
});

describe('the Gestures panel: a category id that is a built-in property', () => {
  async function renderBindings(ids: [string, string]) {
    await useCategoryBinding.getState().saveModel('Odd', model(ids, ['odd', 'even']));
    useTools.setState({ open: 'gestures' });
    render(<GesturesPanel />);
    const section = await screen.findByRole('region', { name: 'Your categories' });
    await waitFor(() => expect(within(section).getByLabelText('Command for odd')).toBeTruthy());
    return section;
  }

  it('an unbound category shows "(unbound)" and no arguments field (the baseline)', async () => {
    const section = await renderBindings(['cat-1', 'cat-2']);
    const picker = within(section).getByLabelText('Command for odd') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect([...picker.options].some((o) => /unknown/.test(o.textContent ?? ''))).toBe(false);
    expect(within(section).queryByLabelText('Arguments for odd')).toBeNull();
  });

  it.fails('an unbound category whose id is "constructor" reads as unbound, not as an unknown command (#393 item 7)', async () => {
    const section = await renderBindings(['constructor', 'cat-2']);
    const picker = within(section).getByLabelText('Command for odd') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect([...picker.options].some((o) => /unknown/.test(o.textContent ?? ''))).toBe(false);
    expect(within(section).queryByLabelText('Arguments for odd')).toBeNull();
  });
});
