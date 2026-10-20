// @vitest-environment jsdom
/**
 * "Rate this move" in the Chord map section (#715), rendered: a move is named, Save waits until the
 * move was played, a saved rating counts toward the mode's 42 moves and publishes the player's
 * table, and the next move is another one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const published = vi.hoisted(() => ({ tables: [] as unknown[] }));
vi.mock('@thoremin/ext-harmony/app/controls', () => ({
  harmonyControls: { setTransient: (_k: string, t: unknown) => published.tables.push(t), store: () => ({}) },
}));
vi.mock('@thoremin/ext-harmony/app/movePlayer', async (orig) => ({ ...(await orig<object>()), playMove: vi.fn() }));
import { RateThisMove } from '@thoremin/ext-harmony/panels/rateMove';
import { playMove } from '@thoremin/ext-harmony/app/movePlayer';
import { HARMONY } from '../helpers/extensions';

describe.runIf(HARMONY)('Rate this move', () => {
  beforeEach(() => {
    localStorage.clear();
    published.tables.length = 0;
  });
  afterEach(cleanup);

  it('plays a move, saves a rating after it was heard, counts it and moves on', async () => {
    render(<RateThisMove />);
    fireEvent.click(screen.getByText('Rate this move'));
    await waitFor(() => expect(published.tables.length).toBeGreaterThan(0));
    const first = screen.getByTestId('rate-move-name').textContent;
    expect(first).toMatch(/→ .* \(major keys\)$/);
    const save = screen.getByRole('button', { name: 'Save rating' });
    expect(save).toHaveProperty('disabled', true);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(playMove).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Dark to bright'), { target: { value: '0.8' } });
    fireEvent.change(screen.getByLabelText('Settled to tense'), { target: { value: '-0.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rating' }));

    await waitFor(() => expect(screen.getByTestId('rate-move-progress').textContent).toMatch(/^1 of 42 moves rated in major keys/));
    expect(screen.getByTestId('rate-move-name').textContent).not.toBe(first);
    const last = published.tables.at(-1) as Record<string, { valence: number; tension: number; n: number }>;
    expect(Object.values(last)).toEqual([{ valence: 0.8, tension: -0.5, n: 1 }]);
    expect(localStorage.getItem('thoremin-move-ratings')).toContain('"mode":"major"');
  });
});
