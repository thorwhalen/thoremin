/**
 * The orchestra's lazy load, in a real browser against the built bundle (#187 PR 5).
 *
 * The rule (`docs/design/lazy-loading.md`): the synth chunk (`spessasynth_lib`), its
 * AudioWorklet processor and the 3.7 MB soundfont are fetched only when the player asks
 * for the orchestra, never on a cold load and never by opening the Conductor. Then the
 * walk the PR states, click by click: Tap to play, Conductor, Play with the orchestra
 * (the download, with its readout reaching `ready`), Start conducting (the orchestra
 * `active`). The build-time half of the rule is `vite.lazy-guard.ts`; this is the
 * network half.
 */
import { test, expect, type Page } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands';
/** What only the orchestra may fetch. */
const ORCHESTRA_ASSET = /orchestra_engine-[^/]*\.js|spessasynth_processor[^/]*\.js|soundfonts\/orchestra\.sf3/;

/** Every orchestra asset the page fetches. (The AudioWorklet's `addModule` fetch is not
 *  reported as a page request in Chromium, so the worklet is proven by the synth reaching
 *  `ready` instead: constructing it fails unless its processor is registered.) */
function orchestraRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (ORCHESTRA_ASSET.test(r.url())) seen.push(new URL(r.url()).pathname);
  });
  return seen;
}

const readout = (page: Page) => page.getByTestId('orchestra-controls').locator('[data-load-phase]');

test('the orchestra loads only when switched on, and plays once conducting starts', async ({ page }) => {
  const fetched = orchestraRequests(page);
  await page.goto(SYNTHETIC);

  // Click 1: audio on. A cold load fetched nothing of the orchestra.
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeHidden();

  // Click 2: the Conductor, pinned to the tools bar. Opening it fetches nothing either.
  await page.locator('[data-tools-bar] [data-tool="conductor"]').click();
  const toggle = page.getByLabel('Play with the orchestra');
  await expect(toggle).toBeVisible();
  await expect(page.getByText(/MB download the first time/)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(fetched, 'nothing of the orchestra before it is asked for').toEqual([]);

  // Click 3: the orchestra. Now the synth chunk, its worklet and the soundfont arrive;
  // `ready` means the worklet processor registered and the bank loaded into the synth.
  await toggle.check();
  await expect(readout(page)).toHaveAttribute('data-load-phase', 'ready', { timeout: 60_000 });
  expect(fetched.some((u) => /orchestra_engine-/.test(u)), `synth chunk fetched: ${fetched.join(', ')}`).toBe(true);
  expect(fetched.some((u) => /soundfonts\/orchestra\.sf3$/.test(u)), 'soundfont fetched').toBe(true);

  // Click 4: Start. The orchestra is the one playing the piece.
  await page.getByRole('button', { name: 'Start conducting' }).click();
  await expect(readout(page)).toHaveAttribute('data-load-phase', 'active', { timeout: 20_000 });
});
