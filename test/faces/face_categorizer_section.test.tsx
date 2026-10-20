// @vitest-environment jsdom
/**
 * The instrument's categorizer is REACHABLE (#330 P4, the shipping rule): the instrument editor
 * has a "Face categorizer" section; opening it loads the faces extension's panel, which lists
 * the general model and the player's saved categorizers; choosing one dispatches through the
 * dial commands (one `dial.patch`: the id, the categories back to Auto, the face chords on),
 * after which the instrument composes the personal categorizer's branch. A category's chord is
 * one more `dial.setIn`.
 *
 * Clicks from a cold load, with a saved categorizer: "Edit <instrument>" (1), the "Face
 * categorizer" section (2), the categorizer in "Reads your face with" (3). A category's chord is
 * a fourth.
 *
 * Shared categorizers (#330 P5) are listed under "Shared" in the same select, read from the
 * committed `public/categorizers/` (`fetch` is served from there): the same three clicks play
 * one, and "Copy to my categorizers" is a fourth.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { loadExtensionUi } from '@/app/extensions';
import { dialsStore } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';
import { branchIdsFor } from '@/app/graph';
import type { DerivationSettings } from '@/instruments/derive';
import { dispatchDialPatch } from '@/app/dispatchDial';
import { categorizerFromModel } from '@thoremin/sdk/enroll';
import { createFaceTake } from '@thoremin/ext-faces/lib/take';
import { carveView, carverFor } from '@thoremin/ext-faces/lib/carving';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import { createFaceModelStore, FACE_MODELS_STORAGE_KEY } from '@thoremin/ext-faces/app/models';
import { useCategorizerPlay } from '@thoremin/ext-faces/app/categorizerPlay';
import { AUTO_DEGREE, CATEGORY_SLOTS, GENERAL_CATEGORIZER, type FaceCategorizerDial } from '@thoremin/ext-faces/schema';
import { FACES } from '../helpers/extensions';
import { SHARED_PUBLIC_DIR } from '../../scripts/faces/lib_demo_categorizer';

const DEMO = 'shared:demo-smile';

/** `fetch` as the app's static server answers it, for the shared categorizers. */
function serveShared(): void {
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /categorizers\/([a-z0-9-]+\.json)$/.exec(String(url));
    if (!m) return new Response('not found', { status: 404 });
    return new Response(readFileSync(join(SHARED_PUBLIC_DIR, m[1]), 'utf8'), { status: 200 });
  });
}

/** The lazy panel's first import (cold, under a loaded CI runner) can take seconds. */
const LOAD_MS = 15000;
const dial = () => dialsStore.getState().effective.faceCategorizer as FaceCategorizerDial;

async function saveSynthetic(name: string): Promise<string> {
  const take = createFaceTake();
  take.start(0);
  const ms = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
  for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push(syntheticFaceVector(t, f), t);
  take.stop();
  const session = take.session();
  const carver = carverFor(session, take.restVectors(), 'reject');
  const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
  const categorizer = categorizerFromModel(view.model, session.points(), { name, mode: 'reject', modality: 'face' });
  return (await createFaceModelStore().save(name, { categorizer })).id;
}

/** Open the editor's "Face categorizer" section (a closed `<details>`). */
function openSection(): void {
  const details = document.querySelector('details[data-section="Face categorizer"]') as HTMLDetailsElement;
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  });
}

