// @vitest-environment jsdom
/**
 * "My pose plays" is REACHABLE (#384, the shipping rule). From a cold load with a saved pose
 * categorizer: Tools, Your poses, Play it = three clicks to the instrument reading it (the
 * `poseCategorizer` dial, its category drawn on the video once the camera sees you). Conducting
 * with it: Conductor, Conduct with body, "Start, hold and cut off with my poses" = three more
 * (the checkbox opens Your poses when no categorizer is chosen yet).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import ConductorPanel from '@/app/ConductorPanel';
import { useTools } from '@/app/toolsStore';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { branchIdsFor } from '@/app/graph';
import { useControls } from '@/app/store';
import { scriptedPoseCategorizer } from '../helpers/body_poses';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { bodySessionStore } from '@thoremin/ext-faces/app/bodySession';
import type { PoseCategorizerDial } from '@thoremin/ext-faces/schema';
import type { DerivationSettings } from '@/instruments/derive';
import { FACES } from '../helpers/extensions';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import '@/app/dials/useDialsSettings';

const poseDial = () => (dialsStore.getState().effective as Record<string, unknown>).poseCategorizer as PoseCategorizerDial;
const reset = async () => {
  await dispatchDialSetIn('poseCategorizer.id', '');
  await dispatchDialSetIn('poseCategorizer.transport', false);
  await dispatchDialSetIn('conductor.source', 'hands');
};

beforeEach(async () => {
  localStorage.clear();
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  bodySessionStore().getState().reset();
  await reset();
});
afterEach(async () => {
  cleanup();
  await reset();
});

async function savePoses(name: string): Promise<string> {
  const saved = await createCategorizerStore(bodyModality).save(name, { categorizer: scriptedPoseCategorizer(['ready', 'fermata', 'cut-off']) });
  return saved.id;
}

describe.runIf(FACES)('a saved pose categorizer plays in the instrument', () => {
  it('Tools, Your poses, Play it: three clicks, and the instrument composes the pose branch', async () => {
    const id = await savePoses('Conducting');
    render(
      <>
        <ToolsBar />
        <ToolsLauncher />
        <ExtensionToolPanels />
      </>,
    );
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your poses', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Play Conducting' }, { timeout: 5000 }));
    await waitFor(() => expect(poseDial().id).toBe(id));
    expect(branchIdsFor(useControls.getState() as unknown as DerivationSettings)).toContain('pose-categorizer');
    // The instrument resolves it off the tick: "Playing" only once the model is in the graph.
    await screen.findByText('Playing', undefined, { timeout: 3000 });
    // The pose groups are claimed, so the closed Lab still computes them.
    expect(appFeatureDemand.owners()).toContain('poses-play');
  });

  it('Conductor, Conduct with body, with my poses: the transport override is on, and Your poses opens to choose them', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
        <ExtensionToolPanels />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(document.querySelector('[data-conductor-pose-transport]')).toBeNull();
    fireEvent.click(screen.getByText('Conduct with body'));
    const box = (await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('[data-conductor-pose-transport] input');
      if (!el) throw new Error('no pose transport choice yet');
      return el;
    })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(poseDial().transport).toBe(true));
    // None chosen yet: Your poses opens, where Play it chooses one.
    expect(useTools.getState().open).toBe('poses');
  });
});
