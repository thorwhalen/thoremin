/**
 * The Song tool's Media search in a real browser against the built bundle (the sources' acceptance):
 * search "bach", choose Bach's Toccata and Fugue BWV 565 (Internet Archive, public domain), and the
 * track plays and follows the dancer exactly like a local file. The network is recorded responses
 * (`test/fixtures/sources/`, provenance in its `meta.json`): the search, the item's metadata and a
 * 30 s excerpt of the fugue, served for its download address with the CORS header the archive
 * sends. The same bytes chosen as a local file first give the same beat grid; then the searched
 * track, with Follow the dancer on and the synthetic dancer stepping, locks: the pace controller's
 * own output follows at an integer relation, and the song plays at the controller's rate.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'sources');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const EXCERPT = fixture('toccata_bwv565_excerpt.mp3');
const DOWNLOAD = '/download/Toccata/Toccata_et_Fugue_BWV565.mp3';
const SYNTHETIC = '?slot.source=synthetic-hands&slot.body=synthetic-body';
const CORS = { 'access-control-allow-origin': '*' };

/** The site under test's own origin (the local preview or the live site): never blocked. */
const ownOrigin = (): string => new URL(String(test.info().project.use.baseURL)).origin;

async function recordedNetwork(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/^https:\/\/archive\.org\//, (route) => {
    const url = new URL(route.request().url());
    asked.push(url.pathname);
    if (url.pathname === '/advancedsearch.php') return route.fulfill({ headers: CORS, contentType: 'application/json', body: fixture('ia_search_bach.json') });
    if (url.pathname === '/metadata/Toccata') return route.fulfill({ headers: CORS, contentType: 'application/json', body: fixture('ia_metadata_toccata.json') });
    if (url.pathname === DOWNLOAD) return route.fulfill({ headers: CORS, contentType: 'audio/mpeg', body: EXCERPT });
    // Artwork and anything else: nothing.
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
  await page.route(/^https:\/\/api\.audius\.co\//, (route) => route.fulfill({ headers: CORS, contentType: 'application/json', body: fixture('audius_search_bach.json') }));
  // Nothing else may reach the internet from this test, but the site itself may load.
  const own = ownOrigin();
  await page.route((url) => url.origin !== own && url.protocol === 'https:' && url.hostname !== 'archive.org' && url.hostname !== 'api.audius.co', (route) => route.abort());
  return asked;
}

test('search "bach": an Internet Archive track loads like a local file and follows the dancer', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const asked = await recordedNetwork(page);
  await page.goto(SYNTHETIC);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });

  // Tools, then Song.
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByRole('dialog').getByText('Song', { exact: true }).click();

  // The same bytes as a local file: the reference grid.
  await page.getByTestId('song-file').setInputFiles({ name: 'toccata.mp3', mimeType: 'audio/mpeg', buffer: EXCERPT });
  await expect(page.getByTestId('song-grid')).toHaveText(/bpm/, { timeout: 30_000 });
  const fileGrid = await page.getByTestId('song-grid').textContent();

  // Search, then the track.
  await page.getByLabel('Search music or paste a link').fill('bach');
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByTestId('media-results').getByRole('button', { name: /^Toccata Johann Sebastian Bach/ }).click();
  await expect(page.getByTitle('Toccata', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('song-source')).toHaveText('Internet Archive · Johann Sebastian Bach · licence: Public Domain Mark 1.0 · page');
  expect(await page.getByTestId('song-grid').textContent()).toBe(fileGrid);
  expect(asked).toContain(DOWNLOAD);

  // Follow the dancer (the synthetic one steps every 1.2 s), then Play.
  await page.getByLabel('Follow the dancer').check();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByTestId('song-pace')).toHaveText(/Following: /, { timeout: 90_000 });
  const pace = () => page.evaluate(() => window.thoremin!.getOutput('pace', 'pace') as { mode?: string; rate?: number; ratio?: number } | undefined);
  await expect.poll(async () => (await pace())?.mode, { timeout: 30_000 }).toBe('following');
  // Following at an integer relation, and the song plays at the controller's rate.
  const now = await page.evaluate(() => ({
    state: window.thoremin!.getOutput('pace', 'pace') as { ratio: number },
    controller: window.thoremin!.getOutput('pace', 'rate') as number,
    played: window.thoremin!.getOutput('songPlayer', 'rate') as number,
  }));
  console.log(`[media smoke] following: ratio ${now.state.ratio}, controller rate ${now.controller}, song rate ${now.played}`);
  expect(Number.isInteger(now.state.ratio) || Number.isInteger(1 / now.state.ratio)).toBe(true);
  expect(now.played).toBeCloseTo(now.controller, 6);
  expect(errors).toEqual([]);
});
