/**
 * "Your hand shapes" in a real browser (#385 E8): the face categorizer's tool over one hand's
 * shape, on the scripted hand (`?carve.source=synthetic`: an articulated hand's vectors and a
 * canvas video, so no camera and no hand model).
 *
 * Tools (1), Your hand shapes (2), Record my hand shapes (3), Start capturing (4): the take's rest,
 * then the scripted shapes; Stop and carve shows the grid in the hand's words, with a picture per
 * held shape; saved, and bound to commands, which opens the Gestures tool on it.
 */
import { test, expect } from '@playwright/test';

const URL_PARAMS = '?slot.source=synthetic-hands&carve.source=synthetic';

test('Your hand shapes records, carves, saves and binds the scripted hand', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(URL_PARAMS);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });

  await page.locator('[data-tools-launcher]').click();
  await page.locator('[data-launcher-tool="hand-shapes"]').click();
  const panel = page.locator('[data-tool="hand-shapes"]');
  await expect(panel).toBeVisible();
  const record = panel.getByRole('button', { name: 'Record my hand shapes' });
  await expect(record).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('combobox', { name: 'Which hand' })).toHaveValue('either');

  await record.click();
  await expect(panel.locator('[data-faces-recording="explore"]')).toBeVisible();
  await expect(panel.locator('[data-feature-bar]').first()).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: 'Start capturing (Space)' }).click();
  await expect(panel.locator('[data-faces-recording="rest"]')).toBeVisible();
  await expect(panel.getByText(/Hold one hand up to the camera/)).toBeVisible();
  await expect(panel.locator('[data-faces-recording="faces"]')).toBeVisible({ timeout: 15_000 });
  // The scripted hand holds open, rest, fist, rest, point, rest, pinch, rest (1.55 s each) after
  // its rest: once through, and a little more for a slow machine.
  await page.waitForTimeout(15_000);
  await panel.getByRole('button', { name: 'Stop and carve' }).click();

  const summary = panel.locator('[data-faces-summary]');
  await expect(summary).toContainText('A hand shape you never taught reads as: neutral', { timeout: 15_000 });
  const cats = panel.locator('[data-face-category]');
  await expect.poll(() => cats.count()).toBeGreaterThanOrEqual(3);
  await expect(panel.locator('[data-face-still]').first()).toBeVisible();
  await expect(panel.locator('[data-face-category]', { hasText: 'fist' })).toHaveCount(1);

  await panel.getByRole('textbox', { name: 'Categorizer name' }).fill('My shapes');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  const bind = panel.getByRole('button', { name: 'Bind My shapes to commands' });
  await expect(bind).toBeVisible({ timeout: 10_000 });
  await bind.click();
  // The Gestures tool opens on the bound set: its categories, ready for a command each.
  await expect(page.locator('[data-tool="gestures"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-tool="gestures"]')).toContainText('fist');
  expect(errors).toEqual([]);
});
