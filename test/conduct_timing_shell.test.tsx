// @vitest-environment jsdom
/**
 * "Learn my timing" (#427) from a cold load: Tools' Conductor, Conduct with body, and the
 * take's button is in view (three clicks to start a take). A finished take is kept through
 * the `conductor.timing.keep` command into the per-device pref, shown, and forgotten
 * through `conductor.timing.clear`; and the conductor's `leadOffsets` port is connected in
 * every composed conductor graph (the structural guard: a pref nobody reads is not shipped).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ConductorPanel from '@/app/ConductorPanel';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { useConductorStatus } from '@/app/conductorStatus';
import { useLeadCalibration, cancelLeadTake } from '@/app/conductorLead';
import '@/app/conductorLeadHost';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { createAppRegistry } from '@/nodes/browser';
import { setClickPlayer } from '@thoremin/sdk-ui/enroll/click';

const reset = async () => {
  cancelLeadTake();
  useControls.getState().setConductorLeadOffsets({});
  await dispatchDialSetIn('conductor.source', 'hands');
  await dispatchDialSetIn('conductor.enabled', false);
};
beforeEach(async () => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  useConductorStatus.getState().reset();
  setClickPlayer({ play: vi.fn(), stop: vi.fn() });
  await reset();
});
afterEach(async () => {
  cleanup();
  await reset();
  setClickPlayer(null);
});

describe('Learn my timing', () => {
  it('three clicks from a cold load: Conductor, Conduct with body, Learn my timing', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    // Reading the hands, there is no timing to learn.
    expect(screen.queryByText('Learn my timing...')).toBeNull();
    fireEvent.click(screen.getByText('Conduct with body'));
    await waitFor(() => expect(screen.getByText('Learn my timing...')).toBeTruthy());
    expect(screen.getByText(/Not learned/)).toBeTruthy();

    fireEvent.click(screen.getByText('Learn my timing...'));
    expect(useLeadCalibration.getState().phase).toBe('listening');
    expect(screen.getByText(/Listen to the count-in/)).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(useLeadCalibration.getState().phase).toBe('idle');
  });

  it('while conducting, the take waits (the score would start over the click)', async () => {
    await dispatchDialSetIn('conductor.source', 'body');
    await dispatchDialSetIn('conductor.enabled', true);
    useTools.getState().openTool('conductor');
    render(<ConductorPanel />);
    await waitFor(() => expect((screen.getByText('Learn my timing...') as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByText(/Stop conducting to learn it/)).toBeTruthy();
    await dispatchDialSetIn('conductor.enabled', false);
    // Started mid-take: the take is cancelled, not scored.
    await waitFor(() => expect((screen.getByText('Learn my timing...') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Learn my timing...'));
    expect(useLeadCalibration.getState().phase).toBe('listening');
    await dispatchDialSetIn('conductor.enabled', true);
    await waitFor(() => expect(useLeadCalibration.getState().phase).toBe('idle'));
    await dispatchDialSetIn('conductor.enabled', false);
  });

  it('a take that measured nothing offers no Keep', async () => {
    await dispatchDialSetIn('conductor.source', 'body');
    useTools.getState().openTool('conductor');
    render(<ConductorPanel />);
    useLeadCalibration.getState().start({ beats: [1, 2], startT: 0, endT: 3, bpm: 60, joints: ['trunk'], side: 'auto', droppedAtStart: 0 });
    useLeadCalibration.getState().finish({ lags: { trunk: { lagS: 0.05, r: 0.6, n: 16, seS: 0.03, kept: 16, halves: [0, 0.1] } }, refused: { trunk: 'loose' }, offsets: {}, clickInterval: 1 });
    await waitFor(() => expect(screen.getByText(/trunk: too uneven to measure, not corrected/)).toBeTruthy());
    expect(screen.queryByText('Keep')).toBeNull();
    expect(screen.getByText(/nothing changes/)).toBeTruthy();
  });

  it('a finished take: per joint, Keep writes the pref, the line shows it, Forget it clears it', async () => {
    await dispatchDialSetIn('conductor.source', 'body');
    useTools.getState().openTool('conductor');
    render(<ConductorPanel />);
    useControls.getState().setConductorLeadOffsets({ elbow: -0.03 });
    useLeadCalibration.getState().start({ beats: [1, 2], startT: 0, endT: 3, bpm: 60, joints: ['trunk', 'wrist.right'], side: 'right', droppedAtStart: 0 });
    useLeadCalibration.getState().finish({
      lags: { trunk: { lagS: 0.05, r: 0.7, n: 16, seS: 0.012, kept: 16, halves: [0.04, 0.06] }, 'wrist.right': { lagS: 0.2, r: 0.2, n: 9, seS: 0.05, kept: 9, halves: [0.1, 0.3] } },
      refused: { 'wrist.right': 'lock' },
      offsets: { trunk: 0.05 },
      clickInterval: 1,
    });
    await waitFor(() => expect(screen.getByText(/trunk: \+50 ms \(±12 ms\)/)).toBeTruthy());
    expect(screen.getByText(/right wrist: did not keep the click, not corrected/)).toBeTruthy();
    fireEvent.click(screen.getByText('Keep'));
    // Merged: the elbow kept from before.
    await waitFor(() => expect(useControls.getState().conductorPrefs.leadOffsets).toEqual({ elbow: -0.03, trunk: 0.05 }));
    await waitFor(() => expect(screen.getByText(/trunk \+50 ms/)).toBeTruthy());
    fireEvent.click(screen.getByText('Forget it'));
    await waitFor(() => expect(useControls.getState().conductorPrefs.leadOffsets).toEqual({}));
  });
});

describe('structural guard: conductor.leadOffsets is connected whenever the conductor is composed', () => {
  const registry = createAppRegistry();
  for (const source of ['hands', 'body', 'dancer'] as const) {
    it(source, () => {
      const ids = branchIdsFor({ conductor: { enabled: true, source } });
      const { spec } = composeInstrumentGraph(ids, {}, registry);
      expect(spec.edges.some((e) => e.from.port === 'conductorLeadOffsets' && e.to.node === 'conductor' && e.to.port === 'leadOffsets')).toBe(true);
    });
  }
});
