// @vitest-environment jsdom
/**
 * The settings panels' newer controls write the store (#391 item 9): the handedness dwell
 * in the Hand section (including a saved value that is not one of the offered choices),
 * and the conductor's tempo-sense
 * (prior) chooser and orchestra controls. (The MIDI section's toggle moved with its slice, #600
 * S13: `test/midi/midi_panel_dispatch.test.tsx`.) Each one dispatches through the command
 * registry (`dispatchDialSet` / `dispatchDialSetIn`), so a write reaches both the dials
 * store and the hot store the graph reads. The reachability tests (`hand_panel`,
 * `midi_panel`, `conductor_panel`) cover the controls' presence; this covers their handlers.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { HandControls } from '@/app/dials/panels/hand';
import { ConductorControls } from '@/app/dials/panels/conductor';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSet, dispatchDialSetIn } from '@/app/dispatchDial';
import { useControls } from '@/app/store';
import type { ConductorSettings } from '@/settings/schema';

const effective = (key: string) => dialsStore.getState().effective[key];
const conductor = () => effective('conductor') as ConductorSettings;
const drain = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

afterEach(() => {
  cleanup();
});

describe('Hand: the handedness dwell select', () => {
  it('a saved dwell that is not an offered choice is shown in order, and a pick writes the store', async () => {
    await dispatchDialSet('hands.handednessDwell', 4);
    await drain();
    expect(effective('hands.handednessDwell')).toBe(4);
    render(<HandControls />);
    const select = screen.getByLabelText('Handedness dwell') as HTMLSelectElement;
    expect(select.value).toBe('4');
    const values = Array.from(select.options).map((o) => Number(o.value));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Array.from(select.options).find((o) => o.value === '4')?.textContent).toBe('4 frames');

    fireEvent.change(select, { target: { value: '8' } });
    await drain();
    expect(effective('hands.handednessDwell')).toBe(8);
    expect(useControls.getState().hands.handednessDwell).toBe(8);
    // Once a listed value is chosen, the ad hoc entry is gone.
    expect(Array.from(select.options).some((o) => o.value === '4')).toBe(false);

    fireEvent.change(select, { target: { value: '0' } });
    await drain();
    expect(useControls.getState().hands.handednessDwell).toBe(0);
  });

  it('the note source select dispatches the handMap leaf', async () => {
    render(<HandControls />);
    const select = screen.getByText('Note source').querySelector('select') as HTMLSelectElement;
    const before = select.value;
    const other = before === 'wrist' ? 'index' : 'wrist';
    fireEvent.change(select, { target: { value: other } });
    await drain();
    expect((effective('handMap') as { positionSource: string }).positionSource).toBe(other);
    expect(useControls.getState().handMap.positionSource).toBe(other);
    fireEvent.change(select, { target: { value: before } });
    await drain();
    expect(useControls.getState().handMap.positionSource).toBe(before);
  });
});

describe('Conductor: the tempo sense (prior) and the orchestra', () => {
  it('the prior chooser is disabled while conducting is off; once on, each prior writes the dial and the hot store', async () => {
    render(<ConductorControls />);
    const prior = screen.getByLabelText('Tempo sense') as HTMLSelectElement;
    expect(prior.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Conduct the score'));
    await drain();
    expect(prior.disabled).toBe(false);
    const start = conductor().prior;
    for (const value of ['oscillator', 'trend', 'blend'] as const) {
      fireEvent.change(prior, { target: { value } });
      await drain();
      expect(conductor().prior).toBe(value);
      expect(useControls.getState().conductor.prior).toBe(value);
      expect(prior.value).toBe(value);
    }
    // Restore for the other tests.
    await dispatchDialSetIn('conductor.prior', start);
    fireEvent.click(screen.getByLabelText('Conduct the score'));
    await drain();
    expect(conductor().enabled).toBe(false);
  });

  it('the orchestra toggle shows its levels; the volume and a section level write the dial and the hot store', async () => {
    render(<ConductorControls />);
    expect(screen.queryByTestId('orchestra-volume')).toBeNull();
    fireEvent.click(screen.getByLabelText('Play with the orchestra'));
    await drain();
    expect(conductor().orchestra.enabled).toBe(true);
    expect(useControls.getState().conductor.orchestra.enabled).toBe(true);

    fireEvent.change(screen.getByTestId('orchestra-volume'), { target: { value: '0.35' } });
    await drain();
    expect(conductor().orchestra.volume).toBeCloseTo(0.35, 10);
    expect(useControls.getState().conductor.orchestra.volume).toBeCloseTo(0.35, 10);

    fireEvent.change(screen.getByTestId('orchestra-section-brass'), { target: { value: '0.2' } });
    await drain();
    expect(conductor().orchestra.sections.brass).toBeCloseTo(0.2, 10);
    expect(useControls.getState().conductor.orchestra.sections.brass).toBeCloseTo(0.2, 10);
    // The other sections are untouched.
    expect(conductor().orchestra.sections.strings).toBe(useControls.getState().conductor.orchestra.sections.strings);

    // Off hides the levels again.
    fireEvent.click(screen.getByLabelText('Play with the orchestra'));
    await drain();
    expect(conductor().orchestra.enabled).toBe(false);
    expect(screen.queryByTestId('orchestra-volume')).toBeNull();
  });
});
