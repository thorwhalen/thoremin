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

beforeEach(() => {
  useControls.getState().setSteerPlaying(false);
  dialsStore.set('steer.enabled', false);
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
