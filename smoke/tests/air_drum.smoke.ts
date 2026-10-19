/**
 * The air drum in a real browser against the built bundle, with no camera: the synthetic hand in
 * its strike mode (`?synthetic.strike=1`) hits downward once every 0.9 s. The Air Drum instrument is
 * chosen from the Instruments view the way a player does; the node must join the live graph, learn
 * the strike plane from the first strokes, and then decide hits that reach the drum voice.
 */
import { test, expect, type Page } from '@playwright/test';

const URL_PARAMS = '?slot.source=synthetic-hands&synthetic.strike=1';

async function booted(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 20_000 }).toBeGreaterThan(0);
}

async function choose(page: Page, name: string): Promise<void> {
  const row = page.locator(`li[data-instrument="${name}"]`).first();
  if (!(await row.isVisible())) await page.getByPlaceholder(/filter/i).first().fill(name);
  await row.getByRole('button', { name }).first().click();
}

type DrumStatus = { enabled: boolean; hits: number; predicted: number; ready: { right: boolean; left: boolean } };

test('the Air drum joins the graph and hits when the synthetic hand strikes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL_PARAMS);
  await booted(page);
  expect(await page.evaluate(() => window.thoremin!.getOutput('airDrum', 'status'))).toBeUndefined();

  await page.getByRole('button', { name: /tap to play/i }).click();
  await choose(page, 'Air Drum');
  const status = () => page.evaluate(() => window.thoremin!.getOutput('airDrum', 'status') as DrumStatus | undefined);
  await expect.poll(async () => (await status())?.enabled, { timeout: 20_000 }).toBe(true);
  // The strokes are decided into hits: the status counts them (most predicted ahead of the
  // frame that shows them), and a tick that decided one carries it, with a sound and a velocity,
  // out of the node's `hits` port toward the drum voice.
  await expect.poll(async () => (await status())?.hits ?? 0, { timeout: 30_000 }).toBeGreaterThan(2);
  const s = (await status())!;
  expect(s.predicted).toBeGreaterThan(0);
  expect(s.ready.right || s.ready.left).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window.thoremin!.getOutput('airDrum', 'hits') as { sound?: string; velocity?: number }[] | undefined)?.length ?? 0), { timeout: 15_000, intervals: [16] })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.thoremin!.audio().state)).toBe('running');
  const elements = await page.evaluate(() => window.thoremin!.getOutput('ui', 'graphElements') as string[] | undefined);
  expect(elements).toContain('drumPads');
  expect(errors).toEqual([]);
});
