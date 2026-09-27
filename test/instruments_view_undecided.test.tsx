// @vitest-environment jsdom
/**
 * An instrument the library cannot derive (its saved settings no longer parse: a sound
 * since renamed, say) is still listed, since the list is the one place a player can pick,
 * edit or re-save it. The collection refactor (#285) first dropped it silently; the
 * adversarial review caught that.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import InstrumentsPanel from '@/app/dials/InstrumentsPanel';
import { instruments, ensureSeeded } from '@/app/dials/instruments';

beforeAll(async () => {
  localStorage.clear();
  await ensureSeeded();
  // A saved instrument holding a value that has since been retired.
  await instruments.save('Old Favourite', { 'right.sound': 'a-sound-that-was-renamed' } as never);
});
afterEach(() => cleanup());

describe('an instrument whose settings no longer parse', () => {
  it('is listed (under the default class), not dropped', async () => {
    render(<InstrumentsPanel />);
    await waitFor(() => {
      const field = screen.getByRole('group', { name: 'Field instruments' });
      expect(within(field).getByText('Pentatonic')).toBeTruthy();
      expect(within(field).getByText('Old Favourite')).toBeTruthy();
    });
    expect(screen.getByLabelText('Edit Old Favourite')).toBeTruthy();
  });
});
