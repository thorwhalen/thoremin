/**
 * Boot the built app on a chosen hand source and play one shipped instrument: the steps every
 * behaviour test shares (the seed sweep's, factored for the tests that go further than "it loads").
 */
import { expect, type Page } from '@playwright/test';

/** Where the hands come from: the animated synthetic hand, or no hand at all (the replay source
 *  with nothing to replay: the graph composes and ticks, and nobody is in front of the camera). */
export type HandSource = 'synthetic' | 'none';

/** Console noise that is not an app error: MediaPipe's runtime logs its delegate at error level. */
const BENIGN = [/^INFO: /];

/** Collect the page's errors (uncaught exceptions and console errors) into the returned array. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !BENIGN.some((b) => b.test(m.text()))) errors.push(`console.error: ${m.text().slice(0, 200)}`);
  });
  return errors;
}

/** The page address for a hand source, the synthetic body when the seed composes the body camera,
 *  and any extra query (`synthetic.strike=1`, ...). */
export function bootUrl({ hands, body = false, extra = '' }: { hands: HandSource; body?: boolean; extra?: string }): string {
  const q = [hands === 'synthetic' ? 'slot.source=synthetic-hands' : 'slot.source=replay-hands'];
  if (body) q.push('slot.body=synthetic-body');
  if (extra) q.push(extra);
  return `?${q.join('&')}`;
}

/** Load the app, tap to play, and wait for the audio to run. */
export async function boot(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /tap to play/i }).click();
  await expect.poll(() => page.evaluate(() => window.thoremin!.audio().state), { timeout: 10_000 }).toBe('running');
}

/** Choose an instrument from the Instruments list and wait until the composed graph ticks. */
export async function play(page: Page, name: string): Promise<void> {
  const row = page.locator(`li[data-instrument="${name}"]`).first();
  await expect(row, `${name} is listed`).toBeVisible();
  await row.getByRole('button', { name }).first().click();
  const t0 = await page.evaluate(() => window.thoremin!.liveVectorTime());
  await expect.poll(() => page.evaluate(() => window.thoremin!.liveVectorTime()), { timeout: 10_000 }).toBeGreaterThan(t0);
}
