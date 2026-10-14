// @vitest-environment jsdom
/**
 * A large categorizer re-cuts (#420). The re-cut was offered up to 600 holds, since its forest
 * was cubic; it is quadratic now, so the offer runs to the file's bound. Here a 1500-hold file is
 * imported (the tool's "Import file" button), and the grid offers "How many", where it used to
 * say "Too many holds to re-cut here", and a re-cut honours a pin; a 600-hold one (past the old
 * 250 cap on the suggestion) is shown the forest's suggested k.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { MAX_CATEGORIZER_SAMPLES, exportCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { placeOf, recutRange } from '@thoremin/sdk/enroll/sorting';
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
    isoNow: () => '2026-10-14T00:00:00.000Z',
  };
}

/** A face categorizer file of `holds` holds: the synthetic take's holds, jittered, in one category. */
async function largeFile(holds: number): Promise<string> {
  vi.useFakeTimers();
  const store = createFaceSessionStore(deps());
  store.getState().start();
  for (let t = 0; t < TAKE_MS + 300; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
  await store.getState().stop();
  vi.useRealTimers();
  const w = store.getState().working!;
  let seed = 1;
  const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  const samples = Array.from({ length: holds }, (_, i) => {
    const from = w.samples[i % w.samples.length];
    const vector = Object.fromEntries(Object.entries(from.vector).map(([f, x]) => [f, Number.isFinite(x) ? x + jitter() : x]));
    return { ...from, id: `big:${i}`, vector, t: i };
  });
  const big: PersonalCategorizer = { ...w, name: 'Many faces', samples, categories: [{ id: 'cat-1', label: '', members: samples.map((x) => x.id) }], neutral: [], aside: [], pins: {} };
  return exportCategorizer(big);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a large categorizer re-cuts (#420)', () => {
  it('runs the re-cut offer to the file bound', () => {
    expect(FACE_SESSION_DEFAULTS.recutUpTo).toBe(MAX_CATEGORIZER_SAMPLES);
    expect(FACE_SESSION_DEFAULTS.suggestUpTo).toBeGreaterThanOrEqual(800);
  });

  it("a 600-hold import is shown the forest's suggested k", async () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(await largeFile(600))).toBe(true);
    const want = Math.min(recutRange(s().working!).suggestedK, s().view!.maxK);
    expect(want).toBeGreaterThan(1);
    expect(s().view!.suggestedK).toBe(want);
  }, 60_000);

  it('a 1500-hold import offers "How many", and a re-cut honours a pin', async () => {
    const text = await largeFile(1500);
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(text)).toBe(true);
    expect(s().working!.samples).toHaveLength(1500);
    expect(s().view!.recutable).toBe(true);
    expect(s().view!.maxK).toBeGreaterThan(1);

    render(<FaceSessionView store={store} test={faceTestStore()} />);
    expect(screen.queryByText(/Too many holds to re-cut/)).toBeNull();
    const slider = screen.getByRole('slider', { name: 'Number of categories' });

    const t0 = performance.now();
    fireEvent.change(slider, { target: { value: '4' } });
    const took = performance.now() - t0;
    expect(s().working!.categories).toHaveLength(4);
    // Generous for a loaded CI machine; the bench is ~0.4 s at 1500 holds (the old forest took ~8 s).
    expect(took).toBeLessThan(6000);

    const hold = s().working!.categories[0].members[0];
    const to = s().working!.categories[1].id;
    expect(s().moveHolds([hold], to)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'One fewer category' }));
    expect(s().working!.categories).toHaveLength(3);
    expect(placeOf(s().working!, hold)).toBe(to);
  }, 60_000);
});
