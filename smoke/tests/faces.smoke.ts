/**
 * The face categorizer session in a real browser (#330 P2, P3): a LAZY, tool-only extension.
 *
 * - A cold load fetches none of its code (recognised by content: the mode wording only the
 *   deferred half carries), and the launcher still lists the tool (its eager stub).
 * - Opening "Your faces" from the Tools launcher fetches it and shows the session.
 * - A whole session on the synthetic face (`?faces.source=synthetic`: scripted vectors and a
 *   canvas video, so no camera and no face model): record, stop, the grid carved at the
 *   suggested k with pictures grabbed from the kept video, neutral switched in and out, a name
 *   edited, saved, and listed.
 * - Test and correct (P3): a categorizer file imported (validated), saved, opened, tested live
 *   on the synthetic face (the readout names its categories), tuned, corrected ("this face is
 *   X"), saved again, and exported as a file.
 *
 * The bundle half of the lazy claim is `npm run check:lazy`.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A two-category file (smile, surprise; reject mode) whose features the synthetic face shows. */
const FIXTURE = join(__dirname, '../../test/faces/fixtures/two_faces.categorizer.json');

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

  // Record my faces (3): Explore (#385 E2), the camera read, the bars and the ring, nothing recorded.
  await record.click();
  await expect(panel.locator('[data-faces-recording="explore"]')).toBeVisible();
  await expect(panel.locator('[data-feature-bar]').first()).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-hold-ring]')).toBeVisible();
  // Space (4), with the Start button focused: the key's command starts the capture (the button's
  // own activation, if the browser still fires it, is a no-op once recording: start, pause and
  // resume are each idempotent, never a toggle).
  await panel.getByRole('button', { name: 'Start capturing (Space)' }).focus();
  await page.keyboard.press('Space');
  await expect(panel.locator('[data-faces-recording="rest"]')).toBeVisible();
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible({ timeout: 15_000 });
  // The synthetic face holds smile, rest, surprise, rest, frown, rest (1.55 s each) after its
  // rest; a full cycle and a half, so a slow machine still sees every face held.
  await page.waitForTimeout(7_000);
  // Space pauses: the bars and the ring keep running, nothing is collected; Space resumes.
  await page.keyboard.press('Space');
  await expect(panel.locator('[data-faces-recording="paused"]')).toBeVisible();
  const status = panel.locator('[data-faces-recording="paused"] p[role=status]');
  const heldCount = async () => Number(/(\d+) held/.exec((await status.textContent()) ?? '')?.[1] ?? NaN);
  const held = await heldCount();
  expect(held).toBeGreaterThan(0);
  await page.waitForTimeout(2_000);
  expect(await heldCount()).toBe(held);
  await expect(panel.locator('[data-feature-bar-tick]').first()).toBeVisible();
  await page.keyboard.press('Space');
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible();
  await page.waitForTimeout(7_000);
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

test('a categorizer file is imported, tested live, tuned, corrected, saved and exported', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(URL_PARAMS);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="faces"]').click();
  const panel = page.locator('[data-tool="faces"]');
  await expect(panel.getByRole('button', { name: 'Import file' })).toBeVisible({ timeout: 30_000 });

  // Import: validated, shown unsaved, no pictures; then saved under a name.
  await panel.locator('input[data-faces-import]').setInputFiles(FIXTURE);
  await expect(panel.locator('[data-face-category]')).toHaveCount(2);
  await expect(panel.locator('[data-faces-unsaved]')).toBeVisible();
  await panel.getByLabel('Categorizer name').fill('Imported faces');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('[data-faces-saved]')).toContainText('Imported faces');
  await expect(panel.locator('[data-faces-unsaved]')).toHaveCount(0);

  // Close, reopen from the list: Open (3), "Test with my face" (4).
  await panel.getByRole('button', { name: 'Close the grid' }).click();
  await panel.getByRole('button', { name: 'Open Imported faces' }).click();
  await panel.getByRole('button', { name: 'Test with my face' }).click();
  // The synthetic face cycles rest, smile, rest, surprise, ...: the readout names both
  // categories and "none of these" for the rest, within a cycle.
  const reading = panel.locator('[data-faces-reading]');
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        seen.add((await reading.textContent()) ?? '');
        return ['smile', 'surprise', 'None of these'].every((x) => seen.has(x));
      },
      { timeout: 30_000, intervals: [100] },
    )
    .toBe(true);

  // Tune and correct: both unsaved until Save.
  await panel.getByRole('slider', { name: 'Reject radius' }).fill('2');
  await expect(panel.locator('[data-faces-unsaved]')).toBeVisible();
  await expect.poll(async () => (await reading.textContent()) ?? '', { timeout: 15_000, intervals: [100] }).toBe('smile');
  await panel.getByRole('button', { name: 'This face is smile' }).click();
  await expect(panel.locator('[data-face-category="cat-1"]')).toContainText('7 held');
  await panel.getByRole('button', { name: 'Stop', exact: true }).click();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('[data-faces-unsaved]')).toHaveCount(0);

  // Export: P1's file, with the correction in it and no tuning.
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export file' }).click();
  const file = JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
  expect(file.format).toBe('thoremin.categorizer');
  expect(file.samples).toHaveLength(JSON.parse(readFileSync(FIXTURE, 'utf8')).samples.length + 1);
  expect(file.tuning).toBeUndefined();

  expect(errors).toEqual([]);
});
