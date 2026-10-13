// @vitest-environment jsdom
/**
 * Hand panel reachability for the handedness dwell (#148) — the UI half of the guard.
 * `test/handedness_dwell.test.ts` proves the dial reaches the node; this proves a player
 * can FIND it: the settings panel's Hand section carries a "Handedness dwell" select, off
 * (0 frames) by default, and choosing a value dispatches the dial (through the command
 * registry, into the dials store and the hot store the graph reads). Three clicks from a
 * cold load: Settings, the Hand section, the select.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import DialsControlsPanel from '@/app/dials/DialsControlsPanel';
import { HandControls } from '@/app/dials/panels/hand';
import { dialsStore } from '@/app/dials/settingsStore';
import { useControls } from '@/app/store';

const dwell = () => dialsStore.getState().effective['hands.handednessDwell'] as number;
const drain = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => cleanup());

describe('the settings panel mounts the Hand section with the handedness dwell', () => {
  it('renders the select inside the Hand section', () => {
    render(<DialsControlsPanel />);
    const section = document.querySelector('[data-section="Hand"]');
    expect(section).toBeTruthy();
    expect(section!.querySelector('select[aria-label="Handedness dwell"]')).toBeTruthy();
  });
});

describe('HandControls: the handedness dwell select', () => {
  it('is off (0 frames) by default and offers a few frame counts', () => {
    render(<HandControls />);
    const select = screen.getByLabelText('Handedness dwell') as HTMLSelectElement;
    expect(select.value).toBe('0');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('3');
    expect(select.options[0].textContent).toMatch(/^Off/);
    // The labels state the cost honestly: a dwell of N delays a real swap by N frames.
    expect(Array.from(select.options).find((o) => o.value === '3')?.textContent).toMatch(/100 ms/);
    expect(Array.from(select.options).find((o) => o.value === '2')?.textContent).toMatch(/67 ms/);
  });

  it('dispatches the dial: the dials store and the hot store both read the new value', async () => {
    render(<HandControls />);
    const select = screen.getByLabelText('Handedness dwell') as HTMLSelectElement;
    expect(dwell()).toBe(0);
    fireEvent.change(select, { target: { value: '3' } });
    await drain();
    expect(dwell()).toBe(3);
    expect(useControls.getState().hands.handednessDwell).toBe(3);
    // Restore for the other tests.
    fireEvent.change(select, { target: { value: '0' } });
    await drain();
    expect(dwell()).toBe(0);
    expect(useControls.getState().hands.handednessDwell).toBe(0);
  });
});
