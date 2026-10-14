// @vitest-environment jsdom
/**
 * "Parts that play" in the Conductor tool (#471): reachable from a cold load and does what
 * it says. Two clicks from a cold load (Conductor, then a part's checkbox) once a piece with
 * several parts is loaded; each click writes the single dial leaf `conductor.parts` through
 * the dial write path; the last part left on cannot be switched off; switching everything
 * back on stores the empty (all parts) selection; a single-part piece shows no control.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ConductorPanel from '@/app/ConductorPanel';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import type { ScoreDoc } from '@/score';
import type { ConductorSettings } from '@/settings/schema';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const part = (id: string, midi: number, percussion = false) => ({ id, name: id.toUpperCase(), percussion, notes: [{ midi, start: 0, duration: 1, velocity: 0.8 }] });
const docOf = (...parts: ReturnType<typeof part>[]) => ({ v: 1, title: 't', source: 'midi', parts, tempoMap: [], timeSignatures: [], dynamics: [], fermatas: [], lengthBeats: 1 }) as unknown as ScoreDoc;

beforeEach(async () => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  await dispatchDialSetIn('conductor.parts', '');
});
afterEach(async () => {
  cleanup();
  act(() => useControls.getState().setScoreDoc(null));
  await dispatchDialSetIn('conductor.parts', '');
});

describe('Parts that play', () => {
  it('two clicks from a cold load; the selection is the conductor.parts dial leaf', async () => {
    act(() => useControls.getState().setScoreDoc(docOf(part('violin', 67), part('cello', 48), part('drums', 36, true))));
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    const violin = screen.getByTestId('conductor-part-violin') as HTMLInputElement;
    const cello = screen.getByTestId('conductor-part-cello') as HTMLInputElement;
    expect([violin.checked, cello.checked]).toEqual([true, true]);
    expect(conductor().parts).toBe('');

    fireEvent.click(cello);
    await waitFor(() => expect(conductor().parts).toBe('violin,drums'));
    expect(cello.checked).toBe(false);
    fireEvent.click(screen.getByTestId('conductor-part-drums'));
    await waitFor(() => expect(conductor().parts).toBe('violin'));
    // The last one on cannot be switched off.
    expect(violin.disabled).toBe(true);
    // Everything back on is the empty selection (all parts).
    fireEvent.click(cello);
    fireEvent.click(screen.getByTestId('conductor-part-drums'));
    await waitFor(() => expect(conductor().parts).toBe(''));
  });

  it('shows no control for a single-part piece', () => {
    act(() => useControls.getState().setScoreDoc(docOf(part('solo', 60))));
    render(<ConductorPanel />);
    expect(screen.queryByTestId('conductor-parts')).toBeNull();
  });
});
