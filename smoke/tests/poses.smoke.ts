/**
 * "Your poses" in a real browser (#382 = #385 E9): the carve tool over held body poses, on the
 * scripted body (`?carve.source=synthetic`: a skeleton's vectors and a canvas video, so no camera
 * and no pose model; `?slot.body=synthetic-body` keeps the composed body branch camera-free too).
 *
 * Tools (1), Your poses (2), Record my poses (3), Start capturing (4): the rest, the three nuisance
 * demonstrations (the first one's instruction and its Skip button shown), then the scripted poses;
 * Stop and carve shows the grid in the body's words, a stick figure per held pose (no camera
 * picture: opt-in); saved, and bound to commands, which opens the Gestures tool on it.
 */
import { test, expect } from '@playwright/test';

const URL_PARAMS = '?slot.source=synthetic-hands&slot.body=synthetic-body&carve.source=synthetic';

test('Your poses records, carves, saves and binds the scripted body', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL_PARAMS);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });

  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="poses"]').click();
  const panel = page.locator('[data-tool="poses"]');
  await expect(panel).toBeVisible();
  const record = panel.getByRole('button', { name: 'Record my poses' });
  await expect(record).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('checkbox', { name: /Left and right are the same pose/ })).not.toBeChecked();
  await expect(panel.getByRole('checkbox', { name: /Also keep camera pictures/ })).not.toBeChecked();

  await record.click();
  await expect(panel.locator('[data-faces-recording="explore"]')).toBeVisible();
  await expect(panel.locator('[data-feature-bar]').first()).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: 'Start capturing (Space)' }).click();
  await expect(panel.locator('[data-faces-recording="rest"]')).toBeVisible();
  await expect(panel.getByText(/Stand \(or sit\) facing the camera/)).toBeVisible();
  // The first nuisance demonstration follows the rest, with a way past it.
  await expect(panel.getByText(/walk a little closer to the camera/)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole('button', { name: 'Skip this step' })).toBeVisible();
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible({ timeout: 25_000 });
  // The scripted body holds arms up, rest, left arm out, rest, right arm out, rest, crouch, rest
  // (1.55 s each): once through, and a little more for a slow machine.
  await page.waitForTimeout(15_000);
  await panel.getByRole('button', { name: 'Stop and carve' }).click();

  const summary = panel.locator('[data-faces-summary]');
  await expect(summary).toContainText('A pose you never taught reads as: neutral', { timeout: 15_000 });
  const cats = panel.locator('[data-face-category]');
  await expect.poll(() => cats.count()).toBeGreaterThanOrEqual(3);
  // Stick figures, not camera pictures.
  const figure = panel.locator('[data-face-still]').first();
  await expect(figure).toBeVisible();
  await expect(figure).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(panel.getByText(/drawn as a stick figure/)).toBeVisible();

  await panel.getByRole('textbox', { name: 'Categorizer name' }).fill('My poses');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  const bind = panel.getByRole('button', { name: 'Bind My poses to commands' });
  await expect(bind).toBeVisible({ timeout: 10_000 });
  await bind.click();
  const yours = page.getByRole('region', { name: 'Your categories' });
  await expect(yours).toBeVisible({ timeout: 10_000 });
  await expect(yours.getByRole('combobox', { name: 'Command for pose 1' })).toBeVisible();
  expect(errors).toEqual([]);
});
