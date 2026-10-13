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
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
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
  return (await createFaceModelStore().save(name, { categorizer, takeId: null })).id;
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
  localStorage.removeItem(FACE_MODELS_STORAGE_KEY);
  dispatchDialPatch([['faceCategorizer.id', GENERAL_CATEGORIZER], ['face.mapping', 'none']]);
});
afterEach(cleanup);

describe.runIf(FACES)('the face categorizer section of the instrument editor', () => {
  it('is a section of the editor, closed until opened, offering the general model', async () => {
    render(<DialsControlsPanel />);
    expect(screen.getByText('Face categorizer')).toBeTruthy();
    openSection();
    const select = (await screen.findByLabelText('Face categorizer', {}, { timeout: LOAD_MS })) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([GENERAL_CATEGORIZER]);
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
});
