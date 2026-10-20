/**
 * Every shipped instrument loads and plays, in a real browser, with no camera (the seed sweep).
 *
 * The seeds are data (`smoke/seed_instruments.json`, kept equal to `SEED_INSTRUMENTS` by
 * `test/seed_instruments_manifest.test.ts`, so a new seed cannot drop out of this sweep). For each
 * one: boot on the synthetic hands (and the synthetic body where the seed composes the body
 * camera), choose it from the Instruments list, and assert the engine ticks on the composed graph,
 * the page logs no error, and, unless the manifest says why the seed is silent under synthetic
 * hands (it needs enrolment, a second input or a sign), the master output is not silent.
 */
import { test, expect } from '@playwright/test';
import manifest from '../seed_instruments.json';

/** The loudest master-output sample, over this long, that counts as sound. */
const SOUND = { windowMs: 3_000, pollMs: 150, floor: 0.003 } as const;

/** Console noise that is not an app error: MediaPipe's runtime logs its delegate at error level. */
const BENIGN = [/^INFO: /];

for (const seed of manifest.seeds as { name: string; body: boolean; silent?: string }[]) {
  test(`${seed.name} loads${seed.silent ? ' (silent under the synthetic hands: ' + seed.silent + ')' : ' and sounds'}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !BENIGN.some((b) => b.test(m.text()))) errors.push(`console.error: ${m.text().slice(0, 200)}`);
    });
    await page.goto(`?slot.source=synthetic-hands${seed.body ? '&slot.body=synthetic-body' : ''}`);
    await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /tap to play/i }).click();
    await expect.poll(() => page.evaluate(() => window.thoremin!.audio().state), { timeout: 10_000 }).toBe('running');

    const row = page.locator(`li[data-instrument="${seed.name}"]`).first();
    await expect(row, `${seed.name} is listed`).toBeVisible();
    await row.getByRole('button', { name: seed.name }).first().click();

    // The composed graph ticks: the live vector's time keeps rising after the switch.
    const t0 = await page.evaluate(() => window.thoremin!.liveVectorTime());
    await expect.poll(() => page.evaluate(() => window.thoremin!.liveVectorTime()), { timeout: 10_000 }).toBeGreaterThan(t0);

    let loudest = 0;
    for (let t = 0; t < SOUND.windowMs; t += SOUND.pollMs) {
      await page.waitForTimeout(SOUND.pollMs);
      loudest = Math.max(loudest, (await page.evaluate(() => window.thoremin!.level())) ?? 0);
    }
    if (!seed.silent) expect(loudest, `${seed.name} is not silent`).toBeGreaterThan(SOUND.floor);
    expect(errors).toEqual([]);
  });
}
