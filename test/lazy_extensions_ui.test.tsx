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
import { ensureLazyTypes, useExtensionLoad } from '@/app/extensionLoad';
import { lazyPanel } from '@/app/extensions/lazyPanel';
import { ASL } from './helpers/extensions';

afterEach(cleanup);

const node = (type: string): NodeDef<any> =>
  defineNode({ type, inputs: [], outputs: [{ name: 'out', kind: 'number' }], process: () => ({ out: 1 }) });

describe.runIf(ASL)('loading a lazy extension from the app (src/app/extensionLoad.ts)', () => {
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

  it('a failed load says so and retries on demand, never throwing into the shell', async () => {
    let attempts = 0;
    const panel = lazyPanel({ instrumentId: 'x', section: 'X section' }, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return ui('second');
    });
    render(<panel.Controls />);
    await waitFor(() => expect(screen.getByText(/X section could not load: offline/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('second controls')).toBeTruthy());
    expect(attempts).toBe(2);
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
