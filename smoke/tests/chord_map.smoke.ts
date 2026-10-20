/**
 * The chord map in a real browser against the built bundle: a cold load, then the Chord Map
 * instrument chosen from the Instruments view the way a player does (one click on its row).
 * The node must join the live graph and emit its grid of chords, the overlay must be asked to
 * draw that grid (the composed element set names `harmonic-layers/chordMap`, the harmony slice's own element), its settings readout must appear
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
  expect(elements).toContain('harmonic-layers/chordMap');
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
  // The centre and a wedge per move. The synthetic hand may already have pushed the wheel to
  // another chord (a move is what it is for), so the check holds for any centre: the key's moves
  // from any of its chords reach the other six, so the wheel always shows all seven.
  await expect
    .poll(() => page.evaluate(() => ((window.thoremin!.getOutput('chordWheel', 'grid') as Grid)?.cells ?? []).map((c) => c.label).sort()), { timeout: 20_000 })
    .toEqual(['Am', 'B°', 'C', 'Dm', 'Em', 'F', 'G']);
  const elements = await page.evaluate(() => window.thoremin!.getOutput('ui', 'graphElements') as string[] | undefined);
  expect(elements).toContain('harmonic-layers/chordWheel');
  await expect(page.getByTestId('chord-wheel-live')).toBeVisible();

  await choose(page, 'Tonnetz Wheel');
  // The first wedge is P, the parallel of whatever chord is in the centre (C to Cm, Em to E).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const cells = (window.thoremin!.getOutput('chordWheel', 'grid') as Grid)?.cells ?? [];
          if (cells.length < 2) return false;
          const [centre, p] = [cells[0].label, cells[1].label];
          return p === (centre.endsWith('m') ? centre.slice(0, -1) : `${centre}m`);
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
