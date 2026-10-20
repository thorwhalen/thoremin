// @vitest-environment jsdom
/**
 * The React side of lazy extensions (`docs/design/lazy-extensions.md`): the load status the app
 * keeps per extension, and the panel placeholder a lazy extension's section is until its code
 * arrives. A `.test.tsx` because it reaches components: the strict typecheck covers no React.
 * The pure side (registry, applier, build) is `lazy_extensions.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defineNode, NodeRegistry, type NodeDef } from '@thoremin/dag';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { ensureLazyTypes, useExtensionLoad } from '@/app/engine/extensionLoad';
import { lazyPanel } from '@/app/extensions/lazyPanel';
import { EXTENSION_PANELS, EXTENSION_UI_IDS, EXTENSION_UIS, loadExtensionUi } from '@/app/extensions';
import { ASL } from './helpers/extensions';

afterEach(cleanup);

const node = (type: string): NodeDef<any> =>
  defineNode({ type, inputs: [], outputs: [{ name: 'out', kind: 'number' }], process: () => ({ out: 1 }) });

describe.runIf(ASL)('loading a lazy extension from the app (src/app/engine/extensionLoad.ts)', () => {
  it('reports loading then error when its nodes cannot load, and ready once they do', async () => {
    const failing = new NodeRegistry().declareLazy(['asl-signs', 'sign-chord'], async () => {
      throw new Error('offline');
    });
    const p = ensureLazyTypes(failing, ['asl-signs']);
    expect(useExtensionLoad.getState().status.asl?.phase).toBe('loading');
    await expect(p).rejects.toThrow('offline');
    expect(useExtensionLoad.getState().status.asl).toEqual({ phase: 'error', message: 'offline' });
    const working = new NodeRegistry().declareLazy(['asl-signs', 'sign-chord'], async () => [node('asl-signs'), node('sign-chord')]);
    await ensureLazyTypes(working, ['asl-signs']);
    expect(useExtensionLoad.getState().status.asl?.phase).toBe('ready');
  });
});

describe('the panel placeholder of a lazy extension (src/app/extensions/lazyPanel.tsx)', () => {
  const ui = (text: string): ExtensionUi => ({
    id: 'x',
    panels: [{ instrumentId: 'x', section: 'X section', Controls: () => <p>{text} controls</p>, Readout: () => <p>{text} readout</p> }],
    statusHooks: [],
    onMount: [],
  });

  it('shows the load readout, then the real component', async () => {
    let release!: (u: ExtensionUi) => void;
    const panel = lazyPanel({ instrumentId: 'x', section: 'X section' }, () => new Promise((r) => (release = r)));
    render(<panel.Controls />);
    expect(screen.getByText('Loading X section…')).toBeTruthy();
    await act(async () => release(ui('real')));
    await waitFor(() => expect(screen.getByText('real controls')).toBeTruthy());
  });

  it('two sections of one extension each resolve to their own panel, matched by section (#367)', async () => {
    // The faces extension has two sections for one instrument id (Face categorizer, Pose
    // categorizer): matched by id alone, the second showed the first one's controls.
    const two: ExtensionUi = {
      id: 'x',
      panels: [
        { instrumentId: 'x', section: 'First', Controls: () => <p>first controls</p>, Readout: () => <p>first readout</p> },
        { instrumentId: 'x', section: 'Second', Controls: () => <p>second controls</p>, Readout: () => <p>second readout</p> },
      ],
      statusHooks: [],
      onMount: [],
    };
    const second = lazyPanel({ instrumentId: 'x', section: 'Second' }, async () => two);
    render(
      <>
        <second.Controls />
        <second.Readout />
      </>,
    );
    await waitFor(() => expect(screen.getByText('second controls')).toBeTruthy());
    expect(screen.getByText('second readout')).toBeTruthy();
    expect(screen.queryByText('first controls')).toBeNull();
  });

  it('a failed load says so and offers a Reload, never throwing into the shell', async () => {
    let reloads = 0;
    const panel = lazyPanel(
      { instrumentId: 'x', section: 'X section' },
      async () => {
        throw new Error('offline');
      },
      { extensionId: 'x', reload: () => (reloads += 1) },
    );
    render(<panel.Controls />);
    await waitFor(() => expect(screen.getByText(/X section could not load \(offline\)/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloads).toBe(1);
  });

  it('under the instrument row, the Readout says the extension is loading, then why it failed (even once its UI is in), with a Reload', async () => {
    const panel = lazyPanel({ instrumentId: 'x', section: 'X section' }, async () => ui('loaded'), { extensionId: 'x-ext', reload: () => undefined });
    act(() => useExtensionLoad.getState().report('x-ext', { phase: 'loading', message: 'Loading x-ext…' }));
    render(<panel.Readout />);
    expect(screen.getByText('Loading X section…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('loaded readout')).toBeTruthy());
    act(() => useExtensionLoad.getState().report('x-ext', { phase: 'error', message: 'offline' }));
    await waitFor(() => expect(screen.getByText(/X section could not load \(offline\)/)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    act(() => useExtensionLoad.getState().report('x-ext', { phase: 'ready', message: 'Loaded' }));
    await waitFor(() => expect(screen.getByText('loaded readout')).toBeTruthy());
  });

  it('inside a closed section it fetches nothing until the section opens', async () => {
    let calls = 0;
    const panel = lazyPanel({ instrumentId: 'x', section: 'X section' }, async () => {
      calls += 1;
      return ui('opened');
    });
    const { container } = render(
      <details>
        <summary>X section</summary>
        <panel.Controls />
      </details>,
    );
    await act(async () => undefined);
    expect(calls).toBe(0);
    const details = container.querySelector('details')!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    });
    await waitFor(() => expect(screen.getByText('opened controls')).toBeTruthy());
    expect(calls).toBe(1);
  });
});

describe("a lazy extension's stub and its deferred half declare the same sections (the review of #367)", () => {
  // A lazy section's placeholder finds its panel by instrument id AND section label, written
  // twice (the eager stub, the deferred half): a label renamed in one would leave the section
  // unable to load.
  it('every section of this build, as the shell lists it, is a panel of the loaded extensions, and back', async () => {
    const key = (p: { instrumentId: string; section: string }) => `${p.instrumentId}:${p.section}`;
    const loaded = await Promise.all(
      EXTENSION_UI_IDS.map((id) => loadExtensionUi(id).catch(() => EXTENSION_UIS.find((u) => u.id === id)!)),
    );
    expect(loaded.flatMap((u) => u.panels.map(key)).sort()).toEqual(EXTENSION_PANELS.map(key).sort());
  });
});
