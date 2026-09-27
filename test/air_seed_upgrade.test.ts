// @vitest-environment jsdom
/**
 * The Air Drum reaches returning players (#249): SEED_VERSION 4 adds it by name to a
 * browser seeded at version 3, without touching the player's own edits.
 */
import { describe, it, expect } from 'vitest';
import { ensureSeeded, instruments } from '@/app/dials/instruments';

describe('upgrading a browser seeded before the air instruments', () => {
  it('adds the Air Drum and keeps an edited shipped instrument as the player left it', async () => {
    localStorage.clear();
    await ensureSeeded();
    // What a version-3 browser looks like: no Air Drum, an edited Pentatonic.
    await instruments.remove('Air Drum');
    await instruments.save('Pentatonic', { 'master.volume': 0.9 });
    localStorage.setItem('thoremin.instruments.seedVersion', '3');

    await ensureSeeded();

    const airDrum = await instruments.load('Air Drum');
    expect((airDrum?.airDrum as { enabled?: boolean } | undefined)?.enabled).toBe(true);
    expect(await instruments.load('Pentatonic')).toEqual({ 'master.volume': 0.9 });
    expect(localStorage.getItem('thoremin.instruments.seedVersion')).toBe('4');
  });
});
