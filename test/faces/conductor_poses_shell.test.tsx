// @vitest-environment jsdom
/**
 * "Teach my conducting poses" is REACHABLE (#383, the shipping rule): the conductor's default
 * names (ready, fermata, cut-off, rest) are offered from the Conductor tool. From a cold load:
 * Conductor, Conduct with body, Teach my conducting poses: three clicks to "Your poses" with the
 * conductor's vocabulary chosen for the next take (one more, Record my poses, starts it). With
 * hands the button is not shown (the pose tool reads the body).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { bodySessionStore } from '@thoremin/ext-faces/app/bodySession';
import { requestCarve } from '@thoremin/sdk-ui/enroll/carveRequest';
import { FACES } from '../helpers/extensions';
import type { ConductorSettings } from '@/slices/conductor/schema';
import '@/app/dials/useDialsSettings';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;

beforeEach(async () => {
  localStorage.clear();
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  await dispatchDialSetIn('conductor.source', 'hands');
  bodySessionStore().getState().setVocabulary(null);
  bodySessionStore().getState().reset();
});
afterEach(async () => {
  cleanup();
  await dispatchDialSetIn('conductor.source', 'hands');
  bodySessionStore().getState().setVocabulary(null);
});

describe.runIf(FACES)('Teach my conducting poses', () => {
  it('Conductor, Conduct with body, Teach my conducting poses: Your poses opens with the conductor names chosen', async () => {
    render(
      <>
        <ToolsBar />
        <ExtensionToolPanels />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(screen.queryByText(/Teach my conducting poses/)).toBeNull();
    fireEvent.click(screen.getByText('Conduct with body'));
    await waitFor(() => expect(conductor().source).toBe('body'));
    fireEvent.click(await screen.findByText(/Teach my conducting poses/));
    expect(useTools.getState().open).toBe('poses');
    await waitFor(() => expect(document.querySelector('[data-tool="poses"]')).not.toBeNull());
    await waitFor(() => expect(bodySessionStore().getState().vocabulary).toBe('conductor'));
    const select = await waitFor(() => {
      const el = document.querySelector<HTMLSelectElement>('[data-poses-vocabulary-choice] select');
      if (!el) throw new Error('no vocabulary choice yet');
      return el;
    });
    await waitFor(() => expect(select.value).toBe('conductor'));
    // The player may change it back before recording.
    fireEvent.change(select, { target: { value: '' } });
    expect(bodySessionStore().getState().vocabulary).toBeNull();
  });

  it('a request that arrives while a categorizer is open waits for the next take', () => {
    const store = bodySessionStore();
    // A categorizer is open: the request waits.
    store.setState({ phase: 'carved', working: { categories: [] } as unknown as NonNullable<ReturnType<typeof store.getState>['working']> });
    requestCarve('body', { vocabulary: 'conductor' });
    expect(store.getState().vocabulary).toBeNull();
    store.getState().reset();
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().vocabulary).toBe('conductor');
  });
});
