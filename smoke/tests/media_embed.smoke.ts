/**
 * A YouTube link in the Song tool, in a real browser against the built bundle: the player module
 * is fetched only when the link opens, the player shows in its own window, Play reaches it, and the
 * song player publishes `songTime` from its position, exactly as for a file. YouTube's IFrame API
 * script is replaced by a stand-in served here (no network), whose player reports a position that
 * advances while it plays.
 */
import { test, expect } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands';

/** The stand-in for https://www.youtube.com/iframe_api: YT.Player with the calls the app makes. */
const STAND_IN = `
(function () {
  function Player(el, o) {
    var self = this, state = -1, base = 0, since = 0;
    var box = document.createElement('div');
    box.setAttribute('data-testid', 'yt-stand-in');
    box.textContent = 'YouTube player (stand-in) ' + o.videoId;
    box.style.cssText = 'width:100%;height:100%;color:#fff';
    el.appendChild(box);
    function now() { return performance.now() / 1000; }
    function set(s) { state = s; o.events.onStateChange && o.events.onStateChange({ data: s }); }
    self.playVideo = function () { if (state !== 1) { since = now(); set(1); } };
    self.pauseVideo = function () { if (state === 1) { base += now() - since; } set(2); };
    self.seekTo = function (s) { base = s; since = now(); };
    self.setPlaybackRate = function (r) { o.events.onPlaybackRateChange && o.events.onPlaybackRateChange({ data: r }); };
    self.getAvailablePlaybackRates = function () { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]; };
    self.setVolume = function () {};
    self.getCurrentTime = function () { return Math.floor((state === 1 ? base + now() - since : base) * 4) / 4; };
    self.getDuration = function () { return 240; };
    self.getPlayerState = function () { return state; };
    self.destroy = function () { box.remove(); };
    setTimeout(function () { o.events.onReady && o.events.onReady(); }, 0);
  }
  window.YT = { Player: Player, loaded: 1 };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
})();
`;

test('a YouTube link plays in its own window and the song player keeps time with it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const playerChunks: string[] = [];
  page.on('request', (r) => {
    if (/youtube_player-[^/]*\.js$/.test(r.url())) playerChunks.push(r.url());
  });
  await page.route('https://www.youtube.com/iframe_api', (route) => route.fulfill({ contentType: 'text/javascript', body: STAND_IN }));
  // Nothing else may reach the internet from this test, but the site under test itself may load
  // (the local preview or the live site).
  const own = new URL(String(test.info().project.use.baseURL)).origin;
  await page.route((url) => url.origin !== own && url.protocol === 'https:' && url.href !== 'https://www.youtube.com/iframe_api', (route) => route.abort());
  await page.goto(SYNTHETIC);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByRole('dialog').getByText('Song', { exact: true }).click();
  expect(playerChunks, 'no YouTube player code before a YouTube link opens').toEqual([]);

  await page.getByLabel('Search music or paste a link').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.getByTestId('media-search').getByRole('button', { name: 'Open', exact: true }).click();
  const win = page.getByTestId('embed-player');
  await expect(win).toBeVisible({ timeout: 30_000 });
  await expect(win.getByTestId('yt-stand-in')).toBeVisible();
  expect(playerChunks.length, 'the YouTube player module loads on open').toBeGreaterThan(0);
  await expect(page.getByTestId('song-grid')).toHaveText(/YouTube's own player/);

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  const read = () => page.evaluate(() => ({
    status: (window.thoremin!.getOutput('songPlayer', 'status') as { phase?: string } | undefined)?.phase,
    position: window.thoremin!.getOutput('songPlayer', 'position') as number,
    t: (window.thoremin!.getOutput('songPlayer', 'songTime') as { t?: number } | undefined)?.t,
  }));
  await expect.poll(async () => (await read()).status, { timeout: 20_000 }).toBe('active');
  const a = await read();
  await page.waitForTimeout(1500);
  const b = await read();
  expect(b.position - a.position).toBeGreaterThan(1);
  expect(b.t!).toBeGreaterThan(a.t!);

  // Its Close button ends it, window and song.
  await win.getByRole('button', { name: 'Close the YouTube player' }).click();
  await expect(win).toBeHidden();
  await expect(page.getByTestId('song-grid')).toBeHidden();
  expect(errors).toEqual([]);
});
