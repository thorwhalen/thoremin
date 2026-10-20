// @vitest-environment jsdom
/**
 * The face categorizer session is REACHABLE (#330 P2, the shipping rule): the Tools launcher
 * lists it, labelled and described, one click from anywhere; opening it mounts the shell's frame
 * and loads the lazy extension's panel; closing it unmounts the panel and stops a recording. Its
 * React half is fetched only when the tool opens (the network half is the browser smoke,
 * `smoke/tests/faces.smoke.ts`; the bundle half is `npm run check:lazy`).
 *
 * Clicks from a cold load: Tools (1), "Your faces" (2), "Record my faces" (3: Explore, the camera
 * read, #385 E2), "Start capturing" or Space (4). Testing a saved
 * categorizer (P3): Tools, "Your faces", Open, "Test with my face" (4).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
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
// The dial write path's host (the app installs it when these load).
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialPatch } from '@/app/dispatchDial';
import '@/app/dials/useDialsSettings';
import { registry } from '@/app/commands/registry';
import { installKeyboardShortcuts } from '@/app/keyboardShortcuts';
import { carveCapture } from '@thoremin/sdk-ui/enroll/capture';

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

  it('"Record my faces" opens Explore: the face features are claimed, the bars and the ring shown, nothing recorded; closing the tool releases them (#385 E2)', async () => {
    render(<Shell />);
    act(() => useTools.getState().toggleTool('faces'));
    fireEvent.click(await screen.findByRole('button', { name: 'Record my faces' }));
    expect(faceSessionStore().getState().phase).toBe('explore');
    expect(appFeatureDemand.owners()).toContain('faces');
    expect(carveCapture()?.state()).toBe('explore');
    expect(document.querySelector('[data-faces-recording="explore"]')).not.toBeNull();
    expect(document.querySelector('[data-hold-ring]')).not.toBeNull();
    expect(await screen.findByText(/What the camera reads/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start capturing (Space)' })).toBeTruthy();
    act(() => useTools.getState().close());
    expect(faceSessionStore().getState().phase).toBe('idle');
    expect(appFeatureDemand.owners()).not.toContain('faces');
    expect(carveCapture()).toBeNull();
  });

  it('Space starts capturing from Explore (the carve command), and is left alone when nothing is live; closing the tool stops the take', async () => {
    const uninstall = installKeyboardShortcuts(window);
    try {
      render(<Shell />);
      act(() => useTools.getState().toggleTool('faces'));
      const record = await screen.findByRole('button', { name: 'Record my faces' });
      // Nothing live: Space is not taken from the page.
      const idle = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(idle);
      });
      expect(idle.defaultPrevented).toBe(false);
      fireEvent.click(record);
      expect(faceSessionStore().getState().phase).toBe('explore');
      const space = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      act(() => {
        window.dispatchEvent(space);
      });
      expect(space.defaultPrevented).toBe(true);
      await waitFor(() => expect(faceSessionStore().getState().phase).toBe('rest'));
      expect(document.querySelector('[data-faces-recording="rest"]')).not.toBeNull();
      act(() => useTools.getState().close());
      expect(faceSessionStore().getState().phase).toBe('idle');
      expect(appFeatureDemand.owners()).not.toContain('faces');
    } finally {
      uninstall();
    }
  });

  it('an extension tool may not reuse a core tool id', () => {
    expect(() => withExtensionTools(TOOLS, [{ id: 'commands', label: 'X', description: 'x', group: 'tool', defaultPinned: false }])).toThrow(/already uses/);
  });
});

describe.runIf(FACES)('testing and correcting a saved categorizer is reachable (#330 P3)', () => {
  /** Clicks from a cold load, with a saved categorizer: Tools (1), "Your faces" (2), Open (3),
   *  "Test with my face" (4). The dials, the corrections and Export are on the same screen. */
  it('Open, then "Test with my face": the readout, the dials, the corrections, Export; closing the tool ends the test', async () => {
    const { createFaceModelStore } = await import('@thoremin/ext-faces/app/models');
    const { faceTestStore } = await import('@thoremin/ext-faces/app/faceSession');
    const { importCategorizer } = await import('@thoremin/sdk/enroll/categorizer');
    const file = await import('./fixtures/two_faces.categorizer.json');
    const parsed = importCategorizer(file.default);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const saved = createFaceModelStore();
    await saved.save('Shell test', { categorizer: parsed.categorizer });

    render(<Shell />);
    act(() => useTools.getState().toggleTool('faces'));
    expect(await screen.findByRole('button', { name: 'Import file' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Shell test' }));
    const testButton = await screen.findByRole('button', { name: 'Test with my face' });
    expect(screen.getByRole('slider', { name: 'Sensitivity' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Reject radius' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Distance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export file' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add more of my faces' })).toBeTruthy();
    expect(document.querySelectorAll('[data-face-move]').length).toBeGreaterThan(0);
    fireEvent.click(testButton);
    expect(faceTestStore().getState().running).toBe(true);
    expect(appFeatureDemand.owners()).toContain('faces-test');
    // No camera in jsdom: the readout says so rather than guessing.
    expect(await screen.findByText(/No face in view|Reading/)).toBeTruthy();
    const corrections = screen.getAllByRole('button', { name: /^This face is / });
    expect(corrections.map((b) => b.getAttribute('aria-label'))).toEqual(['This face is smile', 'This face is surprise']);
    // With no face in view there is nothing to add.
    for (const b of corrections) expect((b as HTMLButtonElement).disabled).toBe(true);
    act(() => useTools.getState().close());
    expect(faceTestStore().getState().running).toBe(false);
    expect(appFeatureDemand.owners()).not.toContain('faces-test');
    for (const s of await saved.list()) await saved.remove(s.id);
  });
});

describe.runIf(FACES)('playing a saved categorizer from the tool (#357)', () => {
  /** One click from the tool: Tools (1), "Your faces" (2), "Play it" (3). */
  it('"Play it" points the current instrument at it through the dial commands, and then says Playing', async () => {
    const { createFaceModelStore } = await import('@thoremin/ext-faces/app/models');
    const { importCategorizer } = await import('@thoremin/sdk/enroll/categorizer');
    const { GENERAL_CATEGORIZER, AUTO_DEGREE } = await import('@thoremin/ext-faces/schema');
    const file = await import('./fixtures/two_faces.categorizer.json');
    const parsed = importCategorizer(file.default);
    if (!parsed.ok) throw new Error('fixture');
    const saved = createFaceModelStore();
    const { id } = await saved.save('Play test', { categorizer: parsed.categorizer });
    // An instrument whose face plays nothing, with a chord chosen for a category of another one.
    dispatchDialPatch([['faceCategorizer.id', GENERAL_CATEGORIZER], ['face.mapping', 'none'], ['faceCategorizer.degrees.cat-1', 3]]);
    const effective = () => dialsStore.getState().effective as Record<string, unknown>;
    const dispatch = vi.spyOn(registry, 'dispatch');

    try {
      render(<Shell />);
      act(() => useTools.getState().toggleTool('faces'));
      const play = await screen.findByRole('button', { name: 'Play Play test' });
      act(() => {
        fireEvent.click(play);
      });
      await waitFor(() => expect((effective().faceCategorizer as { id: string }).id).toBe(id));
      // The section's own writes: the face chords on, every category's chord back to Auto.
      expect(effective()['face.mapping']).toBe('chord');
      expect((effective().faceCategorizer as { degrees: Record<string, number> }).degrees['cat-1']).toBe(AUTO_DEGREE);
      // Chosen now, and Playing once the instrument has resolved it: no second click to put the
      // chords back to Auto.
      expect(await screen.findByText('Playing', {}, { timeout: 15000 })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Play Play test' })).toBeNull();
      // Through the command registry, as one `dial.patch` (one undoable step).
      const patches = dispatch.mock.calls.filter(([cmd]) => cmd === 'dial.patch');
      expect(patches).toHaveLength(1);
    } finally {
      dispatch.mockRestore();
      dispatchDialPatch([['faceCategorizer.id', GENERAL_CATEGORIZER], ['face.mapping', 'none']]);
      for (const m of await saved.list()) await saved.remove(m.id);
    }
  });
});
