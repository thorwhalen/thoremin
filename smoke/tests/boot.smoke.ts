/**
 * Boot smoke (#209): the built bundle, in a real browser, actually plays.
 *
 * Boots with `?slot.source=synthetic-hands` (no camera, no MediaPipe), taps to play,
 * and asserts the four things no Node or jsdom gate can: the shell reaches `ready`
 * then `live`; the engine TICKS (the live feature vector's time rises — which only
 * happens if clock → Applier → tick → nodes → tap all ran); the audio graph is up (a
 * running AudioContext behind a non-zero master gain); and the overlay canvas is
 * drawing (its pixels change between two frames). Plus the check #201 asked for in
 * spirit: no uncaught page error and no console error during the whole boot — a
 * React-layer runtime failure would show up here even though nothing type-checks it.
 */
import { test, expect, type Page } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands';

/** Collect uncaught errors and console errors for the page's whole life. */
function watchErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return { errors };
}

const status = (page: Page) => page.locator('text=Thoremin').locator('..').locator('div').last();

test.describe('the built bundle boots and plays headless', () => {
  test('ready → tap to play → live, with the engine ticking, audio up, overlay drawing, and no errors', async ({ page }) => {
    const { errors } = watchErrors(page);
    await page.goto(SYNTHETIC);

    // The shell mounts and the engine initialises (no model to load with synthetic hands).
    await expect(status(page)).toHaveText('ready', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible();

    // The probe exists before audio: the engine is built and ticking already.
    const t0 = await page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1);
    expect(t0).toBeGreaterThanOrEqual(0);
    await expect.poll(() => page.evaluate(() => window.thoremin!.liveVectorTime()), { timeout: 10_000 }).toBeGreaterThan(t0);

    // Synthetic hands are present in the feature stream the mapping reads.
    const hands = (await page.evaluate(() => window.thoremin!.getOutput('feat', 'features'))) as { right?: { present?: boolean }; left?: { present?: boolean } } | undefined;
    expect(hands?.right?.present || hands?.left?.present).toBe(true);

    // Tap to play: the audio graph comes up.
    await page.getByRole('button', { name: /tap to play/i }).click();
    await expect(status(page)).toHaveText('live');
    await expect.poll(() => page.evaluate(() => window.thoremin!.audio().state), { timeout: 10_000 }).toBe('running');
    const master = await page.evaluate(() => window.thoremin!.audio().masterGain);
    expect(master).not.toBeNull();
    expect(master!).toBeGreaterThan(0);

    // The synth is sounding voices (the merged params feeding webaudio-synth).
    await expect
      .poll(
        () => page.evaluate(() => ((window.thoremin!.getOutput('merge', 'params') as { voices?: Array<{ present: boolean; gain: number }> })?.voices ?? []).some((v) => v.present && v.gain > 0)),
        { timeout: 10_000 },
      )
      .toBe(true);

    // The overlay canvas is drawing: two samples half a second apart differ.
    const snap = () => page.evaluate(() => document.querySelector('canvas')!.toDataURL('image/png').length + ':' + document.querySelector('canvas')!.toDataURL('image/png').slice(-64));
    const a = await snap();
    await page.waitForTimeout(500);
    const b = await snap();
    expect(b).not.toBe(a);

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the ?engine=legacy view still mounts (the frozen app is reachable, not rotted)', async ({ page }) => {
    const { errors } = watchErrors(page);
    await page.goto('?engine=legacy');
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(1500);
    // The legacy app asks for a camera it will not get here; that is not an error we own.
    const owned = errors.filter((e) => !/getUserMedia|NotAllowedError|NotFoundError|camera/i.test(e));
    expect(owned, owned.join('\n')).toEqual([]);
  });
});
