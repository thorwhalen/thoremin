// @vitest-environment jsdom
/**
 * "Your hand shapes" is REACHABLE (#385 E8, the shipping rule): an extension tool in the shell's
 * Tools launcher, two clicks from a cold load to its panel (Tools, Your hand shapes), four to a
 * recording (then Record my hand shapes, Start capturing), as "Your faces". Its Explore claims the
 * HAND groups under its own owner, and a saved hand categorizer is bound to commands in one click
 * (Bind to commands), which opens the Gestures tool on it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { SHELL_TOOLS } from '@/app/shellTools';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { handModality, HAND_CLAIM_GROUPS } from '@thoremin/sdk/features/modalities/hand';
import { handSessionStore } from '@thoremin/ext-faces/app/handSession';
import { faceSessionStore } from '@thoremin/ext-faces/app/faceSession';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { CATEGORY_PANEL_TOOL, createSavedCategoriesStore, setSavedCategoriesStore, useCategoryBinding } from '@/app/enroll/categoryBinding';
import { FACES } from '../helpers/extensions';
import { dialsStore } from '@/app/dials/settingsStore';
import '@/app/dials/useDialsSettings';
import '@/app/dispatchDial';

void dialsStore;

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

describe.runIf(FACES)('"Your hand shapes" is reachable from the shell', () => {
  it('is an extension tool in the mode group, beside Your faces', () => {
    const tool = SHELL_TOOLS.find((t) => t.id === 'hand-shapes')!;
    expect(tool).toBeDefined();
    expect(tool.label).toBe('Your hand shapes');
    expect(tool.group).toBe('mode');
    expect(SHELL_TOOLS.some((t) => t.id === 'faces')).toBe(true);
  });

  it('Tools, Your hand shapes, Record my hand shapes: Explore claims the hand groups as its own owner; closing releases', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your hand shapes', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    expect(document.querySelector('[data-tool="hand-shapes"]')).not.toBeNull();
    // Which hand, before the take (either by default).
    const which = (await screen.findByRole('combobox', { name: 'Which hand' })) as HTMLSelectElement;
    expect(which.value).toBe('either');
    fireEvent.change(which, { target: { value: 'left' } });
    expect(handSessionStore().getState().hand).toBe('left');
    fireEvent.click(screen.getByRole('button', { name: 'Record my hand shapes' }));
    expect(handSessionStore().getState().phase).toBe('explore');
    expect(faceSessionStore().getState().phase).toBe('idle');
    expect(appFeatureDemand.owners()).toContain('hand-shapes');
    expect(appFeatureDemand.owners()).not.toContain('faces');
    for (const g of HAND_CLAIM_GROUPS) expect(appFeatureDemand.groups()).toContain(g);
    // Waited for: CI once found no Explore text here (unexplained; not reproduced locally).
    expect(await screen.findByText(/Try your hand shapes/)).toBeTruthy();
    // Start capturing: the rest's progress ring (#403), click 4 from a cold load.
    fireEvent.click(screen.getByRole('button', { name: /Start capturing/ }));
    expect(await screen.findByRole('progressbar', { name: 'Rest progress' })).toBeTruthy();
    act(() => useTools.getState().close());
    expect(handSessionStore().getState().phase).toBe('idle');
    expect(appFeatureDemand.owners()).not.toContain('hand-shapes');
  });

  it('a saved hand categorizer: Bind to commands makes it the active set and opens the Gestures tool', async () => {
    // One collection (#371): the host's bindings read the records the tool saves (localStorage here).
    setSavedCategoriesStore(null);
    const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
    if (!file.ok) throw new Error(file.error);
    await createCategorizerStore(handModality).save('Fists', { categorizer: { ...file.categorizer, hand: 'right' } });
    render(<Shell />);
    act(() => useTools.getState().toggleTool('hand-shapes'));
    const bind = await screen.findByRole('button', { name: 'Bind Fists to commands' });
    // A hand categorizer is not played by the face chords: no Play it on its row.
    expect(screen.queryByRole('button', { name: 'Play Fists' })).toBeNull();
    fireEvent.click(bind);
    await waitFor(() => expect(useCategoryBinding.getState().active?.name).toBe('Fists'));
    expect(useCategoryBinding.getState().active!.categories.read).toEqual({ modality: 'hand', hand: 'right' });
    expect(useTools.getState().open).toBe(CATEGORY_PANEL_TOOL);
    setSavedCategoriesStore(null);
  });
});
