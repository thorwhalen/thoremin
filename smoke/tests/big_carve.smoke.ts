/**
 * A big categorizer in a real browser (#499, #587): past a few hundred holds the heavy stages run
 * in a Web Worker so the page does not freeze. A generated file of `18 x REPS` holds (the two-face
 * fixture repeated with a little jitter) is imported through the tool the way a player does:
 *
 * - merging a take into 400+ holds ("Add more of my faces") runs `mergeSession` in the worker and
 *   the merge lands as usual;
 * - with 1400 holds the "How many" slider re-cuts at a new k, its forest built in the worker.
 *
 * The worker's creation is what the browser reports (`page.on('worker')`), not a guess.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = join(__dirname, '../../test/faces/fixtures/two_faces.categorizer.json');
const URL_PARAMS = '?slot.source=synthetic-hands&carve.source=synthetic';

/** The two-face fixture repeated `reps` times, each copy nudged a little so no two holds coincide. */
function bigFile(reps: number): string {
  const f = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    samples: { vector: Record<string, number>; t: number; cue: string }[];
    categories: { id: string; label: string; members: number[] }[];
  };
  const n = f.samples.length;
  const samples: typeof f.samples = [];
  const categories = f.categories.map((c) => ({ ...c, members: [] as number[] }));
  for (let r = 0; r < reps; r++) {
    f.samples.forEach((s, i) => {
      const vector = Object.fromEntries(Object.entries(s.vector).map(([k, v]) => [k, v + (((r * 31 + i * 17) % 13) - 6) * 0.0005]));
      samples.push({ ...s, vector, t: s.t + r * 100_000 });
    });
    f.categories.forEach((c, k) => categories[k].members.push(...c.members.map((m) => m + r * n)));
  }
  const dir = mkdtempSync(join(tmpdir(), 'big-carve-'));
  const path = join(dir, `big-${reps}.categorizer.json`);
  writeFileSync(path, JSON.stringify({ ...f, samples, categories }));
  return path;
}

function watchWorkers(page: Page): string[] {
  const urls: string[] = [];
  page.on('worker', (w) => urls.push(w.url()));
  return urls;
}

async function openTool(page: Page) {
  await page.goto(URL_PARAMS);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="faces"]').click();
  const panel = page.locator('[data-tool="faces"]');
  await expect(panel.getByRole('button', { name: 'Import file' })).toBeVisible({ timeout: 30_000 });
  return panel;
}

test('merging a take into a big carve runs in the worker and lands as usual', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const workers = watchWorkers(page);
  const panel = await openTool(page);
  await panel.locator('input[data-faces-import]').setInputFiles(bigFile(23)); // 414 holds
  await expect(panel.locator('[data-face-category]')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Add more of my faces' }).click();
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(4_000);
  await panel.getByRole('button', { name: 'Stop and carve' }).click();
  await expect(panel.getByText(/Merged: \d+ of \d+ new faces/)).toBeVisible({ timeout: 30_000 });
  expect(workers.some((u) => /forest_worker/.test(u)), `workers: ${workers.join(', ')}`).toBe(true);
  expect(errors).toEqual([]);
});

test('the k slider re-cuts a big carve, its forest built in the worker', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const workers = watchWorkers(page);
  const panel = await openTool(page);
  await panel.locator('input[data-faces-import]').setInputFiles(bigFile(78)); // 1404 holds, two thirds out of the bins
  const cats = panel.locator('[data-face-category]');
  await expect(cats).toHaveCount(2);
  // Re-divide without recording again: one more. The forest is built off the page; the cut waits for it.
  await panel.getByLabel('Number of categories').fill('3');
  await expect(cats).toHaveCount(3, { timeout: 60_000 });
  expect(workers.some((u) => /forest_worker/.test(u)), `workers: ${workers.join(', ')}`).toBe(true);
  expect(errors).toEqual([]);
});
