// @vitest-environment jsdom
/**
 * The Air drum tool (#233) — reachability and honesty of the shell surface.
 * `tools_shell.test.tsx` proves every registered tool has a labelled button;
 * `app_shell.test.ts` proves App.tsx mounts a surface for it. This proves the surface
 * does what the button promises: closed until its tool is open; a Start button that
 * writes the `airDrum.enabled` dial through the command path; a live readout that
 * says what the instrument is doing (off / teach it / ready / the last hit's lead)
 * from the status store the engine loop reports into; and the same controls as the
 * settings section, so there is one set of controls, not two.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import AirDrumPanel, { describeLive } from '@/app/AirDrumPanel';
import { useTools } from '@/app/toolsStore';
import { useAirDrumStatus, ABSENT_AIR_DRUM_LIVE } from '@/app/airDrumStatus';
import { dialsStore } from '@/app/dials/settingsStore';
import { TOOLS } from '@/app/tools';
import type { AirDrumSettings } from '@/settings/schema';

const airDrum = () => dialsStore.getState().effective.airDrum as AirDrumSettings;
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  useTools.setState({ open: null });
  useAirDrumStatus.getState().reset();
});
afterEach(() => cleanup());

describe('the Air drum tool', () => {
  it('is registered as a panel tool with a label a player can read', () => {
    const tool = TOOLS.find((t) => t.id === 'airDrum');
    expect(tool?.kind).toBe('panel');
    expect(tool?.label).toBe('Air drum');
    expect(tool?.description).toMatch(/strike/i);
  });

  it('is closed until its tool is open', () => {
    const { container } = render(<AirDrumPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('opens with a Start button that turns drumming on through the dial, and Stop turns it off', async () => {
    useTools.setState({ open: 'airDrum' });
    render(<AirDrumPanel />);
    expect(airDrum().enabled).toBe(false);
    fireEvent.click(screen.getByText('Start drumming'));
    await drain();
    expect(airDrum().enabled).toBe(true);
    expect(screen.getByText('Stop drumming')).toBeTruthy();
    fireEvent.click(screen.getByText('Stop drumming'));
    await drain();
    expect(airDrum().enabled).toBe(false);
  });

  it('shows the live instrument state from the status store', () => {
    useTools.setState({ open: 'airDrum' });
    render(<AirDrumPanel />);
    expect(screen.getByTestId('air-drum-live').getAttribute('data-state')).toBe('off');
    act(() => useAirDrumStatus.getState().report({ ...ABSENT_AIR_DRUM_LIVE, enabled: true, ready: { right: false, left: false } }));
    expect(screen.getByText(/Strike once to teach/)).toBeTruthy();
    act(() =>
      useAirDrumStatus.getState().report({ enabled: true, hits: 4, predicted: 3, lastHand: 'right', lastLead: 0.048, lastPull: 0, ready: { right: true, left: false } }),
    );
    expect(screen.getByText('Right: predicted 48 ms before the strike.')).toBeTruthy();
    expect(screen.getByText('4 · 75%')).toBeTruthy();
    act(() => useAirDrumStatus.getState().report({ enabled: true, hits: 5, predicted: 3, lastHand: 'left', lastLead: -0.033, lastPull: 0, ready: { right: true, left: true } }));
    expect(screen.getByText(/Left: sounded 33 ms after/)).toBeTruthy();
  });

  it('carries the same controls as the settings section', () => {
    useTools.setState({ open: 'airDrum' });
    render(<AirDrumPanel />);
    expect(screen.getByLabelText('Drumming hands')).toBeTruthy();
    expect(screen.getByLabelText('Right hand plays')).toBeTruthy();
    expect(screen.getByLabelText(/Timing magnetism/)).toBeTruthy();
  });

  it('describeLive covers every state', () => {
    expect(describeLive(ABSENT_AIR_DRUM_LIVE)).toMatch(/Off/);
    expect(describeLive({ ...ABSENT_AIR_DRUM_LIVE, enabled: true, ready: { right: true, left: false } })).toMatch(/Ready/);
  });
});
