// @vitest-environment jsdom
/**
 * The gear edits; it does not revert (#359). Choosing an instrument loads its saved layer (a
 * revert of any unsaved edit, by design: "re-selecting reverts"), so the gear of the instrument
 * already chosen must not choose it again, or an edit made in the editor, or kept across a
 * reload, is lost the moment the player opens the editor to look at it.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { dialsStore } from '@/app/dials/settingsStore';
import { dispatchDialSet } from '@/app/dispatchDial';

const volume = () => dialsStore.getState().effective['master.volume'] as number;

beforeAll(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

describe('the instrument gear', () => {
  it("of the chosen instrument keeps its unsaved edits", async () => {
    render(<InstrumentsPanel />);
    fireEvent.click(await screen.findByText('Pentatonic'));
    await waitFor(() => expect(localStorage.getItem('thoremin.instruments.selected')).toBe('Pentatonic'));
    const saved = volume();
    const edited = saved === 0.37 ? 0.41 : 0.37;
    await dispatchDialSet('master.volume', edited);
    expect(volume()).toBe(edited);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Pentatonic' }));
    // Give a stray load the time it would take to land.
    await new Promise((r) => setTimeout(r, 50));
    expect(volume()).toBe(edited);
    expect(localStorage.getItem('thoremin.instruments.selected')).toBe('Pentatonic');
  });

  it('of another instrument chooses it', async () => {
    render(<InstrumentsPanel />);
    const gears = await screen.findAllByRole('button', { name: /^Edit / });
    const other = gears.find((b) => b.getAttribute('aria-label') !== 'Edit Pentatonic')!;
    const name = other.getAttribute('aria-label')!.slice('Edit '.length);
    fireEvent.click(other);
    await waitFor(() => expect(localStorage.getItem('thoremin.instruments.selected')).toBe(name));
  });
});
