// @vitest-environment jsdom
/**
 * The listening games left the camera build (docs/design/apps.md). A returning player's library
 * loses the three game seeds (they would load as a black, silent instrument), but keeps an
 * instrument of their own that only shares a name; and an instrument that carries the dial of an
 * extension this build does not list neither reads as edited nor loses that dial when saved over.
 */
import { describe, it, expect } from 'vitest';
import { commitToInstrument, ensureSeeded, instruments, selectInstrument } from '@/app/dials/instruments';
import { dialsStore } from '@/app/dials/settingsStore';
import { GAMES } from './helpers/extensions';

const GAMES_LAYER = { 'master.volume': 0.4, games: { enabled: true, game: 'sing', lesson: 'sing-five' } };

describe.runIf(!GAMES)('a library from before the listening games left the camera build', () => {
  it('drops the game seeds on the bump, and keeps a same-named instrument that plays no game', async () => {
    localStorage.clear();
    await ensureSeeded();
    await instruments.save('Sing Along', GAMES_LAYER);
    await instruments.save('Match the Note', { 'master.volume': 0.7 });
    localStorage.setItem('thoremin.instruments.seedVersion', '21');

    await ensureSeeded();

    expect(await instruments.has('Sing Along')).toBe(false);
    expect(await instruments.load('Match the Note')).toEqual({ 'master.volume': 0.7 });
    expect(await instruments.has('Pentatonic')).toBe(true);
  });

  it('an instrument with a dial this build does not list loads clean, and saving over it keeps that dial', async () => {
    localStorage.clear();
    await ensureSeeded();
    await instruments.save('Mine', GAMES_LAYER);

    const layer = await selectInstrument('Mine');
    expect(layer).not.toHaveProperty('games');
    expect(dialsStore.getState().layer).not.toHaveProperty('games');

    await commitToInstrument('Mine');
    expect((await instruments.load('Mine'))?.games).toEqual(GAMES_LAYER.games);
  });
});
