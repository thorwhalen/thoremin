// @vitest-environment jsdom
/**
 * Reachability of category binding (#160), per the shipping rule: a feature nobody can
 * find is not shipped. From a cold load: Tools -> Gestures shows "Your categories" (two
 * clicks), with a way to the Trainer when nothing is trained; from a trained model, the
 * Trainer's "Save and bind" keeps it and lands on the bindings, one row and one command
 * picker per category, and a pick is a saved binding.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { trainModel, type FeatureVector } from '@thoremin/sdk/enroll';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import GesturesPanel from '@/app/gestures/GesturesPanel';
// The Trainer is an extension tool since #600 S16d: the shell's frame host mounts it while open.
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { useTrainer } from '@/slices/trainer/app/store';
import { useTrainerPrefs } from '@/slices/trainer/app/prefs';
import { createSavedCategoriesStore, setSavedCategoriesStore, useCategoryBinding } from '@/app/enroll/categoryBinding';
import { TRAINER } from './helpers/extensions';

function builtModel() {
  const vectors: FeatureVector[] = [0, 0.02, 0.01, 1, 0.98, 1.01].map((x) => ({ x }));
  return trainModel(vectors, [[0, 1, 2], [3, 4, 5]], ['x'], { x: 1 });
}

beforeEach(() => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  setSavedCategoriesStore(createSavedCategoriesStore(createInMemoryProvider([])));
  useCategoryBinding.setState({ saved: [], active: null, activeId: null, enabled: true });
  useTrainer.getState().reset();
  useTrainerPrefs.setState({ recordTake: false, manualAdvance: false });
});
afterEach(cleanup);

describe.runIf(TRAINER)('category binding is reachable from the shell (#160)', () => {
  it('cold load: Tools -> Gestures shows "Your categories", which points at the Trainer when empty', async () => {
    render(
      <>
        <ToolsBar />
        <ToolsLauncher />
        <GesturesPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Gestures', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    const section = screen.getByRole('region', { name: 'Your categories' });
    // At the TOP of the panel, above the hand poses: no scroll between the click and it.
    const poses = screen.getByRole('heading', { name: 'Hand poses' });
    expect(section.compareDocumentPosition(poses) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(await within(section).findByRole('button', { name: 'Trainer' }));
    expect(useTools.getState().open).toBe('trainer');
  });

  it('Trainer -> "Save and bind" keeps the model and lands on a picker per category; a pick is saved', async () => {
    useTrainer.setState({ built: true, model: builtModel(), labels: {}, categorySource: 'cut', k: 2, suggestedK: 2 });
    useTools.setState({ open: 'trainer' });
    render(
      <>
        <ExtensionToolPanels />
        <GesturesPanel />
      </>,
    );
    fireEvent.change(screen.getByLabelText('Name for these categories'), { target: { value: 'Faces' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and bind' }));
    await waitFor(() => expect(useTools.getState().open).toBe('gestures'));

    const section = await screen.findByRole('region', { name: 'Your categories' });
    await waitFor(() => expect(within(section).getByText('category 1')).toBeTruthy());
    expect(within(section).getByText('category 2')).toBeTruthy();
    expect((within(section).getByLabelText('Active categories') as HTMLSelectElement).value).toBe('trained:faces'); // the Trainer's ids in the one collection (#371)

    const picker = within(section).getByLabelText('Command for category 2') as HTMLSelectElement;
    expect([...picker.querySelectorAll('option')].some((o) => o.value.startsWith('instrument.'))).toBe(false);
    fireEvent.change(picker, { target: { value: 'dial.master.volume.set' } });
    await waitFor(() =>
      expect(useCategoryBinding.getState().active?.categories.bindings).toEqual({ 'cat-2': { command: 'dial.master.volume.set' } }),
    );
  });
});
