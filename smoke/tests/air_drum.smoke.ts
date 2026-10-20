/**
 * The air drum in a real browser against the built bundle, with no camera: the synthetic hand in
 * its strike mode (`?synthetic.strike=1`) hits downward once every 0.9 s. The Air Drum instrument is
 * chosen from the Instruments view the way a player does; the node must join the live graph, learn
 * the strike plane from the first strokes, and then decide hits that reach the drum voice.
 */
import { test, expect, type Page } from '@playwright/test';
import { skipWhenStarved } from '../helpers/load';

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
  test.setTimeout(180_000);
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
  // A loaded runner drops frames and with them strokes (#803): the hits get a minute, and if they
  // still do not come while the page could not keep the frame rate a stroke needs, the runner is
  // what failed, and the test says so as a skip.
  const struck = await expect
    .poll(async () => (await status())?.hits ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(2)
    .then(() => true, () => false);
  if (!struck) await skipWhenStarved(page, 'Air drum hits');
  expect((await status())?.hits ?? 0, 'hits decided from the synthetic strokes').toBeGreaterThan(2);
  // A hit is PREDICTED only when the pipeline is fast enough to get ahead of the stroke (a ghost
  // note on the first, and any hit while the machine is too busy to keep the frame rate up, is
  // reported late): so a prediction must come, but not necessarily by the third hit. Waiting for
  // the first one is the assertion, with room for a loaded runner (this was flaky when it read
  // the count the instant the third hit landed, #629).
  await expect.poll(async () => (await status())?.predicted ?? 0, { timeout: 45_000 }).toBeGreaterThan(0);
  const s = (await status())!;
  expect(s.predicted).toBeLessThanOrEqual(s.hits);
  expect(s.ready.right || s.ready.left).toBe(true);
  await expect
    .poll(() => page.evaluate(() => (window.thoremin!.getOutput('airDrum', 'hits') as { sound?: string; velocity?: number }[] | undefined)?.length ?? 0), { timeout: 15_000, intervals: [16] })
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.thoremin!.audio().state)).toBe('running');
  const elements = await page.evaluate(() => window.thoremin!.getOutput('ui', 'graphElements') as string[] | undefined);
  expect(elements).toContain('air/drumPads'); // the air extension's element since #600 S10
  expect(errors).toEqual([]);
});
