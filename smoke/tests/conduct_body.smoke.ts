/**
 * "Conduct with body", in a real browser against the built bundle (#375).
 *
 * The walk the PR states, click by click from a cold load: Tap to play, Conductor, Conduct
 * with body, Start conducting. No camera and no pose model: the hands are the synthetic
 * sweep (which never strokes, so the hand conductor would wait forever) and the body is the
 * synthetic bouncing skeleton (`?slot.body=synthetic-body`). The follower reporting strokes
 * therefore proves the composed graph carries the body into the conductor (the derivation
 * composed the body source, the edge exists, the node reads it). How well it follows a real
 * conductor is the node and composed-graph tests' (`test/conductor_body.test.ts`).
 */
import { test, expect } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands&slot.body=synthetic-body';

test('Conduct with body: three clicks from a cold load, and the body leads', async ({ page }) => {
  await page.goto(SYNTHETIC);

  // Click 0: audio on (the shell's gate, before any instrument plays).
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeHidden();

  // Clicks 1 and 2: the Conductor (pinned), then what it conducts with.
  await page.locator('[data-tools-bar] [data-tool="conductor"]').click();
  await page.getByRole('radio', { name: 'Conduct with body' }).click();
  await expect(page.getByRole('radio', { name: 'Conduct with body' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Off. Press Start, then beat time with your arm or a bounce.')).toBeVisible();

  // Click 3: Start. The follower waits for a first stroke, then hears the body's.
  await page.getByRole('button', { name: 'Start conducting' }).click();
  await expect(page.getByTestId('conductor-live')).toHaveText(/Finding your tempo|Following at \d+ bpm/, { timeout: 30_000 });
});
