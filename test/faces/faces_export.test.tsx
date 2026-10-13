// @vitest-environment jsdom
/**
 * "Your faces" has export to file where the player is (#369): a fresh carve exports before
 * (or without) Save, and every saved row exports without opening it. Before, Export lived
 * only in the opened categorizer's Test and tune section, so it appeared only after a save
 * and a reopen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { importCategorizer } from '@thoremin/sdk/enroll/categorizer';
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

/** URL's own object-URL functions (jsdom may have none), put back after each test. */
const urlBefore = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

/** Every file the panel downloads: its name and its text. */
let downloads: { name: string; text: Promise<string> }[] = [];

beforeEach(() => {
  clock = 0;
  downloads = [];
  const blobs = new Map<string, Blob>();
  let n = 0;
  // jsdom has no createObjectURL: give it one that keeps the blob, leaving URL itself alone.
  Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.set(`blob:${++n}`, b), `blob:${n}`), revokeObjectURL: () => undefined });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href)!;
    const text = new Promise<string>((resolve) => {
      const reader = new FileReader(); // jsdom's Blob has no text()
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    downloads.push({ name: this.download, text });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(URL, urlBefore);
});

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

const parsed = async (i: number) => {
  const r = importCategorizer(JSON.parse(await downloads[i].text));
  if (!r.ok) throw new Error('the exported file does not import');
  return r.categorizer;
};

describe('export to file from "Your faces" (#369)', () => {
  it('a fresh carve exports before it is saved, under the typed name or the default, and the file imports back', async () => {
    const store = await carved();
    const k = store.getState().view!.k;
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export file' }));
    expect(downloads[0].name).toBe(`${FACE_SESSION_DEFAULTS.exportName.replace(/ /g, '_')}.categorizer.json`);
    const first = await parsed(0);
    expect(first.name).toBe(FACE_SESSION_DEFAULTS.exportName);
    expect(first.categories).toHaveLength(k);
    // The name typed for Save names the file too; nothing was saved by exporting.
    fireEvent.change(screen.getByRole('textbox', { name: 'Categorizer name' }), { target: { value: 'Morning faces' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export file' }));
    expect(downloads[1].name).toBe('Morning_faces.categorizer.json');
    expect((await parsed(1)).name).toBe('Morning faces');
    expect(store.getState().saved).toHaveLength(0);
    expect(store.getState().phase).toBe('carved');
  });

  it('every saved row exports without opening it', async () => {
    const store = await carved();
    await act(async () => void (await store.getState().save('Evening faces')));
    store.getState().reset();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Export Evening faces as a file' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('Evening_faces.categorizer.json');
    expect((await parsed(0)).name).toBe('Evening faces');
    expect(store.getState().phase).toBe('idle'); // not opened
  });
});
