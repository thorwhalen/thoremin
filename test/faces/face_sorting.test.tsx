// @vitest-environment jsdom
/**
 * One editable carve (#385 E4) on the synthetic face, through the session store and the panel:
 * a fresh carve IS a categorizer (hold ids from the start); every move is a pin that survives a
 * re-cut of k; merge, split and delete; undo restores the exact previous document, redo the
 * next; a saved categorizer reopened re-cuts with its pins; and in the grid a hold moves by key,
 * by menu and by drag, Cmd/Ctrl-Z undoes inside the grid, and both bins are shown. Plus a
 * regression test per finding of the adversarial review.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { ASIDE_BIN, NEUTRAL_BIN, PersonalCategorizerSchema } from '@thoremin/sdk/enroll/categorizer';
import { NEW_CATEGORY, pinsHold, placeOf } from '@thoremin/sdk/enroll/sorting';
import { MAX_CATEGORY_SLOTS } from '@thoremin/ext-faces/schema';
import '@/app/dials/useDialsSettings'; // the dials host the panel's "Play it" reads

const TAKE_MS = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
let clock = 0;

function deps(): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-13T00:00:00.000Z',
  };
}

/** A store holding a fresh carve of the synthetic face take. */
async function carved() {
  vi.useFakeTimers();
  const store = createFaceSessionStore(deps());
  store.getState().start();
  for (let t = 0; t < TAKE_MS + 300; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
  await store.getState().stop();
  vi.useRealTimers();
  expect(store.getState().phase).toBe('carved');
  return store;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('one editable carve: the store', () => {
  it('a fresh carve is a categorizer with hold ids; moves are pins that survive every k', async () => {
    const store = await carved();
    const s = () => store.getState();
    const w = s().working!;
    expect(PersonalCategorizerSchema.parse(w)).toEqual(w);
    expect(w.samples.every((x) => /^take-1:\d+$/.test(x.id))).toBe(true);
    const [a, b] = w.categories;
    const hold = a.members[0];
    expect(s().moveHolds([hold], b.id)).toBe(true);
    expect(s().working!.pins).toEqual({ [hold]: b.id });
    expect(s().view!.pinned.size).toBe(1);
    for (const k of [1, 2, 4, 6, 3]) {
      s().setK(k);
      expect(placeOf(s().working!, hold)).toBe(b.id);
      expect(pinsHold(s().working!)).toBe(true);
    }
    // Pinned to two categories: k never goes below 2.
    const other = s().working!.categories.find((c) => c.id !== b.id)!;
    expect(s().moveHolds([other.members[0]], other.id)).toBe(true);
    s().setK(1);
    expect(s().view!.k).toBe(2);
    expect(s().view!.minK).toBe(2);
  });

  it('merge, split, new category, bins and delete; undo is exact and redo goes forward', async () => {
    const store = await carved();
    const s = () => store.getState();
    const history = [s().working!];
    const step = (ok: boolean) => {
      expect(ok).toBe(true);
      history.push(s().working!);
    };
    const [a, b] = s().working!.categories;
    step(s().merge(a.id, b.id));
    expect(s().working!.categories.map((c) => c.id)).not.toContain(a.id);
    step(s().split(b.id));
    expect(s().view!.k).toBe(history[1].categories.length + 1);
    step(s().moveHolds([s().working!.samples[0].id], NEW_CATEGORY));
    step(s().moveHolds([s().working!.samples[1].id], ASIDE_BIN));
    step(s().moveHolds([s().working!.samples[2].id], NEUTRAL_BIN));
    expect(s().view!.aside.count).toBe(1);
    step(s().deleteHolds([s().working!.samples[3].id]));
    expect(s().working!.samples).toHaveLength(history[0].samples.length - 1);
    expect(s().history.undo).toBe(history.length - 1);
    // Undo walks back through the exact documents; redo forward again.
    for (let i = history.length - 2; i >= 0; i--) {
      s().undo();
      expect(s().working).toBe(history[i]);
    }
    expect(s().history).toEqual({ undo: 0, redo: history.length - 1 });
    s().redo();
    expect(s().working).toBe(history[1]);
    // A new edit drops the redo branch.
    s().setK(s().view!.k + 1);
    expect(s().history.redo).toBe(0);
  });

  it('a refused edit changes nothing and says why', async () => {
    const store = await carved();
    const s = () => store.getState();
    const before = s().working;
    const lone = s().working!.categories[0];
    expect(s().moveHolds(lone.members, s().working!.categories[1].id)).toBe(false);
    expect(s().notice).toMatch(/keeps at least one/);
    expect(s().working).toBe(before);
    expect(s().history.undo).toBe(0);
  });

  it('a saved categorizer reopened re-cuts, and its pins and names come back with it', async () => {
    const store = await carved();
    const s = () => store.getState();
    const [a, b] = s().working!.categories;
    const hold = a.members[0];
    s().moveHolds([hold], b.id);
    s().rename(b.id, 'my grin');
    expect(await s().save('Pinned')).toBe(true);
    await s().open(s().saved[0].id);
    expect(s().phase).toBe('saved');
    expect(s().working!.pins![hold]).toBe(b.id);
    for (const k of [s().view!.maxK, 1, 3]) {
      s().setK(k);
      expect(placeOf(s().working!, hold)).toBe(b.id);
      expect(s().working!.categories.find((c) => c.id === b.id)!.label).toBe('my grin');
    }
  });
});

describe('one editable carve: what the adversarial review broke', () => {
  it('the strangers switch keeps every edit: it moves no hold and re-cuts nothing (#385 E5)', async () => {
    const store = await carved();
    const s = () => store.getState();
    const w = s().working!;
    expect(s().moveHolds([w.categories[0].members[0]], ASIDE_BIN)).toBe(true);
    expect(s().deleteHolds([w.categories[1].members[0]])).toBe(true);
    const edited = s().working!;
    const placed = (c: typeof edited) => ({ samples: c.samples, categories: c.categories, neutral: c.neutral, aside: c.aside, pins: c.pins });
    s().setStrangers('nearest');
    expect(s().working!.strangers).toBe('nearest');
    expect(placed(s().working!)).toEqual(placed(edited));
    s().setStrangers('neutral');
    expect(placed(s().working!)).toEqual(placed(edited));
    expect(s().working!.rejectRadius).toBeGreaterThan(0);
  });

  it('names saved without pins (an older file) survive a re-cut', async () => {
    const store = await carved();
    const s = () => store.getState();
    const w = s().working!;
    const names = w.categories.map((_, i) => `mine ${i + 1}`);
    const file = { ...w, name: 'Old', categories: w.categories.map((c, i) => ({ ...c, label: names[i] })) };
    delete (file as { pins?: unknown }).pins;
    expect(s().importFile(JSON.stringify(file))).toBe(true);
    const k = s().view!.k;
    s().setK(k + 1);
    s().setK(k);
    expect(s().view!.categories.map((c) => c.label)).toEqual(expect.arrayContaining(names));
  });

  it('k never passes the chord slots; k changes in a row are one undo step', async () => {
    const store = await carved();
    const s = () => store.getState();
    const before = s().working;
    const k = s().view!.k;
    s().setK(k + 1);
    s().setK(k + 2);
    expect(s().history.undo).toBe(1);
    s().undo();
    expect(s().working).toBe(before);
    s().setK(50);
    expect(s().view!.k).toBeLessThanOrEqual(MAX_CATEGORY_SLOTS);
    expect(s().view!.maxK).toBeLessThanOrEqual(MAX_CATEGORY_SLOTS);
  });

  it('pins that disagree with their hold are dropped on import', async () => {
    const store = await carved();
    const s = () => store.getState();
    const w = s().working!;
    const [a, b] = w.categories;
    const file = { ...w, name: 'Odd', pins: { [a.members[0]]: b.id, [b.members[0]]: b.id } };
    expect(s().importFile(JSON.stringify(file))).toBe(true);
    expect(s().working!.pins).toEqual({ [b.members[0]]: b.id });
    expect(pinsHold(s().working!)).toBe(true);
  });
});

describe('one editable carve: the grid', () => {
  it('shows every hold and both bins; a key, the menu and a drag move holds; Cmd-Z undoes', async () => {
    const store = await carved();
    const s = () => store.getState();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const grid = document.querySelector('[data-faces-sorting]') as HTMLElement;
    expect(grid).not.toBeNull();
    expect(document.querySelector('[data-face-neutral]')).not.toBeNull();
    expect(document.querySelector('[data-face-aside]')).not.toBeNull();
    // Every hold is shown (short of a "+n" collapse).
    const shown = document.querySelectorAll('[data-face-hold]').length;
    const more = [...document.querySelectorAll('button')].filter((x) => /^\+\d+$/.test(x.textContent ?? '')).reduce((n, x) => n + Number(x.textContent!.slice(1)), 0);
    expect(shown + more).toBe(s().working!.samples.length);

    // Key: select a hold of category 1, press 2.
    const [first, second] = s().working!.categories;
    const hold = first.members[first.members.length - 1];
    const card = () => document.querySelector(`[data-face-hold="${hold}"]`) as HTMLElement;
    fireEvent.click(card().querySelector('button')!);
    expect(document.querySelector('[data-faces-selection]')).not.toBeNull();
    fireEvent.keyDown(grid, { key: '2' });
    expect(placeOf(s().working!, hold)).toBe(second.id);
    expect(s().working!.pins![hold]).toBe(second.id);

    // Cmd-Z inside the grid undoes it (and does not reach the app's own Cmd-Z).
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    fireEvent.keyDown(grid, { key: 'z', metaKey: true });
    window.removeEventListener('keydown', outside);
    expect(placeOf(s().working!, hold)).toBe(first.id);
    expect(outside).not.toHaveBeenCalled();

    // The menu: set it aside.
    const menu = card().querySelector('select[data-face-move]') as HTMLSelectElement;
    fireEvent.change(menu, { target: { value: ASIDE_BIN } });
    expect(placeOf(s().working!, hold)).toBe(ASIDE_BIN);

    // A drag: from the Set-aside bin onto Neutral.
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', effectAllowed: '' };
    act(() => {
      fireEvent.dragStart(card(), { dataTransfer });
    });
    fireEvent.drop(document.querySelector('[data-face-neutral]')!, { dataTransfer });
    expect(placeOf(s().working!, hold)).toBe(NEUTRAL_BIN);

    // The Undo button goes back a step; Ctrl-Y in the grid redoes (and stays in the grid).
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(placeOf(s().working!, hold)).toBe(ASIDE_BIN);
    window.addEventListener('keydown', outside);
    fireEvent.keyDown(grid, { key: 'y', ctrlKey: true });
    window.removeEventListener('keydown', outside);
    expect(placeOf(s().working!, hold)).toBe(NEUTRAL_BIN);
    expect(outside).not.toHaveBeenCalled();
  });

  it('a category header dropped on another merges them; its menu splits', async () => {
    const store = await carved();
    const s = () => store.getState();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const [a, b] = s().working!.categories;
    const k = s().view!.k;
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', effectAllowed: '' };
    const header = document.querySelector(`[data-face-category="${a.id}"] [draggable]`) as HTMLElement;
    fireEvent.dragStart(header, { dataTransfer });
    fireEvent.drop(document.querySelector(`[data-face-category="${b.id}"]`)!, { dataTransfer });
    expect(s().view!.k).toBe(k - 1);
    const big = s().view!.categories.find((c) => c.size >= 2)!;
    fireEvent.change(screen.getByRole('combobox', { name: `Change ${big.label}` }), { target: { value: 'split' } });
    expect(s().view!.k).toBe(k);
  });

  it('a category menu merges it into Neutral (#444): its holds land in the Neutral bin', async () => {
    const store = await carved();
    const s = () => store.getState();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const gone = s().view!.categories[0];
    const members = s().working!.categories.find((c) => c.id === gone.id)!.members;
    fireEvent.change(screen.getByRole('combobox', { name: `Change ${gone.label}` }), { target: { value: 'merge:neutral' } });
    expect(s().working!.categories.map((c) => c.id)).not.toContain(gone.id);
    for (const id of members) expect(s().working!.neutral).toContain(id);
    // Its header dropped on the Neutral bin does the same.
    const next = s().view!.categories[0];
    const data = new Map<string, string>();
    const dataTransfer = { setData: (t: string, v: string) => data.set(t, v), getData: (t: string) => data.get(t) ?? '', effectAllowed: '' };
    fireEvent.dragStart(document.querySelector(`[data-face-category="${next.id}"] [draggable]`)!, { dataTransfer });
    fireEvent.drop(document.querySelector('[data-face-neutral]')!, { dataTransfer });
    expect(s().working!.categories.map((c) => c.id)).not.toContain(next.id);
  });
});
