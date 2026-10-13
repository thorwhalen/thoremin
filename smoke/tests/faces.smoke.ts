/**
 * The face categorizer session in a real browser (#330 P2): a LAZY, tool-only extension.
 *
 * - A cold load fetches none of its code (recognised by content: the mode wording only the
 *   deferred half carries), and the launcher still lists the tool (its eager stub).
 * - Opening "Your faces" from the Tools launcher fetches it and shows the session.
 * - A whole session on the synthetic face (`?faces.source=synthetic`: scripted vectors and a
 *   canvas video, so no camera and no face model): record, stop, the grid carved at the
 *   suggested k with pictures grabbed from the kept video, neutral switched in and out, a name
 *   edited, saved, and listed.
 *
 * The bundle half of the lazy claim is `npm run check:lazy`.
 */
import { test, expect, type Page } from '@playwright/test';

const URL_PARAMS = '?slot.source=synthetic-hands&faces.source=synthetic';
/** In the deferred panel only (`packages/ext-faces/src/panels/FaceSessionPanel.tsx`). */
const DEFERRED_MARKER = 'Every face is a category';

function watchScripts(page: Page): { scripts: { url: string; body: string }[]; settled: () => Promise<unknown> } {
  const scripts: { url: string; body: string }[] = [];
  const reading: Promise<unknown>[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (!/\.m?js(\?|$)/.test(url)) return;
    const entry = { url, body: '' };
    scripts.push(entry);
    reading.push(res.text().then((body) => (entry.body = body), () => undefined));
  });
  return { scripts, settled: () => Promise.all(reading) };
}

test('the face session loads only when opened, and records, carves, names and saves', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const { scripts, settled } = watchScripts(page);

  await page.goto(URL_PARAMS);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  await settled();
  const cold = scripts.filter((s) => s.body.includes(DEFERRED_MARKER)).map((s) => s.url);
  expect(cold, `the cold load fetched the faces extension's code: ${cold.join(', ')}`).toEqual([]);

  // Tools (1), "Your faces" (2).
  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="faces"]').click();
  const panel = page.locator('[data-tool="faces"]');
  await expect(panel).toBeVisible();
  const record = panel.getByRole('button', { name: 'Record my faces' });
  await expect(record).toBeVisible({ timeout: 30_000 });
  await settled();
  expect(scripts.some((s) => s.body.includes(DEFERRED_MARKER)), 'opening the tool did not fetch the faces code').toBe(true);

  // Record my faces (3): the rest, then the faces.
  await record.click();
  await expect(panel.locator('[data-faces-recording="rest"]')).toBeVisible();
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible({ timeout: 15_000 });
  // The synthetic face holds smile, rest, surprise, rest, frown, rest (1.55 s each) after its
  // rest; a full cycle and a half, so a slow machine still sees every face held.
  await page.waitForTimeout(14_000);
  await panel.getByRole('button', { name: 'Stop and carve' }).click();

  // The grid: neutral is "none of these" by default, the expressions carved, with pictures.
  const summary = panel.locator('[data-faces-summary]');
  await expect(summary).toContainText('Neutral means "none of these"', { timeout: 15_000 });
  const cats = panel.locator('[data-face-category]');
  await expect.poll(() => cats.count()).toBeGreaterThanOrEqual(2);
  const k = await cats.count();
  await expect(panel.locator('[data-face-neutral]')).toBeVisible();
  await expect.poll(() => panel.locator('img[data-face-still]').count(), { timeout: 20_000 }).toBeGreaterThan(k);

  // Neutral in: one more category, one of them "neutral"; and back.
  await panel.getByRole('radio', { name: /Every face is a category/ }).check();
  await expect(summary).toContainText('Every face is a category');
  await expect(cats).toHaveCount(k + 1);
  await expect(panel.locator('[data-face-category] input[value="neutral"]')).toHaveCount(1);
  await panel.getByRole('radio', { name: /Neutral means/ }).check();
  await expect(cats).toHaveCount(k);

  // Re-divide without recording again: one fewer.
  await panel.getByLabel('Number of categories').fill(String(k - 1));
  await expect(cats).toHaveCount(k - 1);

  // One click to name a category.
  const name = panel.locator('[data-face-category] input').first();
  await name.fill('my grin');
  await name.press('Enter');
  await expect(panel.locator('[data-face-category] input[value="my grin"]')).toHaveCount(1);

  // Save, and it is listed.
  await panel.getByLabel('Categorizer name').fill('Smoke faces');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('[data-faces-saved]')).toContainText('Smoke faces');

  expect(errors).toEqual([]);
});
