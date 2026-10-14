/**
 * "Conduct with body", in a real browser against the built bundle (#375).
 *
 * The walk the PR states, click by click from a cold load: Tap to play, Conductor, Conduct
 * with body, Start conducting; then (since #377's transport rules wait for a held ready pose
 * the synthetic skeleton never reliably makes) the rules off, so the first stroke starts. No camera and no pose model: the hands are the synthetic
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

  // Click 3: Start. With the body, the transport rules (#377) wait for a ready pose: an arm
  // raised and held still. The synthetic skeleton raises and lowers its arms without stopping,
  // so whether it ever reads as ready is timing luck (the flake of #469); the waiting readout is
  // what a player sees, and it says the body conductor is live.
  await page.getByRole('button', { name: 'Start conducting' }).click();
  const live = page.getByTestId('conductor-live');
  await expect(live).toHaveText(/Raise your beating arm|Ready\.|Upbeat seen|Finding your tempo|Following at \d+ bpm/, { timeout: 30_000 });
  // Without the rules the first stroke starts, as for the hands: the bouncing body's strokes
  // reaching the follower prove the composed graph carries the body into the conductor. The
  // model load is covered by the generous timeout (a cold CI runner).
  const rules = page.getByTestId('conductor-transport-rules');
  await expect(rules).toBeEnabled({ timeout: 30_000 });
  await rules.uncheck();
  await expect(rules).not.toBeChecked();
  await expect(live).toHaveText(/Finding your tempo|Following at \d+ bpm/, { timeout: 45_000 });
});
