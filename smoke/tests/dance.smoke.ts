/**
 * "Dance the orchestra" in a real browser against the built bundle (#380), with no camera and no
 * pose model: the hands are the synthetic sweep and the body the synthetic bouncing skeleton
 * (`?slot.body=synthetic-body`), whose steps repeat at a known period. Click by click from a cold
 * load: Tap to play, Conductor, Dance the orchestra, Start. The dancer's pulse must lock, the
 * piece must arm and start on a step, and then follow the dancer: the conductor's own outputs
 * (its `dance` mode, its beat counter) are the evidence, not just the readout text.
 */
import { test, expect } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands&slot.body=synthetic-body';

type Live = { state?: string; mode?: string };

test('Dance the orchestra: the synthetic dancer locks, the piece starts on a step and the beat runs', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(SYNTHETIC);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await page.locator('[data-tools-bar] [data-tool="conductor"]').click();
  await page.getByRole('radio', { name: 'Dance the orchestra' }).click();
  await expect(page.getByRole('radio', { name: 'Dance the orchestra' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Off. Press Start, then dance: the piece starts on your step.')).toBeVisible();
  await page.getByRole('button', { name: 'Start conducting' }).click();

  const live = page.getByTestId('conductor-live');
  // The rhythm has to hold for a few seconds before anything starts; then it follows.
  await expect(live).toHaveText(/Got your rhythm|Following your dance at \d+ bpm|Holding \d+ bpm|Dance: the piece starts/, { timeout: 30_000 });
  await expect(live).toHaveText(/Following your dance at \d+ bpm/, { timeout: 60_000 });

  // The conductor node itself: running, in the dance's following mode, with a beat that advances.
  const dance = () => page.evaluate(() => window.thoremin!.getOutput('conductor', 'dance') as string | undefined);
  const beat = () => page.evaluate(() => (window.thoremin!.getOutput('conductor', 'time') as { beat?: number } | undefined)?.beat ?? -1);
  await expect.poll(dance, { timeout: 30_000 }).toBe('following');
  const b0 = await beat();
  await page.waitForTimeout(3_000);
  expect(await beat()).toBeGreaterThan(b0);
  expect(errors).toEqual([]);
});
