/**
 * Latency probe smoke (#227): `?probe=latency` is reachable in the built bundle and
 * measures the live loop.
 *
 * The probe is opt-in by URL, so nothing else in the suite would notice it rotting.
 * This boots it with synthetic hands (no camera, so the camera stages stay empty by
 * design), taps to play, and asserts the panel is up and the two stages that need no
 * camera are being measured: the tick's compute time and the audio schedule-to-speaker
 * time. The numbers themselves are the business of `smoke/latency/measure.mjs`.
 */
import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    thoreminLatency?: { snapshot(): { stages: Record<string, { n: number; mean: number }> } };
  }
}

test('?probe=latency shows the panel and measures the tick and the audio path', async ({ page }) => {
  await page.goto('?probe=latency&slot.source=synthetic-hands');
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await expect(page.getByTestId('latency-probe')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.thoreminLatency?.snapshot().stages.scheduleToSpeaker.n ?? 0), { timeout: 15_000 })
    .toBeGreaterThan(10);
  const s = await page.evaluate(() => window.thoreminLatency!.snapshot().stages);
  expect(s.tickCompute.n).toBeGreaterThan(10);
  expect(s.tickCompute.mean).toBeGreaterThanOrEqual(0);
  expect(s.tickPeriod.mean).toBeGreaterThan(0);
});

test('without the parameter, no probe is installed', async ({ page }) => {
  await page.goto('?slot.source=synthetic-hands');
  await page.getByRole('button', { name: /tap to play/i }).waitFor({ timeout: 60_000 });
  expect(await page.evaluate(() => window.thoreminLatency === undefined)).toBe(true);
  await expect(page.getByTestId('latency-probe')).toHaveCount(0);
});
