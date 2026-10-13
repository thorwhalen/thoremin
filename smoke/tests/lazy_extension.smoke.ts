/**
 * Lazy extensions in a real browser (`docs/design/lazy-extensions.md`): the ASL extension's code
 * is not fetched by a cold load, and is fetched, and plays, when the player picks an ASL
 * instrument.
 *
 * The bundle half of the claim (no ASL module in an initial chunk) is `npm run check:lazy`;
 * this is the network half, the one a player experiences: what the page actually requests.
 * The deferred code is recognised by its content, not by a chunk name (names are hashed and
 * may change): the `asl-signs` node's description is a string only the deferred half carries.
 */
import { test, expect, type Page } from '@playwright/test';

const SYNTHETIC = '?slot.source=synthetic-hands';
/** In the `asl-signs` node definition only (`packages/ext-asl/src/nodes/asl_signs.ts`). */
const DEFERRED_MARKER = 'Hands → ASL signs';

/** Every script the page fetches, with its body, in order. */
function watchScripts(page: Page): { scripts: { url: string; body: string }[] } {
  const scripts: { url: string; body: string }[] = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\.m?js(\?|$)/.test(url)) return;
    try {
      scripts.push({ url, body: await res.text() });
    } catch {
      // A response the page abandoned has no body; it was not executed either.
    }
  });
  return { scripts };
}

test.describe('a lazy extension loads only on demand', () => {
  test('a cold load fetches no ASL code; picking ASL Viewer fetches it and the sign reader runs', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const { scripts } = watchScripts(page);

    await page.goto(SYNTHETIC);
    await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
    // The engine is ticking (the boot smoke's own probe), so the cold load is complete.
    await expect.poll(() => page.evaluate(() => window.thoremin?.liveVectorTime() ?? -1), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');

    const coldCount = scripts.length;
    expect(coldCount).toBeGreaterThan(0);
    const cold = scripts.filter((s) => s.body.includes(DEFERRED_MARKER)).map((s) => s.url);
    expect(cold, `the cold load fetched the ASL extension's code: ${cold.join(', ')}`).toEqual([]);
    // Nothing of the reader is running before the player asks.
    expect(await page.evaluate(() => window.thoremin!.getOutput('aslSigns', 'signs'))).toBeUndefined();

    // Pick ASL Viewer in the Instruments view (open on load). Its class may be collapsed.
    const row = page.getByRole('button', { name: /^ASL Viewer\b/ }).first();
    if (!(await row.isVisible())) await page.locator('section[data-category="sign"] button').first().click();
    await row.click();

    // The extension's chunk is fetched now...
    await expect.poll(() => scripts.slice(coldCount).some((s) => s.body.includes(DEFERRED_MARKER)), { timeout: 20_000 }).toBe(true);
    // ...and the sign reader is in the running graph, reading the synthetic hands.
    await expect.poll(() => page.evaluate(() => window.thoremin!.getOutput('aslSigns', 'signs') !== undefined), { timeout: 20_000 }).toBe(true);
    const signs = (await page.evaluate(() => window.thoremin!.getOutput('aslSigns', 'signs'))) as { labels?: string[]; scores?: number[] };
    expect(signs.labels?.length).toBeGreaterThan(20);
    expect(signs.scores?.length).toBe(signs.labels?.length);

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
