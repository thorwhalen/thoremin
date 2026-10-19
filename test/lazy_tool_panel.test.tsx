// @vitest-environment jsdom
/**
 * A lazy extension's TOOL panel before its code is here (`lazyToolPanel`,
 * `src/app/extensions/lazyPanel.tsx`; #391 item 1): it shows the shared load readout, then the
 * real panel (with the host's props); a deferred half that has no such tool, or that fails to
 * load, says so with a Reload instead of throwing into the shell. Its section sibling,
 * `lazyPanel`, is `lazy_extensions_ui.test.tsx`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExtensionToolDecl, ExtensionToolPanelProps, ExtensionUi } from '@thoremin/sdk-ui/types';
import { lazyToolPanel } from '@/app/extensions/lazyPanel';
import { toolPanelProps } from './helpers/toolPanel';

afterEach(cleanup);

const decl = (id: string): ExtensionToolDecl => ({ id, label: 'Your thing', description: 'A tool', group: 'tool', defaultPinned: false });

const uiWithTool = (toolId: string): ExtensionUi => ({
  id: 'ext',
  panels: [],
  statusHooks: [],
  onMount: [],
  tools: [
    {
      ...decl(toolId),
      Panel: ({ close }: ExtensionToolPanelProps) => (
        <button type="button" onClick={close}>
          real tool panel
        </button>
      ),
    },
  ],
});

describe('lazyToolPanel', () => {
  it('shows the load readout, then the real panel with the host props', async () => {
    let release!: (u: ExtensionUi) => void;
    let closes = 0;
    const Panel = lazyToolPanel(decl('thing'), () => new Promise((r) => (release = r)));
    render(<Panel {...toolPanelProps(() => (closes += 1))} />);
    expect(screen.getByText('Loading Your thing…')).toBeTruthy();
    await act(async () => release(uiWithTool('thing')));
    await waitFor(() => expect(screen.getByText('real tool panel')).toBeTruthy());
    fireEvent.click(screen.getByText('real tool panel'));
    expect(closes).toBe(1);
  });

  it('a second mount after the load renders the panel at once, without loading again', async () => {
    let calls = 0;
    const Panel = lazyToolPanel(decl('again'), async () => {
      calls += 1;
      return uiWithTool('again');
    });
    const first = render(<Panel {...toolPanelProps(() => undefined)} />);
    await waitFor(() => expect(screen.getByText('real tool panel')).toBeTruthy());
    first.unmount();
    render(<Panel {...toolPanelProps(() => undefined)} />);
    expect(screen.getByText('real tool panel')).toBeTruthy();
    expect(calls).toBe(1);
  });

  it('a deferred half with no such tool shows an error and a Reload', async () => {
    let reloads = 0;
    const Panel = lazyToolPanel(decl('missing'), async () => uiWithTool('other'), () => (reloads += 1));
    render(<Panel {...toolPanelProps(() => undefined)} />);
    await waitFor(() => expect(screen.getByText(/Your thing could not load \(the extension's UI has no tool "missing"\)/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloads).toBe(1);
  });

  it('a failed load shows the error and a Reload, never throwing into the shell', async () => {
    let reloads = 0;
    const Panel = lazyToolPanel(
      decl('offline'),
      async () => {
        throw new Error('offline');
      },
      () => (reloads += 1),
    );
    render(<Panel {...toolPanelProps(() => undefined)} />);
    await waitFor(() => expect(screen.getByText(/Your thing could not load \(offline\)/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reloads).toBe(1);
  });
});
