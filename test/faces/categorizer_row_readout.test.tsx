// @vitest-environment jsdom
/**
 * The chosen instrument's row shows the faces extension's readouts while they say something
 * (#367): which categorizer the face chords read, while one of the player's plays them, and
 * which pose categorizer the instrument reads. Before, the host keyed row readouts on the air
 * instrument ids, so a categorizer's line was never under the row. The editor's sections keep
 * their own line (a separate view).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { dialsStore } from '@/app/dials/settingsStore';
import { FACES } from '../helpers/extensions';

beforeAll(() => {
  localStorage.clear();
});
afterEach(() => cleanup());

const field = () => waitFor(() => screen.getByRole('group', { name: 'Field instruments' }));
/** Choose Pentatonic and wait until it is the chosen row (its load lands before the test's
 *  own dial writes, which it would otherwise overwrite). */
async function choosePentatonic(theremin: HTMLElement) {
  fireEvent.click(within(theremin).getByText('Pentatonic'));
  await waitFor(() => expect(within(theremin).getByText('Pentatonic').closest('li')?.className).toMatch(/bg-white\/10/));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe.runIf(FACES)('the faces extension readouts under the chosen row (#367)', () => {
  it('a personal face categorizer playing the face chords shows its line; the general model none', async () => {
    render(<InstrumentsPanel />);
    const theremin = await field();
    await choosePentatonic(theremin);
    expect(document.querySelector('[data-faces-readout]')).toBeNull();
    act(() => {
      dialsStore.set('face.mapping', 'chord');
      dialsStore.set('faceCategorizer', { id: 'not-on-this-device', degrees: {} });
    });
    const line = await waitFor(() => {
      const el = within(theremin).getByText((_, n) => n?.hasAttribute('data-faces-readout') ?? false);
      return el;
    });
    expect(line.textContent).toMatch(/Not on this device|Loading/);
    // The face chords off: no line, though the categorizer is still named.
    act(() => dialsStore.set('face.mapping', 'none'));
    await waitFor(() => expect(document.querySelector('[data-faces-readout]')).toBeNull());
  });

  it('a pose categorizer the instrument reads shows its line, and its own (not the face one)', async () => {
    render(<InstrumentsPanel />);
    const theremin = await field();
    await choosePentatonic(theremin);
    act(() => dialsStore.set('poseCategorizer', { id: 'pose-not-here', transport: false }));
    await waitFor(() => expect(within(theremin).getByText((_, n) => n?.hasAttribute('data-poses-readout') ?? false)).toBeTruthy());
    expect(document.querySelector('[data-faces-readout]')).toBeNull();
    act(() => dialsStore.set('poseCategorizer', { id: '', transport: false }));
    await waitFor(() => expect(document.querySelector('[data-poses-readout]')).toBeNull());
  });
});