beforeEach(() => {
  serveShared();
  localStorage.removeItem(FACE_MODELS_STORAGE_KEY);
  dispatchDialPatch([['faceCategorizer.id', GENERAL_CATEGORIZER], ['face.mapping', 'none']]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Each test waits up to LOAD_MS for the lazy section, so its own limit must exceed it (vitest's 5 s default made the wait unreachable).
describe.runIf(FACES)('the face categorizer section of the instrument editor', { timeout: LOAD_MS + 5000 }, () => {
  // The section's panel is the faces extension's LAZY React half. Its first import is cold (the
  // extension's whole UI chunk, seconds on a loaded machine) and used to land inside the first
  // test, under the test's own timeout (#797). Load it once here, with a timeout of its own: the
  // panel's loader is cached, so every test below opens the section on a warm import and waits
  // only for what it is testing.
  beforeAll(async () => {
    await loadExtensionUi('faces');
  }, LOAD_MS);

  it('is a section of the editor, closed until opened, offering the general model and the shared ones', async () => {
    render(<DialsControlsPanel />);
    expect(screen.getByText('Face categorizer')).toBeTruthy();
    openSection();
    const select = (await screen.findByLabelText('Face categorizer', {}, { timeout: LOAD_MS })) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toEqual([GENERAL_CATEGORIZER, DEMO]));
    const group = select.querySelector('optgroup[label="Shared"]');
    expect(group?.textContent).toContain('(demo)');
    expect(screen.getByText(/Make your own in Tools, then Your faces/)).toBeTruthy();
  });

  it('choosing a saved categorizer dispatches, turns the face chords on and composes its branch', async () => {
    const id = await saveSynthetic('My faces');
    render(<DialsControlsPanel />);
    openSection();
    const select = (await screen.findByLabelText('Face categorizer', {}, { timeout: LOAD_MS })) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.textContent)).toContain('My faces'));
    act(() => {
      fireEvent.change(select, { target: { value: id } });
    });
    await waitFor(() => expect(dial().id).toBe(id));
    expect(dialsStore.getState().effective['face.mapping']).toBe('chord');
    await waitFor(() => expect(useControls.getState().faceCategorizer?.id).toBe(id));
    expect(branchIdsFor(useControls.getState() as unknown as DerivationSettings)).toContain('face-categorizer');
    // The extension's loader resolved it: its categories are listed, each on Auto.
    await waitFor(() => expect(useCategorizerPlay.getState().phase).toBe('ready'));
    // The section says what the face chords read with (#359: the host shows no row readout for it).
    await waitFor(() => expect(document.querySelector('[data-faces-readout]')?.textContent).toBe('Reading with My faces'));
    const rows = await screen.findByTestId('face-categorizer-degrees');
    const first = useCategorizerPlay.getState().categories[0];
    const chord = screen.getByLabelText(`Chord for ${first.name}`) as HTMLSelectElement;
    expect(Number(chord.value)).toBe(AUTO_DEGREE);
    expect(rows.textContent).toContain(first.name);
    // A category's chord is one `dial.setIn` on its slot.
    expect(CATEGORY_SLOTS).toContain(first.id);
    act(() => {
      fireEvent.change(chord, { target: { value: '4' } });
    });
    await waitFor(() => expect(dial().degrees[first.id]).toBe(4));
  });

  it('an instrument naming a categorizer this device does not have says so, and plays the general model', async () => {
    dispatchDialPatch([['faceCategorizer.id', 'from-elsewhere'], ['face.mapping', 'chord']]);
    render(<DialsControlsPanel />);
    openSection();
    const select = (await screen.findByLabelText('Face categorizer', {}, { timeout: LOAD_MS })) as HTMLSelectElement;
    expect(select.value).toBe('from-elsewhere');
    expect(await screen.findByText(/does not have, so the general model plays/)).toBeTruthy();
  });

  it('a shared categorizer plays from the same select, and copying it points the instrument at the copy', async () => {
    render(<DialsControlsPanel />);
    openSection();
    const select = (await screen.findByLabelText('Face categorizer', {}, { timeout: LOAD_MS })) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toContain(DEMO));
    act(() => {
      fireEvent.change(select, { target: { value: DEMO } });
    });
    await waitFor(() => expect(dial().id).toBe(DEMO));
    expect(dialsStore.getState().effective['face.mapping']).toBe('chord');
    await waitFor(() => expect(useCategorizerPlay.getState()).toMatchObject({ phase: 'ready', id: DEMO }));
    expect(branchIdsFor(useControls.getState() as unknown as DerivationSettings)).toContain('face-categorizer');
    const panel = await screen.findByTestId('face-categorizer-shared');
    expect(panel.textContent).toMatch(/not a model made to fit your face/);
    // Each of its categories gets a chord of its own: the shared file's ids are the dial's slots.
    const chord = screen.getByLabelText('Chord for open smile') as HTMLSelectElement;
    expect(chord.disabled).toBe(false);
    act(() => {
      fireEvent.change(chord, { target: { value: '3' } });
    });
    await waitFor(() => expect(dial().degrees['cat-2']).toBe(3));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy to my categorizers' }));
    });
    await waitFor(() => expect(dial().id).not.toBe(DEMO));
    const copyId = dial().id;
    const saved = await createFaceModelStore().list();
    expect(saved.map((x) => x.id)).toEqual([copyId]);
    expect(saved[0].name).toMatch(/^Demo/);
    // The chords chosen for the shared one are kept: the copy has the same categories in the same order.
    expect(dial().degrees['cat-2']).toBe(3);
    await waitFor(() => expect(useCategorizerPlay.getState()).toMatchObject({ phase: 'ready', id: copyId }));
    expect(await screen.findByText(/Copied as/)).toBeTruthy();
  });
});
