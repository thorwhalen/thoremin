// @vitest-environment jsdom
/**
 * The air instruments reach returning players (#249): a SEED_VERSION bump adds them by
 * name to a browser seeded at version 3, without touching the player's own edits.
 */
import { describe, it, expect } from 'vitest';
import { ensureSeeded, instruments } from '@/app/dials/instruments';
import { AIR } from './helpers/extensions';

describe.runIf(AIR)('upgrading a browser seeded before the air instruments', () => {
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
    expect(await instruments.has('Air Bass')).toBe(true);
    expect(await instruments.load('Pentatonic')).toEqual({ 'master.volume': 0.9 });
    expect(Number(localStorage.getItem('thoremin.instruments.seedVersion'))).toBeGreaterThan(3);
  });

  it('a browser at version 4 (after the Air Drum shipped) gains the Air Bass and the Air Guitar', async () => {
    localStorage.clear();
    await ensureSeeded();
    await instruments.remove('Air Bass');
    await instruments.remove('Air Guitar');
    await instruments.remove('Air Flute');
    localStorage.setItem('thoremin.instruments.seedVersion', '4');

    await ensureSeeded();

    const airBass = await instruments.load('Air Bass');
    expect((airBass?.airBass as { enabled?: boolean } | undefined)?.enabled).toBe(true);
    const airGuitar = await instruments.load('Air Guitar');
    expect((airGuitar?.airGuitar as { enabled?: boolean } | undefined)?.enabled).toBe(true);
    const airFlute = await instruments.load('Air Flute');
    expect((airFlute?.airFlute as { enabled?: boolean } | undefined)?.enabled).toBe(true);
  });
});
