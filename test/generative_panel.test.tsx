// @vitest-environment jsdom
/**
 * Generative panel reachability (#141 / #188) — the UI half of the guard. The DAG-edge
 * test (app_graph.test.ts) proves the layer CAN be switched on; this proves a player
 * can FIND the switch: the settings panel mounts a Generative section, the section
 * renders the enable toggle, a transport button that is live only once enabled, and
 * an honest readout — a missing key says where the key goes instead of a dead button.
 * Deleting the section would otherwise keep every other test green (#119 / #120).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { GenerativeControls } from '@/app/dials/panels/generative';
import { useGenerativeStatus } from '@/app/generativeStatus';
import { useControls } from '@/app/store';
import { dialsStore } from '@/app/dials/settingsStore';
import { SteeringEditor } from '@/app/dials/panels/steering';
import { currentSteerConfig } from '@/app/commands/steer';
import { defaultSteerConfig } from '@/settings/schema';

beforeEach(() => {
  useControls.getState().setSteerPlaying(false);
  dialsStore.set('steer.enabled', false);
  dialsStore.set('steerConfig', defaultSteerConfig());
});
afterEach(() => {
  cleanup();
  useGenerativeStatus.getState().reset();
});

describe('the settings panel mounts the Generative section (#188 reachability)', () => {
  it('renders a Generative section', () => {
    render(<DialsControlsPanel />);
    expect(screen.getByText('Generative')).toBeTruthy();
  });
});

describe('GenerativeControls', () => {
  it('renders the enable toggle, a Play button disabled until enabled, and says the layer is off', () => {
    render(<GenerativeControls />);
    expect(screen.getByText('Generative layer')).toBeTruthy();
    const play = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(screen.getByText('Generative layer off')).toBeTruthy();
  });

  it('once enabled, the transport toggles the transient store flag (not a dial), Play ↔ Pause', () => {
    dialsStore.set('steer.enabled', true);
    render(<GenerativeControls />);
    const play = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
    expect(play.disabled).toBe(false);
    fireEvent.click(play);
    expect(useControls.getState().steerPlaying).toBe(true);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    // It is not in the dials layer: no `steer.playing` dial exists.
    expect(dialsStore.getState().effective).not.toHaveProperty('steer.playing');
  });

  it('a missing key renders the where-the-key-goes hint, not a dead button', () => {
    dialsStore.set('steer.enabled', true);
    useGenerativeStatus.getState().report({ phase: 'unavailable', reason: 'no-key', message: 'Add a Gemini API key to enable the generative layer.' });
    render(<GenerativeControls />);
    expect(screen.getByText('Add a Gemini API key to enable the generative layer.')).toBeTruthy();
    expect(screen.getByText(/bot icon, provider Google/)).toBeTruthy();
  });

  it('renders the live phase when enabled', () => {
    dialsStore.set('steer.enabled', true);
    useGenerativeStatus.getState().report({ phase: 'active', message: 'Playing' });
    render(<GenerativeControls />);
    expect(screen.getByText('Playing')).toBeTruthy();
  });
});

describe('SteeringEditor (#188 PR 5) — the strain editor on the command write path', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('is mounted inside the Generative section', () => {
    render(<GenerativeControls />);
    expect(screen.getByText(/Steering — what your gestures mean/)).toBeTruthy();
  });

  it('lists the starter strains and dials, and adding a strain dispatches steer.strain.add', async () => {
    render(<SteeringEditor />);
    expect(screen.getByDisplayValue('warm ambient pads')).toBeTruthy();
    expect(screen.getByDisplayValue('bright plucked arpeggios')).toBeTruthy();
    expect(screen.getByText('brightness')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New strain text'), { target: { value: 'rain on glass' } });
    fireEvent.click(screen.getByText('Add strain'));
    await flush();
    expect(currentSteerConfig().strains.map((s) => s.text)).toContain('rain on glass');
    expect(screen.getByDisplayValue('rain on glass')).toBeTruthy();
  });

  it('removing, rebinding and renaming go through the commands (the panel never writes the dial)', async () => {
    render(<SteeringEditor />);
    fireEvent.click(screen.getByLabelText('Remove strain bright plucked arpeggios'));
    await flush();
    expect(currentSteerConfig().strains.map((s) => s.text)).toEqual(['warm ambient pads']);
    const featureSelects = screen.getAllByLabelText('Feature');
    fireEvent.change(featureSelects[0], { target: { value: 'pinch' } });
    await flush();
    expect(currentSteerConfig().strains[0].feature).toBe('pinch');
    const text = screen.getByLabelText('Strain text warm ambient pads');
    fireEvent.change(text, { target: { value: 'cold pads' } });
    fireEvent.blur(text);
    await flush();
    expect(currentSteerConfig().strains[0].text).toBe('cold pads');
  });

  it('driving a new engine dial adds it with its natural range; removing it drops it', async () => {
    render(<SteeringEditor />);
    fireEvent.change(screen.getByLabelText('Add engine dial'), { target: { value: 'bpm' } });
    await flush();
    expect(currentSteerConfig().dials.find((d) => d.name === 'bpm')).toMatchObject({ outMin: 60, outMax: 200 });
    fireEvent.click(screen.getByLabelText('Remove dial bpm'));
    await flush();
    expect(currentSteerConfig().dials.some((d) => d.name === 'bpm')).toBe(false);
  });
});

describe('SteeringEditor — fields commit on blur and revert on refusal (#188 PR 5 review)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('a weight typed halfway is not written; blur commits once; an emptied field reverts', async () => {
    render(<SteeringEditor />);
    const w = screen.getByLabelText('Weight max warm ambient pads') as HTMLInputElement;
    fireEvent.change(w, { target: { value: '1.' } });
    await flush();
    expect(currentSteerConfig().strains[0].weightMax).toBe(2); // not per keystroke
    fireEvent.change(w, { target: { value: '1.5' } });
    fireEvent.blur(w);
    await flush();
    expect(currentSteerConfig().strains[0].weightMax).toBe(1.5);
    fireEvent.change(w, { target: { value: '' } });
    fireEvent.blur(w);
    await flush();
    expect(currentSteerConfig().strains[0].weightMax).toBe(1.5);
    expect(w.value).toBe('1.5');
  });

  it('a refused rename (a duplicate) reverts the field to the stored text', async () => {
    render(<SteeringEditor />);
    const t = screen.getByLabelText('Strain text warm ambient pads') as HTMLInputElement;
    fireEvent.change(t, { target: { value: 'bright plucked arpeggios' } });
    fireEvent.blur(t);
    await flush();
    await flush();
    expect(currentSteerConfig().strains[0].text).toBe('warm ambient pads');
    expect(t.value).toBe('warm ambient pads');
  });

  it('the last strain cannot be removed from the panel (the command refuses, the row stays)', async () => {
    render(<SteeringEditor />);
    fireEvent.click(screen.getByLabelText('Remove strain bright plucked arpeggios'));
    await flush();
    fireEvent.click(screen.getByLabelText('Remove strain warm ambient pads'));
    await flush();
    expect(currentSteerConfig().strains).toHaveLength(1);
    expect(screen.getByDisplayValue('warm ambient pads')).toBeTruthy();
  });
});
