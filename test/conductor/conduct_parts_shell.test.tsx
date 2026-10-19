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
// The Conductor is an extension's tool (#600 S18b): it opens in the shell's frame.
import ExtensionToolPanels from '@/app/ExtensionToolPanels';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { setScoreDoc } from '@/slices/conductor/app/state';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import type { ScoreDoc } from '@/slices/conductor/score';
import type { ConductorSettings } from '@/slices/conductor/schema';
import { CONDUCTOR } from '../helpers/extensions';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const part = (id: string, midi: number, percussion = false, program?: number) => ({ id, name: id.toUpperCase(), percussion, ...(program === undefined ? {} : { program }), notes: [{ midi, start: 0, duration: 1, velocity: 0.8 }] });
const docOf = (...parts: ReturnType<typeof part>[]) => ({ v: 1, title: 't', source: 'midi', parts, tempoMap: [], timeSignatures: [], dynamics: [], fermatas: [], lengthBeats: 1 }) as unknown as ScoreDoc;

beforeEach(async () => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  await dispatchDialSetIn('conductor.parts', '');
});
afterEach(async () => {
  cleanup();
  act(() => setScoreDoc(null));
  await dispatchDialSetIn('conductor.parts', '');
});

describe.runIf(CONDUCTOR)('Parts that play', () => {
  it('two clicks from a cold load; the selection is the conductor.parts dial leaf', async () => {
    act(() => setScoreDoc(docOf(part('violin', 67), part('cello', 48), part('drums', 36, true))));
    render(
      <>
        <ToolsBar />
        <ExtensionToolPanels />
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

  it('says which parts the orchestra plays as another instrument (#334), only with the orchestra on', async () => {
    // A violin (kept), a horn (kept since #334), a piano and a guitar (no such program in the cut).
    act(() => setScoreDoc(docOf(part('violin', 67, false, 40), part('horn', 55, false, 60), part('piano', 60, false, 0), part('guitar', 52, false, 24))));
    render(
      <>
        <ToolsBar />
        <ExtensionToolPanels />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    expect(screen.getByTestId('conductor-part-piano')).toBeTruthy();
    expect(screen.queryByTestId('conductor-part-standin-piano')).toBeNull(); // orchestra off
    await dispatchDialSetIn('conductor.orchestra.enabled', true);
    await waitFor(() => expect(screen.getByTestId('conductor-part-standin-piano').textContent).toContain('string ensemble'));
    expect(screen.getByTestId('conductor-part-standin-guitar').textContent).toContain('string ensemble');
    expect(screen.queryByTestId('conductor-part-standin-violin')).toBeNull();
    expect(screen.queryByTestId('conductor-part-standin-horn')).toBeNull();
    await dispatchDialSetIn('conductor.orchestra.enabled', false);
  });

  it('shows no control for a single-part piece', () => {
    act(() => setScoreDoc(docOf(part('solo', 60))));
    render(<ExtensionToolPanels />);
    expect(screen.queryByTestId('conductor-parts')).toBeNull();
  });
});
