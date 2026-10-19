/**
 * The chord map in a real browser against the built bundle: a cold load, then the Chord Map
 * instrument chosen from the Instruments view the way a player does (one click on its row).
 * The node must join the live graph and emit its grid of chords, the overlay must be asked to
 * draw that grid (the composed element set names `cellGrid`), its settings readout must appear
 * under the row, and the page must keep running without an error. Then Chord Map Strum: the
 * same grid, now strummed.
 */
import { test, expect, type Page } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands';

async function booted(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 20_000 }).toBeGreaterThan(0);
}

/** Click an instrument's row in the Instruments view. */
async function choose(page: Page, name: string): Promise<void> {
  const row = page.locator(`li[data-instrument="${name}"]`).first();
  if (!(await row.isVisible())) {
    // Its class may be collapsed: a search lists every match.
    await page.getByPlaceholder(/filter/i).first().fill(name);
  }
  await row.getByRole('button', { name }).first().click();
}

type Grid = { cells: { shape: string; label: string; state: string }[] } | undefined;

test('the Chord Map instrument loads, emits its grid of chords and asks the overlay to draw it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(SYNTHETIC);
  await booted(page);
  // A cold load does not compose the chord map.
  expect(await page.evaluate(() => window.thoremin!.getOutput('chordMap', 'grid'))).toBeUndefined();

  await choose(page, 'Chord Map');
  await expect
    .poll(() => page.evaluate(() => ((window.thoremin!.getOutput('chordMap', 'grid') as Grid)?.cells ?? []).filter((c) => c.shape === 'hex').length), { timeout: 20_000 })
    .toBeGreaterThan(6);
  // (An array, not a Set: page.evaluate returns JSON.)
  const labels = await page.evaluate(() => ((window.thoremin!.getOutput('chordMap', 'grid') as Grid)?.cells ?? []).filter((c) => c.shape === 'hex').map((c) => c.label));
  expect([...new Set(labels)].sort()).toEqual(['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G']);
  const elements = await page.evaluate(() => window.thoremin!.getOutput('ui', 'graphElements') as string[] | undefined);
  expect(elements).toContain('cellGrid');
  await expect(page.getByTestId('chord-map-live')).toBeVisible();
  const status = await page.evaluate(() => window.thoremin!.getOutput('chordMap', 'status') as { enabled: boolean; play: string; key: string });
  expect(status).toMatchObject({ enabled: true, play: 'hold', key: 'C' });

  await choose(page, 'Chord Map Strum');
  await expect.poll(() => page.evaluate(() => (window.thoremin!.getOutput('chordMap', 'status') as { play?: string } | undefined)?.play), { timeout: 20_000 }).toBe('strum');
  // The strum's own scheduler is in the graph with it.
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});

test('the Chord Wheel instrument loads and draws its wheel through its own overlay element', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(SYNTHETIC);
  await booted(page);
  expect(await page.evaluate(() => window.thoremin!.getOutput('chordWheel', 'grid'))).toBeUndefined();

  await choose(page, 'Chord Wheel');
  // The centre (the tonic) and a wedge per move, with the moves' targets.
  await expect
    .poll(() => page.evaluate(() => ((window.thoremin!.getOutput('chordWheel', 'grid') as Grid)?.cells ?? []).map((c) => c.label)), { timeout: 20_000 })
    .toEqual(['C', 'F', 'Em', 'Dm', 'G', 'Am', 'B°']);
  const elements = await page.evaluate(() => window.thoremin!.getOutput('ui', 'graphElements') as string[] | undefined);
  expect(elements).toContain('air/chordWheel');
  await expect(page.getByTestId('chord-wheel-live')).toBeVisible();

  await choose(page, 'Tonnetz Wheel');
  await expect
    .poll(() => page.evaluate(() => ((window.thoremin!.getOutput('chordWheel', 'grid') as Grid)?.cells ?? []).slice(1, 4).map((c) => c.label)), { timeout: 20_000 })
    .toEqual(['Cm', 'Em', 'Am']);
  expect(errors).toEqual([]);
});
