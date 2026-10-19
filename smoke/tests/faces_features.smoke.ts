/**
 * Features of Your faces that the other face smokes (`faces.smoke.ts`, `face_categorizer_play.smoke.ts`)
 * do not drive, on the synthetic face (`?carve.source=synthetic`, no camera):
 *
 * - **Lean in and out** (#349): after a hold is taken, the lean button records the same face as
 *   several holds that the carve keeps in ONE category with the hold they leaned on.
 * - **Spoken quiz prompts** (#445): with the box ticked the quiz says "Relax" and then a category's
 *   name through the browser's speech synthesis (stubbed here to record what it was asked to say).
 * - **Play it** (#357): from the saved list, the instrument's face chords read the categorizer, and
 *   the node's own output names its categories.
 */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';

const FIXTURE = join(__dirname, '../../test/faces/fixtures/two_faces.categorizer.json');
const URL_PARAMS = '?slot.source=synthetic-hands&carve.source=synthetic';

async function openTool(page: Page) {
  await page.goto(URL_PARAMS);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="faces"]').click();
  return page.locator('[data-tool="faces"]');
}

/** Import the two-face fixture and save it under `name`. */
async function importAndSave(panel: ReturnType<Page['locator']>, name: string) {
  await expect(panel.getByRole('button', { name: 'Import file' })).toBeVisible({ timeout: 30_000 });
  await panel.locator('input[data-faces-import]').setInputFiles(FIXTURE);
  await expect(panel.locator('[data-face-category]')).toHaveCount(2);
  await panel.getByLabel('Categorizer name').fill(name);
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.locator('[data-faces-saved]')).toContainText(name);
}

test('a lean after a hold makes several holds, kept in one category with the hold it leaned on', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const panel = await openTool(page);
  await panel.getByRole('button', { name: 'Record my faces' }).click();
  await panel.getByRole('button', { name: 'Start capturing (Space)' }).focus();
  await page.keyboard.press('Space');
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible({ timeout: 15_000 });
  // Pause (Space) once a face is held, so the lean's button can be held steady.
  const held = async () => Number(/(\d+) held/.exec((await panel.locator('[data-faces-recording="paused"] p[role=status]').textContent()) ?? '')?.[1] ?? NaN);
  await page.waitForTimeout(4_000);
  await page.keyboard.press('Space');
  await expect(panel.locator('[data-faces-recording="paused"]')).toBeVisible();
  const before = await held();
  expect(before).toBeGreaterThan(0);

  const lean = panel.getByRole('button', { name: 'Hold to lean in and out' });
  await expect(lean).toBeEnabled();
  await lean.hover();
  await page.mouse.down();
  await page.waitForTimeout(1_500);
  await page.mouse.up();
  await expect.poll(held, { timeout: 10_000 }).toBeGreaterThan(before + 1);
  const afterLean = await held();

  await page.keyboard.press('Space');
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible();
  await page.waitForTimeout(3_000);
  await panel.getByRole('button', { name: 'Stop and carve' }).click();
  await expect(panel.locator('[data-faces-summary]')).toBeVisible({ timeout: 20_000 });
  // The lean's holds are among the carved holds, together in one category: the largest category
  // holds at least the lean's holds and the one they leaned on.
  const sizes = await panel.locator('[data-face-category]').evaluateAll((els) =>
    els.map((el) => Number(/(\d+) held/.exec(el.textContent ?? '')?.[1] ?? 0)),
  );
  expect(Math.max(...sizes)).toBeGreaterThanOrEqual(afterLean - before + 1);
  expect(errors).toEqual([]);
});

test('the quiz says its prompts out loud when the box is ticked', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { __said: string[] }).__said = said;
    class Utterance {
      constructor(public text: string) {}
    }
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', {
      value: { cancel: () => undefined, speak: (u: Utterance) => said.push(u.text) },
      configurable: true,
    });
  });
  const panel = await openTool(page);
  await importAndSave(panel, 'Spoken quiz');
  await panel.getByRole('button', { name: 'Close the grid' }).click();
  await panel.getByRole('button', { name: 'Open Spoken quiz' }).click();
  await panel.getByRole('button', { name: 'Test with my face' }).click();
  await panel.getByLabel('Say the prompts out loud').check();
  await panel.getByRole('button', { name: 'Quiz me' }).click();
  const said = () => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
  await expect.poll(said, { timeout: 10_000 }).toContain('Relax');
  // After the relax, a face to make: one of the categorizer's two names.
  await expect.poll(async () => (await said()).some((t) => t === 'smile' || t === 'surprise'), { timeout: 15_000 }).toBe(true);
  await panel.getByRole('button', { name: 'Stop the quiz' }).click();
  expect(errors).toEqual([]);
});

test('Play it on a saved categorizer makes the instrument read it', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const panel = await openTool(page);
  await importAndSave(panel, 'Played faces');
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: 'Close the grid' }).click().catch(() => undefined);
  await panel.getByRole('button', { name: 'Play Played faces' }).click();
  await expect(panel.locator('[data-faces-playing]')).toHaveText(/Playing|Loading/, { timeout: 20_000 });
  await expect(panel.locator('[data-faces-playing]')).toHaveText('Playing', { timeout: 30_000 });
  // The node runs with the saved model: it names the categorizer's two categories.
  const personal = () =>
    page.evaluate(() => (window.thoremin!.getOutput('faceCat', 'expression') as { personal?: { names?: string[]; categorizer?: string } } | undefined)?.personal);
  await expect.poll(async () => (await personal())?.names, { timeout: 20_000 }).toEqual(['smile', 'surprise']);
  expect(errors).toEqual([]);
});
