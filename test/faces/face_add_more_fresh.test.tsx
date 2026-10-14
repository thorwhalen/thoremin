// @vitest-environment jsdom
/**
 * "Add more" from a fresh carve (#421): before it is saved, a fresh carve takes more holds the way
 * an opened one does, into the SAME document (E4: a fresh carve and an opened one are one kind of
 * thing). On the synthetic face:
 *
 * - a carve with a pinned hold, plus "Add more": the pin holds, the new holds are placed, the
 *   phase is still `carved` (nothing was saved), the first take's rest is kept (the Neutral seed:
 *   a re-cut afterwards still puts the rest-cloud holds in Neutral);
 * - Undo returns to the document before the take; Cancel during the take returns to the carve;
 * - the panel offers it on a fresh carve (the reachability: Record, Stop and carve, then this).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { FACES } from '../helpers/extensions';

let clock = 0;
let takes = 0;

function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => `take-${++takes}`,
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
  takes = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function carved() {
  const store = createFaceSessionStore(deps());
  store.getState().start();
  await run(SYNTHETIC_TIMELINE.restMs + 300 + 6 * FACE_MS);
  await store.getState().stop();
  expect(store.getState().phase).toBe('carved');
  return store;
}

describe.runIf(FACES)('"Add more" from a fresh carve (#421)', () => {
  it('appends to the same document: the pin holds, the new holds are placed, still unsaved; undo returns to it', async () => {
    const store = await carved();
    const s = () => store.getState();
    // Pin the first hold into the last category (a move is a pin).
    const w0 = s().working!;
    const first = w0.samples[0].id;
    const target = w0.categories[w0.categories.length - 1].id;
    expect(s().moveHolds([first], target)).toBe(true);
    const before = s().working!;
    expect(before.pins?.[first]).toBe(target);
    const neutralBefore = before.neutral.length;

    s().startMerge('samples');
    expect(s().phase).toBe('rest');
    expect(s().merging).toBe('samples');
    await run(SYNTHETIC_TIMELINE.restMs + 300 + 4 * FACE_MS);
    await s().stop();

    expect(s().phase).toBe('carved');
    expect(s().openId).toBeNull();
    expect(s().dirty).toBe(true);
    const after = s().working!;
    // The pin holds.
    expect(after.pins?.[first]).toBe(target);
    expect(after.categories.find((c) => c.id === target)?.members).toContain(first);
    // Every old hold is still there, and the new ones are placed (in a category or a bin).
    for (const x of before.samples) expect(after.samples.some((y) => y.id === x.id)).toBe(true);
    const added = after.samples.filter((x) => x.id.startsWith('take-2:'));
    expect(added.length).toBeGreaterThan(0);
    const placed = new Set([...after.categories.flatMap((c) => c.members), ...after.neutral, ...(after.aside ?? [])]);
    for (const x of added) expect(placed.has(x.id)).toBe(true);
    expect(s().notice).toMatch(/Merged/);

    // The first take's rest is kept: a re-cut still seeds Neutral from its rest cloud.
    s().setK(s().k);
    expect(s().working!.neutral.length).toBeGreaterThanOrEqual(Math.min(1, neutralBefore));

    // Undo: the document before the take.
    s().undo();
    expect(s().working).toEqual(before);
    expect(s().phase).toBe('carved');
    // And it saves like any fresh carve.
    s().redo();
    expect(await s().save('Mine')).toBe(true);
    expect(s().dirty).toBe(false);
    expect(s().saved.map((x) => x.name)).toEqual(['Mine']);
  });

  it('Cancel during the take returns to the fresh carve, unchanged', async () => {
    const store = await carved();
    const before = store.getState().working;
    store.getState().startMerge('samples');
    await run(SYNTHETIC_TIMELINE.restMs + 300 + FACE_MS);
    store.getState().cancelRecording();
    expect(store.getState().phase).toBe('carved');
    expect(store.getState().working).toBe(before);
    expect(store.getState().notice).toMatch(/Nothing was merged/);
  });

  it('the panel offers it on a fresh carve, and it starts the take, said as adding to this carve', async () => {
    const store = await carved();
    const test = createFaceTestStore({ source: () => ({ ...syntheticSource(() => clock), video: () => null }), claim: () => undefined, now: () => clock, pollMs: 33, publishMs: 100 });
    render(<FaceSessionView store={store} test={test} />);
    const add = screen.getByRole('button', { name: 'Add more of my faces' });
    fireEvent.click(add);
    expect(store.getState().phase).toBe('rest');
    expect(screen.getByText(/Adding to this carve/)).toBeTruthy();
    store.getState().cancelRecording();
  });
});
