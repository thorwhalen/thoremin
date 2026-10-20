// @vitest-environment jsdom
/**
 * The Patcher is REACHABLE (#14, the shipping rule) and its inspector writes only by DISPATCH.
 *
 * Clicks from a cold load: Tools (1), "Patcher" (2): the live graph is drawn. A third click on a
 * node opens its inspector. The tool's React half (and React Flow) is fetched only when it opens:
 * the bundle half is `npm run check:lazy`.
 *
 * The write path: every control in the inspector dispatches `dial.set` or `dial.setIn` through the
 * command registry (the single write path, #87), never the dials store's own setter. The static
 * half of that claim is the AST guard `test/dials_write_path.test.ts`, which scans this
 * extension's `panels/` (asserted below) and a text check of its sources; the dynamic half is a
 * real edit, observed at the registry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ToolsLauncher from '@/app/ToolsLauncher';
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { SHELL_TOOLS } from '@/app/shellTools';
import { TOOLS } from '@/app/tools';
import { defaultGraph } from '@/app/graph';
// The dial write path's host (the app installs it when these load).
import { dialsStore } from '@/app/dials/settingsStore';
import '@/app/dispatchDial';
import '@/app/dials/useDialsSettings';
import { registry } from '@/app/commands/registry';
import { useLiveGraph } from '@thoremin/ext-patcher/app/liveGraph';
import NodeInspector from '@thoremin/ext-patcher/panels/NodeInspector';
import { ALL_EXTENSION_DIRS, hasExtension } from '../helpers/extensions';

const PATCHER = hasExtension('patcher');
const SRC = 'packages/ext-patcher/src';

// React Flow measures its viewport; jsdom has no layout engine.
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

const Shell = () => (
  <>
    <ToolsBar />
    <ToolsLauncher />
    <ExtensionToolPanels />
  </>
);

beforeEach(() => {
  useTools.setState({ open: null, launcherOpen: false });
  useLiveGraph.setState({ spec: defaultGraph(), version: 0, reader: { getOutput: () => 0.5 } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.runIf(PATCHER)('the Patcher tool is reachable from the shell', () => {
  it('is an extension tool, listed in the launcher, opening a panel', () => {
    const tool = SHELL_TOOLS.find((t) => t.id === 'patcher')!;
    expect(tool).toBeDefined();
    expect(tool.kind).toBe('panel');
    expect(TOOLS.some((t) => t.id === 'patcher')).toBe(false);
  });

  it('Tools, then "Patcher": the frame opens and the lazy panel draws the live graph; the X closes it', async () => {
    render(<Shell />);
    fireEvent.click(screen.getByText('Tools'));
    const row = await screen.findByText('Patcher', { selector: '[role=dialog] span' });
    act(() => {
      fireEvent.click(row.closest('button, a')!);
    });
    expect(document.querySelector('[data-tool="patcher"]')).not.toBeNull();
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-patcher]');
      if (!el) throw new Error('not loaded yet');
      return el;
    });
    expect(panel.textContent).toContain(`${defaultGraph().nodes.length} parts`);
    fireEvent.click(screen.getByRole('button', { name: 'Close the Patcher panel' }));
    expect(document.querySelector('[data-tool="patcher"]')).toBeNull();
  });

  it('says it is waiting while no engine runs', async () => {
    useLiveGraph.setState({ spec: null, version: -1, reader: null });
    render(<Shell />);
    act(() => useTools.getState().toggleTool('patcher'));
    expect(await waitFor(() => document.querySelector('[data-patcher-empty]') ?? Promise.reject(new Error('not yet')))).toBeTruthy();
  });
});

describe.runIf(PATCHER)('the inspector writes only by dispatch', () => {
  it('the write-path guard scans the patcher panels, and no patcher source names the dials store setter', () => {
    expect(ALL_EXTENSION_DIRS.some(({ dir }) => dir.replace(/\\/g, '/').endsWith(SRC))).toBe(true);
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));
    for (const file of files(SRC)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\b(setDial|resetDial|dialsStore)\b/);
      expect(text, file).not.toMatch(/useDialsSettings\(\)\.set\b|\{[^}]*\bset\b[^}]*\}\s*=\s*useDialsSettings/);
    }
  });

  it('shows the live outputs and the settings that feed a node, and an edit dispatches dial.set', async () => {
    const dispatch = vi.spyOn(registry, 'dispatch');
    const storeSet = vi.spyOn(dialsStore, 'set');
    render(<NodeInspector spec={defaultGraph()} nodeId="map" reader={{ getOutput: () => 0.5 }} />);
    const inspector = document.querySelector('[data-patcher-inspector="map"]')!;
    expect(inspector.textContent).toContain('0.500');
    const before = dialsStore.getState().effective['master.magnetism'] as number;
    const next = before === 0.5 ? 0.25 : 0.5;
    const label = screen.getByText(/magnetism/i, { selector: 'span' });
    const input = label.parentElement!.querySelector('input')!;
    fireEvent.change(input, { target: { value: String(next) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(dialsStore.getState().effective['master.magnetism']).toBe(next));
    expect(dispatch).toHaveBeenCalledWith('dial.set', { key: 'master.magnetism', value: next });
    // The store's setter is reached only from inside the command, never before the dispatch.
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(storeSet.mock.invocationCallOrder[0]);
    dialsStore.set('master.magnetism', before);
  });

  it('a structured dial is edited leaf by leaf with dial.setIn', async () => {
    const dispatch = vi.spyOn(registry, 'dispatch');
    render(<NodeInspector spec={defaultGraph()} nodeId="overlay" reader={null} />);
    const overlay = document.querySelector('details[data-dial="overlay"]') as HTMLDetailsElement;
    overlay.open = true;
    const box = overlay.querySelector('input[type=checkbox]') as HTMLInputElement;
    const path = `overlay.${box.closest('label')!.textContent}`;
    const was = box.checked;
    fireEvent.click(box);
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith('dial.setIn', { path, value: !was }));
    await waitFor(() => expect(dialsStore.getState().effective.overlay).toBeDefined());
  });
});
