// @vitest-environment jsdom
/**
 * Hand shapes play chords, REACHABLY (#450, the shipping rule). From a cold load with a saved hand
 * categorizer: Tools (1), Your hand shapes (2), Play chords (3), and the instrument composes the
 * hand-chords branch, resolves the categorizer off the tick ("Chords" once it is in the graph) and
 * claims the hand groups so the closed Lab still computes them. The same from the instrument
 * editor: Edit (1), the "Categorizer chords" section (2), the categorizer in "Chords from" (3); a
 * category's chord is a fourth.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { useTools } from '@/app/toolsStore';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialPatch } from '@/app/dispatchDial';
import { branchIdsFor } from '@/app/graph';
import { useControls } from '@/app/store';
import { importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { handSessionStore } from '@thoremin/ext-faces/app/handSession';
import { chooseCategorizerChordsWrites, UNSET_BLEND_VALUE, type CategorizerChordsDial } from '@thoremin/ext-faces/schema';
import type { DerivationSettings } from '@/instruments/derive';
import { FACES } from '../helpers/extensions';
import '@/app/dials/useDialsSettings';

const LOAD_MS = 5000;
const chordsDial = () => (dialsStore.getState().effective as Record<string, unknown>).categorizerChords as CategorizerChordsDial;

async function saveHands(name: string): Promise<string> {
  const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!file.ok) throw new Error(file.error);
  return (await createCategorizerStore(handModality).save(name, { categorizer: file.categorizer })).id;
}

beforeEach(() => {
  localStorage.clear();
  useTools.setState({ open: null, launcherOpen: false });
  handSessionStore().getState().reset();
  dispatchDialPatch(chooseCategorizerChordsWrites(''));
});
afterEach(() => {
  cleanup();
  dispatchDialPatch(chooseCategorizerChordsWrites(''));
});

describe.runIf(FACES)('hand shapes play chords, from the shell', () => {
  it('Tools, Your hand shapes, Play chords: three clicks, the branch composed, resolved, the hand groups claimed', async () => {
    const id = await saveHands('Shapes');
    render(
      <>
        <ToolsBar />
        <ToolsLauncher />
        <ExtensionToolPanels />
      </>,
    );
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your hand shapes', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Play chords with Shapes' }, { timeout: LOAD_MS }));
    await waitFor(() => expect(chordsDial().id).toBe(id));
    expect(branchIdsFor(useControls.getState() as unknown as DerivationSettings)).toContain('hand-chords');
    await screen.findByText('Chords', undefined, { timeout: 3000 });
    expect(appFeatureDemand.owners()).toContain('categorizer-chords');
  });

  it('the editor\'s Categorizer chords section: choose it, then a category\'s chord', { timeout: 20_000 }, async () => {
    const id = await saveHands('Shapes');
    render(<DialsControlsPanel />);
    const details = document.querySelector('details[data-section="Categorizer chords"]') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    const select = (await screen.findByLabelText('Categorizer chords', {}, { timeout: LOAD_MS })) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).map((o) => o.value)).toEqual(['', id]));
    fireEvent.change(select, { target: { value: id } });
    await waitFor(() => expect(chordsDial().id).toBe(id));
    const rows = await screen.findByText(/The chord each category plays/, undefined, { timeout: 3000 });
    expect(rows).toBeTruthy();
    const first = screen.getAllByLabelText(/^Chord for /)[0] as HTMLSelectElement;
    fireEvent.change(first, { target: { value: '6' } });
    await waitFor(() => expect(Object.values(chordsDial().degrees)).toContain(6));
    expect(screen.getByText(/Chords from Shapes/)).toBeTruthy();
    // The category blend (#372), a click further: the target, then a category's value; no slider
    // while it is off, and a value cleared goes back to unset (it no longer pulls).
    expect(screen.queryAllByLabelText(/^brightness for /)).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Category blend'), { target: { value: 'brightness' } });
    await waitFor(() => expect(chordsDial().blend).toBe('brightness'));
    const slider = (await screen.findAllByLabelText(/^brightness for /))[0] as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.8' } });
    await waitFor(() => expect(Object.values(chordsDial().blendValues)).toContain(0.8));
    fireEvent.click(await screen.findByLabelText(/^Clear brightness for /));
    await waitFor(() => expect(Object.values(chordsDial().blendValues).every((v) => v === UNSET_BLEND_VALUE)).toBe(true));
  });
});

describe.runIf(FACES)('each editor section of one extension loads its own controls', () => {
  it('Pose categorizer shows the pose controls, not the face categorizer\'s (the lazy panel matches the section)', async () => {
    render(<DialsControlsPanel />);
    const details = document.querySelector('details[data-section="Pose categorizer"]') as HTMLDetailsElement;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await screen.findByText('Reads your poses with', undefined, { timeout: LOAD_MS });
    expect(details.querySelector('[data-pose-categorizer-section]')).not.toBeNull();
    expect(details.querySelector('[data-testid="face-categorizer-section"]')).toBeNull();
  });
});
