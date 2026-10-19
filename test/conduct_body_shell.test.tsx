// @vitest-environment jsdom
/**
 * "Conduct with body" in the Conductor tool (#375): reachable from a cold load and does
 * what it says. The shipping rule's test: Conductor (a pinned bar button), Conduct with
 * body, Start conducting (three clicks) sets `conductor.source` through the dial write
 * path, the engine's derivation then composes the pose camera branch with the conductor,
 * and the Follow chooser offers the body's points (and the hand's again on the way back).
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
  await dispatchDialSetIn('conductor.markLevel', 'beat');
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

describe('Conduct with body', () => {
  it('three clicks from a cold load: Conductor, Conduct with body, Start conducting', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(useTools.getState().open).toBe('conductor');
    expect(screen.getByText('Conduct with hands').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByText('Conduct with body'));
    await waitFor(() => expect(conductor().source).toBe('body'));
    expect(screen.getByText('Conduct with body').getAttribute('aria-checked')).toBe('true');
    // Nothing starts the pose camera until the conductor is on.
    expect(derived()).not.toContain('body-source');
    // The Follow chooser now names the body's points, and the arm, not the hand.
    expect(screen.getByTestId('conductor-body-point')).toBeTruthy();
    expect(screen.getByText('Beating arm')).toBeTruthy();
    expect(screen.getByText('Off. Press Start, then beat time with your arm or a bounce.')).toBeTruthy();

    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    await waitFor(() => expect(derived()).toEqual(expect.arrayContaining(['conductor', 'body-source'])));
    // The body conductor routes nothing onto the hand voices.
    expect(derived()).not.toContain('body-route');

    // The body point is a dial leaf too, written through the same path.
    fireEvent.change(screen.getByTestId('conductor-body-point'), { target: { value: 'com' } });
    await waitFor(() => expect(conductor().bodyPoint).toBe('com'));

    fireEvent.click(screen.getByText('Conduct with hands'));
    await waitFor(() => expect(conductor().source).toBe('hands'));
    await waitFor(() => expect(derived()).not.toContain('body-source'));
    expect(screen.queryByTestId('conductor-body-point')).toBeNull();
    expect(screen.getByText('Beating hand')).toBeTruthy();
    await dispatchDialSetIn('conductor.bodyPoint', 'impact');
  });

  it('the level a stroke marks (#376): Conductor, Start conducting, Each stroke marks (three clicks)', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    const select = screen.getByTestId('conductor-mark-level') as HTMLSelectElement;
    expect(select.value).toBe('beat');
    fireEvent.change(select, { target: { value: 'half' } });
    await waitFor(() => expect(conductor().markLevel).toBe('half'));
    fireEvent.change(select, { target: { value: 'auto' } });
    await waitFor(() => expect(conductor().markLevel).toBe('auto'));
  });

  it('the body transport (#377): Conductor, Conduct with body, the pose toggle (three clicks), and the status speaks of the pose', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(screen.queryByTestId('conductor-transport-rules')).toBeNull();
    fireEvent.click(screen.getByText('Conduct with body'));
    await waitFor(() => expect(conductor().source).toBe('body'));
    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    const toggle = screen.getByTestId('conductor-transport-rules') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => expect((conductor() as { transport: { rules: boolean } }).transport.rules).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect((conductor() as { transport: { rules: boolean } }).transport.rules).toBe(true));
    // How the upbeat is recognised (D15): speed by default, shape on the player's choice, through the dial path.
    const upbeat = screen.getByTestId('conductor-transport-upbeat') as HTMLSelectElement;
    expect(upbeat.value).toBe('speed');
    fireEvent.change(upbeat, { target: { value: 'shape' } });
    await waitFor(() => expect((conductor() as { transport: { upbeat: string } }).transport.upbeat).toBe('shape'));
    fireEvent.change(upbeat, { target: { value: 'speed' } });
    await waitFor(() => expect((conductor() as { transport: { upbeat: string } }).transport.upbeat).toBe('speed'));
    const live = { ...useConductorStatus.getState().live, enabled: true, state: 'ready' as const, anchors: 0 };
    expect(describeLive({ ...live, transport: 'idle' }, 'body')).toMatch(/Raise your beating arm/);
    expect(describeLive({ ...live, transport: 'armed' }, 'body')).toMatch(/upbeat/);
    expect(describeLive({ ...live, state: 'hold', anchors: 5, transport: 'holding' }, 'body')).toMatch(/drop your arm to stop/);
    expect(describeLive({ ...live, transport: 'off' })).toBe('Waiting for your first beat.');
    fireEvent.click(screen.getByText('Conduct with hands'));
    await waitFor(() => expect(conductor().source).toBe('hands'));
  });

  it('describeLive speaks of the hand by default', () => {
    const off = { ...useConductorStatus.getState().live, enabled: false };
    expect(describeLive(off)).toBe('Off. Press Start, then beat time with your hand.');
  });
});
