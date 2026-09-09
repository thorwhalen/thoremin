// @vitest-environment jsdom
/**
 * The Conductor tool (#187 PR 4) — reachability and honesty of the shell surface.
 * `tools_shell.test.tsx` proves every registered tool has a labelled button;
 * `app_shell.test.ts` proves App.tsx mounts a surface for it. This proves the surface
 * does what the button promises: closed until its tool is open; a Start button that
 * writes the `conductor.enabled` dial through the command path; a live readout that
 * says what the follower is doing (off / waiting / following at N bpm / holding) from
 * the status store the engine loop reports into; and the same piece + follower
 * controls as the settings section, so there is one set of controls, not two.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ConductorPanel, { describeLive } from '@/app/ConductorPanel';
import { useTools } from '@/app/toolsStore';
import { useConductorStatus, ABSENT_CONDUCTOR_LIVE } from '@/app/conductorStatus';
import { dialsStore } from '@/app/dials/settingsStore';
import { TOOLS } from '@/app/tools';
import type { ConductorSettings } from '@/settings/schema';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  useTools.setState({ open: null });
  useConductorStatus.getState().reset();
});
afterEach(() => cleanup());

describe('the Conductor tool', () => {
  it('is registered as a panel tool with a label a player can read', () => {
    const tool = TOOLS.find((t) => t.id === 'conductor');
    expect(tool?.kind).toBe('panel');
    expect(tool?.label).toBe('Conductor');
    expect(tool?.description).toMatch(/beat time/i);
  });

  it('is closed until its tool is open', () => {
    const { container } = render(<ConductorPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('opens with a Start button that turns conducting on through the dial, and Stop turns it off', async () => {
    useTools.setState({ open: 'conductor' });
    render(<ConductorPanel />);
    expect(conductor().enabled).toBe(false);
    fireEvent.click(screen.getByText('Start conducting'));
    await drain();
    expect(conductor().enabled).toBe(true);
    expect(screen.getByText('Stop conducting')).toBeTruthy();
    fireEvent.click(screen.getByText('Stop conducting'));
    await drain();
    expect(conductor().enabled).toBe(false);
  });

  it('shows the live follower state from the status store', () => {
    useTools.setState({ open: 'conductor' });
    render(<ConductorPanel />);
    expect(screen.getByTestId('conductor-live').getAttribute('data-state')).toBe('off');
    act(() => useConductorStatus.getState().report({ ...ABSENT_CONDUCTOR_LIVE, enabled: true, state: 'running', tempo: 72.4, beatInBar: 2, beatsPerBar: 4, confidence: 0.8, dynamics: 0.5, anchors: 9, beat: 10 }));
    expect(screen.getByText('Following at 72 bpm.')).toBeTruthy();
    expect(screen.getByText('3/4')).toBeTruthy();
    act(() => useConductorStatus.getState().report({ ...ABSENT_CONDUCTOR_LIVE, enabled: true, state: 'hold', anchors: 9 }));
    expect(screen.getByText(/Holding/)).toBeTruthy();
    act(() => useConductorStatus.getState().report({ ...ABSENT_CONDUCTOR_LIVE, enabled: true, state: 'ready', anchors: 0 }));
    expect(screen.getByText(/Waiting for your first beat/)).toBeTruthy();
  });

  it('carries the same piece and follower controls as the settings section', () => {
    useTools.setState({ open: 'conductor' });
    render(<ConductorPanel />);
    expect(screen.getByLabelText('Piece')).toBeTruthy();
    expect(screen.getByLabelText('Beating hand')).toBeTruthy();
  });

  it('describeLive covers every state', () => {
    expect(describeLive(ABSENT_CONDUCTOR_LIVE)).toMatch(/Off/);
    expect(describeLive({ ...ABSENT_CONDUCTOR_LIVE, enabled: true, state: 'ready', anchors: 2 })).toMatch(/Finding/);
    expect(describeLive({ ...ABSENT_CONDUCTOR_LIVE, enabled: true, state: 'hold', anchors: 0 })).toMatch(/first beat/);
  });
});
