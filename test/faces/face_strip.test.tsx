// @vitest-environment jsdom
/**
 * The live strip of captured holds (#404):
 *
 * - **Pure**: `liveStrip` turns the online carve into one card per hold ("new" for a group's
 *   first hold, "like #j" for a repeat) and the groups held once; `wouldJoin` says what a hold of
 *   a vector would join by the same carve.
 * - **The store, on the synthetic face** (smile, relaxed, surprise, relaxed, ...): the cards say
 *   new, new, new, then "like #2" for the relaxed face again; a deleted hold leaves the strip and
 *   is not in the carve; a named hold goes to the category of that name; paused while holding, the
 *   ghost says what the hold would be.
 * - **The panel**: the cards, the coverage line, tap to name or delete, the ghost card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { useStore } from 'zustand';
import { liveStrip, wouldJoin } from '@thoremin/sdk/enroll/bars';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { HoldStrip, cardWords, coverageWords } from '@thoremin/ext-faces/panels/HoldStrip';
import { FACES } from '../helpers/extensions';

describe('liveStrip and wouldJoin (pure)', () => {
  it('a card per hold in order, new for the first of its group, like its first otherwise; groups held once', () => {
    const { cards, once } = liveStrip([[0, 3, 5], [1], [2, 4]]);
    expect(cards).toEqual([
      { index: 0, like: null },
      { index: 1, like: null },
      { index: 2, like: null },
      { index: 3, like: 0 },
      { index: 4, like: 2 },
      { index: 5, like: 0 },
    ]);
    expect(once).toEqual([1]);
    expect(liveStrip([])).toEqual({ cards: [], once: [] });
  });

  it('wouldJoin: a vector near a group joins it, a far one is new', () => {
    const holds = [{ a: 0 }, { a: 0.1 }, { a: 10 }, { a: 10.1 }];
    const sigma = () => 0.05;
    expect(wouldJoin(holds, { a: 0.05 }, ['a'], sigma)).toEqual([0, 1]);
    expect(wouldJoin(holds, { a: 10.05 }, ['a'], sigma)).toEqual([2, 3]);
    expect(wouldJoin(holds, { a: 30 }, ['a'], sigma)).toBeNull();
    expect(wouldJoin([], { a: 0 }, ['a'], sigma)).toBeNull();
  });

  it('the words', () => {
    expect(cardWords({ n: 1, like: null }, 'face')).toBe('new face');
    expect(cardWords({ n: 4, like: 2 }, 'pose')).toBe('again: like #2');
    expect(coverageWords([])).toBeNull();
    expect(coverageWords([3])).toBe('#3: do it again, so it is learned.');
    expect(coverageWords([3, 5])).toContain('#3, #5');
  });
});

let clock = 0;

function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-strip',
    isoNow: () => '2026-10-14T00:00:00.000Z',
    ...over,
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(33);
    });
  }
}

const FACE_MS = SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs;

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.runIf(FACES)('the strip in the store (the synthetic face)', () => {
  async function capture(faces: number) {
    const store = createFaceSessionStore(deps());
    store.getState().start();
    await run(SYNTHETIC_TIMELINE.restMs + 300);
    expect(store.getState().phase).toBe('faces');
    await run(faces * FACE_MS);
    return store;
  }

  it('smile, relaxed, surprise, relaxed: new, new, new, like #2; the coverage line lists the ones held once', async () => {
    const store = await capture(4);
    const { strip, stripOnce } = store.getState();
    expect(strip.map((c) => c.like)).toEqual([null, null, null, 2]);
    expect(strip.map((c) => c.n)).toEqual([1, 2, 3, 4]);
    expect(stripOnce).toEqual([1, 3]);
    store.getState().cancelRecording();
    expect(store.getState().strip).toEqual([]);
  });

  it('a deleted hold leaves the strip and the carve; a named one goes to the category of that name', async () => {
    const store = await capture(6);
    const before = store.getState().strip.length;
    expect(before).toBeGreaterThanOrEqual(5);
    store.getState().dropHold(3);
    expect(store.getState().strip.map((c) => c.n)).not.toContain(3);
    expect(store.getState().strip.length).toBe(before - 1);
    store.getState().nameHold(1, 'grin');
    expect(store.getState().strip[0].name).toBe('grin');
    await store.getState().stop();
    const { working } = store.getState();
    expect(working).not.toBeNull();
    const ids = working!.samples.map((x) => x.id);
    expect(ids).not.toContain('take-strip:2');
    expect(ids).toContain('take-strip:0');
    const grin = working!.categories.find((c) => c.label === 'grin');
    expect(grin?.members).toContain('take-strip:0');
    expect(working!.pins?.['take-strip:0']).toBe(grin!.id);
  });

  it('every hold deleted: nothing to carve, said plainly', async () => {
    const store = await capture(3);
    for (const c of [...store.getState().strip]) store.getState().dropHold(c.n);
    expect(store.getState().strip).toEqual([]);
    await store.getState().stop();
    expect(store.getState().phase).toBe('empty');
    expect(store.getState().notice).toMatch(/deleted/);
  });

  it('paused while holding a face held before, the ghost says which; a new one says new', async () => {
    // Paused as the fourth face (relaxed) begins: a face held at Pause is not a hold to show (the
    // watching sampler waits for a movement first).
    const store = await capture(3);
    store.getState().pause();
    let ghosts: (number | null)[] = [];
    const unsub = store.subscribe((s) => {
      if (s.ghost && s.ghost.like !== ghosts[ghosts.length - 1]) ghosts = [...ghosts, s.ghost.like];
    });
    await run(4 * FACE_MS);
    unsub();
    // Then the third expression (never held: new), relaxed (like #2), smile again (like #1), relaxed.
    expect(ghosts).toEqual([null, 2, 1, 2]);
    store.getState().resume();
    await run(100);
    expect(store.getState().ghost).toBeNull();
  });
});

describe.runIf(FACES)('the strip in the panel', () => {
  it('cards with what each is, tap to name or delete, the coverage line and the ghost', async () => {
    const store = createFaceSessionStore(deps());
    store.getState().start();
    await run(SYNTHETIC_TIMELINE.restMs + 300 + 4 * FACE_MS);
    const View = () => <HoldStrip s={useStore(store)} />;
    const { rerender } = render(<View />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(document.querySelector('[data-faces-strip-card="4"]')?.textContent).toContain('again: like #2');
    expect(document.querySelector('[data-faces-strip-card="1"]')?.textContent).toContain('new face');
    expect(document.querySelector('[data-faces-strip-coverage]')?.textContent).toBe('#1, #3: do each of these again, so they are learned.');

    fireEvent.click(document.querySelector('[data-faces-strip-card="1"]')!);
    fireEvent.change(screen.getByLabelText('Name for #1'), { target: { value: 'grin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Name it' }));
    rerender(<View />);
    expect(document.querySelector('[data-faces-strip-card="1"]')?.textContent).toContain('grin');

    fireEvent.click(document.querySelector('[data-faces-strip-card="3"]')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete #3' }));
    rerender(<View />);
    expect(document.querySelector('[data-faces-strip-card="3"]')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    store.setState({ ghost: { like: 2 } });
    rerender(<View />);
    expect(document.querySelector('[data-faces-strip-ghost]')?.textContent).toBe('would be:like #2');
    store.getState().cancelRecording();
  });
});
