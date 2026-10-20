// @vitest-environment jsdom
/**
 * The orchestra's reachability (#187 PR 5; the shipping rule). From a cold load: the
 * Conductor button in the tools bar (pinned by default) opens the panel, whose first
 * controls are Start and, under the piece, "Play with the orchestra", which names the
 * download before it happens. This pins that the toggle is there in the tool panel,
 * writes `conductor.orchestra.enabled` through the command path, shows the synth's load
 * (with progress) from the status store the engine loop reports into, and that the level
 * sliders write their dial leaves.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
// The Conductor is an extension's tool (#600 S18b): it opens in the shell's frame.
import ExtensionToolPanels from '@/app/tools/ExtensionToolPanels';
import { useTools } from '@/app/tools/toolsStore';
import { SHELL_TOOLS as TOOLS } from '@/app/tools/shellTools';
import { useOrchestraStatus } from '@/slices/conductor/app/orchestraStatus';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { SOUNDFONT_SIZE_MB } from '@/slices/conductor/nodes/orchestra';
import type { ConductorSettings } from '@/slices/conductor/schema';
import { CONDUCTOR } from '../helpers/extensions';

const orchestra = () => (dialsStore.getState().effective.conductor as ConductorSettings).orchestra;
const drain = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

beforeEach(async () => {
  useTools.setState({ open: null });
  useOrchestraStatus.getState().reset();
  await dispatchDialSetIn('conductor.orchestra.enabled', false);
});
afterEach(() => cleanup());

describe.runIf(CONDUCTOR)('the orchestra, from a cold load', () => {
  it('is one tool button away: the Conductor is pinned to the bar by default', () => {
    expect(TOOLS.find((t) => t.id === 'conductor')?.defaultPinned).toBe(true);
  });

  it('the Conductor panel offers the orchestra, naming the download, off by default', () => {
    useTools.setState({ open: 'conductor' });
    render(<ExtensionToolPanels />);
    const toggle = screen.getByLabelText('Play with the orchestra') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(new RegExp(`${SOUNDFONT_SIZE_MB} MB download`))).toBeTruthy();
    expect(screen.getByText(/plays on the instrument's own synth/)).toBeTruthy();
  });

  it('the toggle writes conductor.orchestra.enabled, and the readout shows the load', async () => {
    useTools.setState({ open: 'conductor' });
    render(<ExtensionToolPanels />);
    fireEvent.click(screen.getByLabelText('Play with the orchestra'));
    await drain();
    expect(orchestra().enabled).toBe(true);
    act(() => useOrchestraStatus.getState().report({ phase: 'loading', message: 'Loading orchestra...', progress: 0.4 }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    act(() => useOrchestraStatus.getState().report({ phase: 'active', message: 'Playing' }));
    expect(screen.getByTestId('orchestra-controls').querySelector('[data-load-phase]')?.getAttribute('data-load-phase')).toBe('active');
  });

  it('the level sliders write their leaves of the dial', async () => {
    useTools.setState({ open: 'conductor' });
    await dispatchDialSetIn('conductor.orchestra.enabled', true);
    render(<ExtensionToolPanels />);
    fireEvent.change(screen.getByTestId('orchestra-section-strings'), { target: { value: '0.5' } });
    fireEvent.change(screen.getByTestId('orchestra-volume'), { target: { value: '0.3' } });
    await drain();
    expect(orchestra().sections.strings).toBe(0.5);
    expect(orchestra().volume).toBe(0.3);
  });

  it('the pizzicato switch is there once the orchestra is on, off by default, and writes its leaf (#332)', async () => {
    useTools.setState({ open: 'conductor' });
    await dispatchDialSetIn('conductor.orchestra.enabled', true);
    render(<ExtensionToolPanels />);
    const box = screen.getByTestId('orchestra-pizzicato') as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await drain();
    expect(orchestra().pizzicato).toBe(true);
    await dispatchDialSetIn('conductor.orchestra.pizzicato', false);
  });
});
