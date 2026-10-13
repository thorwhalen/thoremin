// @vitest-environment jsdom
/**
 * The face categorizer session is REACHABLE (#330 P2, the shipping rule): the Tools launcher
 * lists it, labelled and described, one click from anywhere; opening it mounts the shell's frame
 * and loads the lazy extension's panel; closing it unmounts the panel and stops a recording. Its
 * React half is fetched only when the tool opens (the network half is the browser smoke,
 * `smoke/tests/faces.smoke.ts`; the bundle half is `npm run check:lazy`).
 *
 * Clicks from a cold load: Tools (1), "Your faces" (2), "Record my faces" (3).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { SHELL_TOOLS, withExtensionTools } from '@/app/shellTools';
import { TOOLS } from '@/app/tools';
import { EXTENSION_TOOL_DECLS } from '@/app/extensions';
import { appFeatureDemand } from '@thoremin/sdk-ui/featureDemand';
import { faceSessionStore } from '@thoremin/ext-faces/app/faceSession';
import { FACES } from '../helpers/extensions';

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

beforeEach(() => {
  useTools.setState({ open: null, launcherOpen: false });
  faceSessionStore().getState().reset();
});
afterEach(cleanup);

describe.runIf(FACES)('the face session tool is reachable from the shell', () => {
  it('is an extension tool, listed after the core ones, opening a panel', () => {
    const tool = SHELL_TOOLS.find((t) => t.id === 'faces')!;
    expect(tool).toBeDefined();
    expect(tool.kind).toBe('panel');
    expect(tool.group).toBe('mode');
    expect(TOOLS.some((t) => t.id === 'faces')).toBe(false);
    expect(EXTENSION_TOOL_DECLS.map((d) => d.id)).toContain('faces');
  });

  it('Tools, then "Your faces": the frame opens and the lazy panel loads; the X closes it', async () => {
    render(<Shell />);
    expect(document.querySelector('[data-tool="faces"]')).toBeNull();
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Your faces', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    const frame = document.querySelector('[data-tool="faces"]')!;
    expect(frame).not.toBeNull();
    expect(frame.textContent).toContain(SHELL_TOOLS.find((t) => t.id === 'faces')!.description);
    // The extension's panel arrives through the lazy placeholder.
    expect(await screen.findByRole('button', { name: 'Record my faces' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close the Your faces panel' }));
    expect(document.querySelector('[data-tool="faces"]')).toBeNull();
  });

  it('closing the tool while recording stops the take and releases the face features', async () => {
    render(<Shell />);
    act(() => useTools.getState().toggleTool('faces'));
    fireEvent.click(await screen.findByRole('button', { name: 'Record my faces' }));
    expect(faceSessionStore().getState().phase).toBe('rest');
    expect(appFeatureDemand.owners()).toContain('faces');
    act(() => useTools.getState().close());
    expect(faceSessionStore().getState().phase).toBe('idle');
    expect(appFeatureDemand.owners()).not.toContain('faces');
  });

  it('an extension tool may not reuse a core tool id', () => {
    expect(() => withExtensionTools(TOOLS, [{ id: 'trainer', label: 'X', description: 'x', group: 'tool', defaultPinned: false }])).toThrow(/already uses/);
  });
});
