// @vitest-environment jsdom
/**
 * "Dance the orchestra" in the Conductor tool (#380): reachable from a cold load and does
 * what it says. Conductor (a pinned bar button), Dance the orchestra, Start conducting
 * (three clicks) sets `conductor.source` to `dancer` through the dial write path; the
 * derivation then composes the pose branch (its `body-pulse`) with the conductor; the
 * conductor's beat controls give way to the dancer's (the clamp, where the step lands).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ConductorPanel, { describeLive } from '@/app/ConductorPanel';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { dialsStore } from '@/app/dials/settingsStore';
import { useConductorStatus } from '@/app/conductorStatus';
import { branchIdsFor } from '@/app/graph';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import type { DerivationSettings } from '@/instruments/derive';
import type { ConductorSettings } from '@/settings/schema';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const derived = () => branchIdsFor(useControls.getState() as unknown as DerivationSettings);

const reset = async () => {
  await dispatchDialSetIn('conductor.enabled', false);
  await dispatchDialSetIn('conductor.source', 'hands');
  await dispatchDialSetIn('conductor.dancer.range', 0.1);
};
beforeEach(async () => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  useConductorStatus.getState().reset();
  await reset();
});
afterEach(async () => {
  cleanup();
  await reset();
});

describe('Dance the orchestra', () => {
  it('three clicks from a cold load: Conductor, Dance the orchestra, Start conducting', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(useTools.getState().open).toBe('conductor');

    fireEvent.click(screen.getByText('Dance the orchestra'));
    await waitFor(() => expect(conductor().source).toBe('dancer'));
    expect(screen.getByText('Dance the orchestra').getAttribute('aria-checked')).toBe('true');
    expect(derived()).not.toContain('body-source');
    expect(screen.getByText('Off. Press Start, then dance: the piece starts on your step.')).toBeTruthy();
    // The conductor's stroke controls give way to the dancer's.
    expect(screen.queryByTestId('conductor-mark-level')).toBeNull();
    expect(screen.getByTestId('conductor-dancer-range')).toBeTruthy();
    expect(screen.getByTestId('conductor-dancer-phase')).toBeTruthy();

    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    await waitFor(() => expect(derived()).toEqual(expect.arrayContaining(['conductor', 'body-source'])));
    expect(derived()).not.toContain('body-route');
    expect(derived()).not.toContain('song-pace');

    // The clamp is a dial leaf, written through the same path.
    fireEvent.change(screen.getByTestId('conductor-dancer-range'), { target: { value: '0.05' } });
    await waitFor(() => expect(conductor().dancer.range).toBeCloseTo(0.05, 6));

    fireEvent.click(screen.getByText('Conduct with hands'));
    await waitFor(() => expect(conductor().source).toBe('hands'));
    await waitFor(() => expect(derived()).not.toContain('body-source'));
    expect(screen.getByTestId('conductor-mark-level')).toBeTruthy();
    expect(screen.queryByTestId('conductor-dancer-range')).toBeNull();
  });

  it('the status speaks of the dance', () => {
    const live = { enabled: true, state: 'ready', tempo: 0, beat: 0, beatInBar: 0, beatsPerBar: 4, confidence: 0, dynamics: 0.5, anchors: 0 } as const;
    expect(describeLive(live, 'dancer')).toMatch(/starts on your step once your rhythm holds/);
    expect(describeLive({ ...live, state: 'running', tempo: 123.6 }, 'dancer')).toBe('Following your dance at 124 bpm.');
  });
});
