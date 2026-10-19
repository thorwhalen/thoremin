/**
 * A personal face categorizer, played (#359, a follow-up to #330 P4): an instrument that names
 * a saved categorizer loads the lazy `face-categorizer` node at BOOT, from the persisted
 * settings alone, and the graph runs it.
 *
 * The jsdom tests cover the editor section and its dispatch, and a fixture replay covers the
 * node and the renderer; what only a browser shows is the lazy chunk fetched for a graph that
 * names the node before anything is opened (the `lazy_extension.smoke.ts` shape, for ASL).
 *
 * The categorizer is saved the way a player saves one (Tools, Your faces, Import file, Save), and
 * the instrument is pointed at it the way a player does (Edit, Face categorizer); then the page
 * is reloaded. Hands are synthetic and no face is in view: the node must read "nothing" and the
 * instrument must keep ticking, without a page error.
 *
 * The node is recognised by content, not by chunk name (names are hashed): its description is a
 * string only the deferred node module carries.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';

/** A two-category file (smile, surprise; reject mode), the one `faces.smoke.ts` imports. */
const FIXTURE = join(__dirname, '../../test/faces/fixtures/two_faces.categorizer.json');
const NAME = 'Smoke play';

const URL_PARAMS = '?slot.source=synthetic-hands&carve.source=synthetic';
/** In the `face-categorizer` node definition only (`packages/ext-faces/src/nodes/face_categorizer.ts`). */
const NODE_MARKER = 'Your own face categorizer (#330), read live';
/** The node's id in the composed graph (`packages/ext-faces/src/branches.ts`). */
const NODE_ID = 'faceCat';

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

async function booted(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 20_000 }).toBeGreaterThan(0);
}

test('an instrument naming a saved categorizer loads the node at boot and plays with no face', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const { scripts, settled } = watchScripts(page);

  // 1. A cold load composes no categorizer: the node is not in the graph.
  await page.goto(URL_PARAMS);
  await booted(page);
  expect(await page.evaluate((id) => window.thoremin!.getOutput(id, 'expression'), NODE_ID)).toBeUndefined();
  await page.waitForLoadState('networkidle');
  await settled();
  const cold = scripts.filter((s) => s.body.includes(NODE_MARKER)).map((s) => s.url);
  expect(cold, `the cold load fetched the categorizer node: ${cold.join(', ')}`).toEqual([]);

  // 2. Save a categorizer the way a player does: Tools, Your faces, Import file, Save.
  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="faces"]').click();
  const panel = page.locator('[data-tool="faces"]');
  await expect(panel.getByRole('button', { name: 'Import file' })).toBeVisible({ timeout: 30_000 });
  await panel.locator('input[data-faces-import]').setInputFiles(FIXTURE);
  await expect(panel.locator('[data-face-category]')).toHaveCount(2);
  await panel.getByLabel('Categorizer name').fill(NAME);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('[data-faces-saved]')).toContainText(NAME);
  await page.keyboard.press('Escape');

  // 3. Point an instrument at it: its Edit (which chooses it), the Face categorizer section, the
  // categorizer.
  const gear = page.getByRole('button', { name: /^Edit / }).first();
  const chosen = (await gear.getAttribute('aria-label'))!.slice('Edit '.length);
  await gear.click();
  const section = page.locator('details[data-section="Face categorizer"]');
  if (!(await section.evaluate((d) => (d as HTMLDetailsElement).open))) await section.locator('> summary').click();
  const select = section.getByLabel('Face categorizer', { exact: true });
  await expect(select.locator('option', { hasText: NAME })).toHaveCount(1, { timeout: 20_000 });
  await select.selectOption({ label: NAME });
  // Choosing one turns the face chords on (the section's own rule), so the branch composes now.
  await expect.poll(() => page.evaluate((id) => window.thoremin!.getOutput(id, 'expression') !== undefined, NODE_ID), { timeout: 20_000 }).toBe(true);

  // The node's chunk, recognised by its content the one time it is fetched over the network.
  await settled();
  const nodeChunk = scripts.find((s) => s.body.includes(NODE_MARKER))?.url;
  expect(nodeChunk, 'choosing the categorizer did not fetch the node').toBeDefined();

  // 4. Reload: the persisted instrument alone must fetch that chunk, before anything is opened.
  // (By URL: a reload may serve it from the cache, where the body is not readable.)
  const before = scripts.length;
  await page.reload();
  await booted(page);
  await expect.poll(() => scripts.slice(before).some((s) => s.url === nodeChunk), { timeout: 20_000 }).toBe(true);
  // The node runs in the live graph with the saved model (not the general model passed through),
  // and with no face in view it reads "none of these".
  const reading = () =>
    page.evaluate((id) => window.thoremin!.getOutput(id, 'expression'), NODE_ID) as Promise<
      { present?: boolean; personal?: { categorizer?: string; id?: string | null; names?: string[] } } | undefined
    >;
  await expect.poll(async () => (await reading())?.personal?.categorizer ?? '', { timeout: 20_000 }).not.toMatch(/^(general)?$/);
  const expression = (await reading())!;
  expect(expression.present).toBe(false);
  expect(expression.personal?.id).toBeNull();
  expect(expression.personal?.names).toEqual(['smile', 'surprise']);
  // It keeps playing: the engine ticks on past the node's first reading.
  const t = await page.evaluate(() => window.thoremin!.liveVectorTime());
  await expect.poll(() => page.evaluate(() => window.thoremin!.liveVectorTime()), { timeout: 10_000 }).toBeGreaterThan(t);

  // 5. The section says what the face chords read with: Edit, the Face categorizer section. Opening
  // the editor keeps the instrument's edit (the gear is not a re-select, which would revert it).
  await page.getByRole('button', { name: `Edit ${chosen}`, exact: true }).click();
  const reopened = page.locator('details[data-section="Face categorizer"]');
  if (!(await reopened.evaluate((d) => (d as HTMLDetailsElement).open))) await reopened.locator('> summary').click();
  await expect(reopened.locator('[data-faces-readout]')).toHaveText(`Reading with ${NAME}`, { timeout: 20_000 });
  await expect(reopened.getByLabel('Face categorizer', { exact: true }).locator('option:checked')).toHaveText(NAME);
  expect((await reading())?.personal?.names).toEqual(['smile', 'surprise']);

  expect(errors, errors.join('\n')).toEqual([]);
});
