// @vitest-environment jsdom
/**
 * "Your poses" is REACHABLE (#382 = #385 E9, the shipping rule): an extension tool in the shell's
 * Tools launcher, two clicks from a cold load to its panel (Tools, Your poses), four to a recording
 * (then Record my poses, Start capturing), as "Your faces" and "Your hand shapes". Its Explore claims
 * the body POSE groups under its own owner, which is what composes the body branch (the pose model
 * runs only while a pose tool reads it), and closing releases them. The mirror and the camera
 * stills are chosen before the take (both off by default, #387 B10 and C7). A saved pose
 * categorizer is bound to commands in one click, its mirror carried to the bound set.
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
import { branchIdsFor } from '@/app/graph';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { BODY_POSE_GROUPS } from '@thoremin/sdk/features/body_groups';
import { bodySessionStore } from '@thoremin/ext-faces/app/bodySession';
import { handSessionStore } from '@thoremin/ext-faces/app/handSession';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { CATEGORY_PANEL_TOOL, createSavedCategoriesStore, setSavedCategoriesStore, useCategoryBinding } from '@/app/enroll/categoryBinding';
import { FACES } from '../helpers/extensions';
import { scriptedPoseCategorizer } from '../helpers/body_poses';
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
  bodySessionStore().getState().reset();
});
afterEach(cleanup);

describe.runIf(FACES)('"Your poses" is reachable from the shell', () => {
  it('is an extension tool in the mode group, beside Your faces and Your hand shapes', () => {
    const tool = SHELL_TOOLS.find((t) => t.id === 'poses')!;
    expect(tool).toBeDefined();
    expect(tool.label).toBe('Your poses');
    expect(tool.group).toBe('mode');
    expect(SHELL_TOOLS.some((t) => t.id === 'hand-shapes')).toBe(true);
  });

  it('Tools, Your poses, Record my poses: Explore claims the pose groups as its own owner (the body branch composes); closing releases', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your poses', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    expect(document.querySelector('[data-tool="poses"]')).not.toBeNull();
    // The two choices before the take, both off.
    const mirror = (await screen.findByRole('checkbox', { name: /Left and right are the same pose/ })) as HTMLInputElement;
    const stills = screen.getByRole('checkbox', { name: /Also keep camera pictures/ }) as HTMLInputElement;
    expect(mirror.checked).toBe(false);
    expect(stills.checked).toBe(false);
    fireEvent.click(mirror);
    expect(bodySessionStore().getState().mirror).toBe(true);
    // Nothing claims the body yet: no body branch.
    expect(branchIdsFor({}, { demanded: appFeatureDemand.groups() })).not.toContain('body-source');
    fireEvent.click(screen.getByRole('button', { name: 'Record my poses' }));
    expect(bodySessionStore().getState().phase).toBe('explore');
    expect(handSessionStore().getState().phase).toBe('idle');
    expect(appFeatureDemand.owners()).toContain('poses');
    for (const g of BODY_POSE_GROUPS) expect(appFeatureDemand.groups()).toContain(g);
    expect(branchIdsFor({}, { demanded: appFeatureDemand.groups() })).toContain('body-source');
    expect(await screen.findByText(/Try your poses/)).toBeTruthy();
    act(() => useTools.getState().close());
    expect(bodySessionStore().getState().phase).toBe('idle');
    expect(appFeatureDemand.owners()).not.toContain('poses');
    expect(branchIdsFor({}, { demanded: appFeatureDemand.groups() })).not.toContain('body-source');
  });

  it('a saved pose categorizer: Bind to commands carries its mirror to the bound set and opens the Gestures tool', async () => {
    // One collection (#371): the host's bindings read the records the tool saves (localStorage here).
    setSavedCategoriesStore(null);
    const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
    if (!file.ok) throw new Error(file.error);
    await createCategorizerStore(bodyModality).save('Arms', { categorizer: { ...file.categorizer, modality: 'body', mirror: true } });
    render(<Shell />);
    act(() => useTools.getState().toggleTool('poses'));
    const bind = await screen.findByRole('button', { name: 'Bind Arms to commands' });
    // A pose categorizer also plays in the instrument (#384), beside Bind.
    expect(screen.getByRole('button', { name: 'Play Arms' })).toBeTruthy();
    fireEvent.click(bind);
    await waitFor(() => expect(useCategoryBinding.getState().active?.name).toBe('Arms'));
    expect(useCategoryBinding.getState().active!.categories.read).toEqual({ modality: 'body', mirror: true });
    expect(useTools.getState().open).toBe(CATEGORY_PANEL_TOOL);
    setSavedCategoriesStore(null);
  });

  it('a saved pose categorizer: Tools, Your poses, Open, "Left and right are the same pose" turns the mirror on after the take (#459)', async () => {
    setSavedCategoriesStore(null);
    await createCategorizerStore(bodyModality).save('Sides', { categorizer: scriptedPoseCategorizer(['rest', 'left arm out', 'right arm out']) });
    render(<Shell />);
    act(() => useTools.getState().toggleTool('poses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Sides' }));
    await waitFor(() => expect(bodySessionStore().getState().phase).toBe('saved'));
    const mirror = document.querySelector<HTMLInputElement>('[data-poses-mirror-after]')!;
    expect(mirror.checked).toBe(false);
    expect(mirror.disabled).toBe(false);
    fireEvent.click(mirror);
    await waitFor(() => expect(bodySessionStore().getState().working!.mirror).toBe(true));
    expect(bodySessionStore().getState().working!.categories).toHaveLength(2);
    const after = document.querySelector<HTMLInputElement>('[data-poses-mirror-after]')!;
    expect(after.checked).toBe(true);
    // #529: every hold kept its side, so the same click turns it off again, the sides apart.
    expect(after.disabled).toBe(false);
    fireEvent.click(after);
    await waitFor(() => expect(bodySessionStore().getState().working!.mirror).not.toBe(true));
    expect(bodySessionStore().getState().working!.categories).toHaveLength(3);
    expect(document.querySelector<HTMLInputElement>('[data-poses-mirror-after]')!.checked).toBe(false);
    setSavedCategoriesStore(null);
  });

  it('a mirrored pose categorizer whose holds did not keep their side cannot turn the mirror off (#529)', async () => {
    setSavedCategoriesStore(null);
    const file = scriptedPoseCategorizer(['rest', 'left arm out', 'right arm out']);
    await createCategorizerStore(bodyModality).save('Old', { categorizer: { ...file, mirror: true } });
    render(<Shell />);
    act(() => useTools.getState().toggleTool('poses'));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Old' }));
    await waitFor(() => expect(bodySessionStore().getState().phase).toBe('saved'));
    const mirror = document.querySelector<HTMLInputElement>('[data-poses-mirror-after]')!;
    expect(mirror.checked).toBe(true);
    expect(mirror.disabled).toBe(true);
    expect(document.querySelector('[data-poses-mirror]')!.textContent).toContain('did not keep the side');
    setSavedCategoriesStore(null);
  });
});
