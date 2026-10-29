/**
 * The listening games in a real browser against the built bundle (#866), with no camera and no
 * microphone: the hands are the synthetic sweep and the sound is the audio seam's synthetic taps
 * (`?audio.source=synthetic`, known struck sounds at a steady rate). Each seed is loaded from the
 * Instruments list and starts itself (`?games.autostart=1`, the guide pictures' hook): the audio
 * seam goes live, the game runs from its count-in, the stage is drawn by the game (the video is
 * hidden) and, for the timed games, reaches its results; no page error on the way.
 */
import { test, expect } from '@playwright/test';
import { boot, collectErrors, play } from '../helpers/boot';

const URL = '?slot.source=synthetic-hands&audio.source=synthetic&games.autostart=1';

type Status = { phase?: string; results?: { summary?: string } | null; mode?: string };
const status = (page: import('@playwright/test').Page) => page.evaluate(() => window.thoremin!.getOutput('listeningGame', 'status') as Status | undefined);

for (const [seed, mode, finishes] of [
  ['Play Along Lessons', 'play-along', true],
  ['Sing Along', 'sing', true],
  ['Match the Note', 'match', false],
] as const) {
  test(`${seed}: the audio seam goes live, the game runs${finishes ? ' to its results' : ''}`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await boot(page, URL);
    await play(page, seed);
    await expect.poll(async () => (await status(page))?.mode, { timeout: 10_000 }).toBe(mode);
    await expect.poll(() => page.evaluate(() => window.thoremin!.getOutput('gamesAudio', 'status')), { timeout: 15_000 }).toBe('live');
    await expect.poll(async () => (await status(page))?.phase, { timeout: 15_000 }).toMatch(/count-in|playing/);
    // The game, not the camera, owns the picture: its view reaches the stage.
    const view = await page.evaluate(() => window.thoremin!.getOutput('listeningGame', 'view') as { title?: string } | null);
    expect(view?.title).toBeTruthy();
    if (finishes) {
      await expect.poll(async () => (await status(page))?.phase, { timeout: 60_000 }).toBe('results');
      expect((await status(page))?.results?.summary).toBeTruthy();
    }
    expect(errors).toEqual([]);
  });
}
