// @vitest-environment jsdom
/**
 * The Gestures section is REACHABLE (#754, the shipping rule): Tools, Your hand shapes, Open a saved
 * categorizer, and its gestures are there, three clicks from a cold load, under the held
 * categories: each with its repetitions drawn, its quality chip, Record more, Merge, Delete; a
 * fourth (a name, then Record a gesture) starts a gesture take, which Cancel returns from. A
 * saved categorizer's gestures are listed for binding in the Gestures tool's "Your categories",
 * which says why nothing fires while the listener warms (#954).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor, within } from '@testing-library/react';
import ToolsBar from '@/app/tools/ToolsBar';
import ToolsLauncher from '@/app/tools/ToolsLauncher';
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { handSessionStore } from '@thoremin/ext-faces/app/handSession';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import CategoryBindings from '@/app/enroll/CategoryBindings';
import { setSavedCategoriesStore, useCategoryBinding } from '@/app/enroll/categoryBinding';
import { createCategoryDispatcher, resetCategoryLive } from '@/app/enroll/categoryDispatch';
import { GESTURES_WARMING_TEXT } from '@/app/enroll/CategoryBindings';
import { waveTake } from '../helpers/wave_take';
import { FACES } from '../helpers/extensions';
import { withRecordedGesture } from '../helpers/gesture_categorizer';
import { dialsStore } from '@/app/dials/settingsStore';
import '@/app/dials/useDialsSettings';
import '@/app/dispatchDial';

void dialsStore;

/** Room for a loaded machine: the panel and the collection load after effects. */
const WAIT = { timeout: 10_000 };

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

beforeEach(() => {
  localStorage.clear();
  useTools.setState({ open: null, launcherOpen: false });
  handSessionStore().getState().reset();
});
afterEach(cleanup);

describe.runIf(FACES)('the Gestures section is reachable from the shell', () => {
  it('Tools, Your hand shapes, Open: the gestures under the categories; a name and Record a gesture start a take', async () => {
    await createCategorizerStore(handModality).save('Waves', { categorizer: withRecordedGesture() });
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your hand shapes', { selector: '[role=dialog] span' }, WAIT);
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Waves' }, WAIT));
    const section = await screen.findByRole('region', { name: 'Gestures' }, WAIT);
    const name = within(section).getByRole('textbox', { name: 'Name of the gesture wave' }) as HTMLInputElement;
    expect(name.value).toBe('wave');
    expect(within(section).getAllByRole('img', { name: 'A repetition of wave' })).toHaveLength(5);
    expect(section.querySelector('[data-gesture-quality]')?.getAttribute('data-gesture-quality')).toBe('distinct');
    for (const label of ['Record more', 'Delete the gesture wave']) expect(within(section).getByRole('button', { name: label })).toBeTruthy();
    // Drop a repetition: one edit of the grid (Undo puts it back).
    fireEvent.click(within(section).getAllByRole('button', { name: 'Drop this repetition of wave' })[0]);
    await waitFor(() => expect(within(section).getAllByRole('img', { name: 'A repetition of wave' })).toHaveLength(4), WAIT);
    expect(handSessionStore().getState().history.undo).toBe(1);
    // A new gesture: its name, then Record a gesture (click 4); Cancel returns to the grid as it was.
    fireEvent.change(within(section).getByRole('textbox', { name: 'Name of a new gesture' }), { target: { value: 'circle' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Record a gesture' }));
    await waitFor(() => expect(handSessionStore().getState().phase).toBe('gesture'), WAIT);
    expect(await screen.findByRole('progressbar', { name: 'Rest progress' }, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(handSessionStore().getState().phase).toBe('saved'), WAIT);
    expect(await screen.findByRole('region', { name: 'Gestures' }, WAIT)).toBeTruthy();
    act(() => useTools.getState().close());
  }, 60_000);

  it('a saved categorizer\'s gestures are bound in Your categories, beside its categories', async () => {
    setSavedCategoriesStore(null);
    const record = await createCategorizerStore(handModality).save('Waves', { categorizer: withRecordedGesture() });
    await useCategoryBinding.getState().load();
    await useCategoryBinding.getState().activate(record.id);
    render(<CategoryBindings />);
    const row = await waitFor(() => {
      const el = document.querySelector('[data-category-gesture="gesture-1"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    }, WAIT);
    expect(within(row).getByText('wave')).toBeTruthy();
    expect(within(row).getByText('not made yet')).toBeTruthy();
    setSavedCategoriesStore(null);
  }, 60_000);

  it('says why nothing fires while the listener warms (#954), and stops saying it once it hears', async () => {
    setSavedCategoriesStore(null);
    resetCategoryLive();
    const record = await createCategorizerStore(handModality).save('Waves', { categorizer: withRecordedGesture() });
    await useCategoryBinding.getState().load();
    await useCategoryBinding.getState().activate(record.id);
    // The dispatcher as the app runs it, on a resting hand: its first frame is the listener's first.
    const frames = waveTake({ seed: 3, waves: 0, restMs: 3000 }).frames;
    let i = 0;
    const d = createCategoryDispatcher({ isPreviewing: () => true, isHushed: () => false, readVector: () => ({ vector: frames[i].v, t: frames[i].t }) });
    d.tick(frames[0].t);
    render(<CategoryBindings />);
    await waitFor(() => expect(screen.getByText(GESTURES_WARMING_TEXT)).toBeTruthy(), WAIT);
    // A second at rest: the noise unit is learned, and the cue goes.
    for (i = 1; i < frames.length; i++) d.tick(frames[i].t);
    await waitFor(() => expect(screen.queryByText(GESTURES_WARMING_TEXT)).toBeNull(), WAIT);
    resetCategoryLive();
    setSavedCategoriesStore(null);
  }, 60_000);
});
