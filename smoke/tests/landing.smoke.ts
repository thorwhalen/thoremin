/**
 * The landing (`index.html`, docs/design/apps.md) in a real browser: arriving at the site's bare
 * URL never asks for the camera or the microphone and loads nothing of the camera app; each card
 * opens its app; and an old link that carried a query (`?slot.source=...`) still lands in the
 * camera app, query intact.
 */
import { test, expect } from '@playwright/test';
import { collectErrors } from '../helpers/boot';

/** Count every `getUserMedia` call the page makes, before any of its own scripts run. */
const COUNT_MEDIA = () => {
  const w = window as unknown as { mediaRequests: number };
  w.mediaRequests = 0;
  const md = navigator.mediaDevices;
  if (md) {
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => {
      w.mediaRequests += 1;
      return real(c);
    };
  }
};

test('the bare URL is a landing that asks for no camera and loads no app', async ({ page }) => {
  const errors = collectErrors(page);
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.addInitScript(COUNT_MEDIA);
  await page.goto('../');
  await expect(page.getByRole('heading', { name: 'Thoremin' })).toBeVisible();
  await expect(page.locator('[data-app]')).toHaveCount(3);
  await page.waitForLoadState('networkidle');
  expect(new URL(page.url()).pathname).toBe('/thoremin/');
  expect(await page.evaluate(() => (window as unknown as { mediaRequests: number }).mediaRequests)).toBe(0);
  const scripts = requested.filter((u) => /\.(m?js|wasm|task)(\?|$)/.test(u) || /mediapipe/.test(u));
  expect(scripts).toEqual([]);
  // Every card's picture and target are served.
  for (const a of await page.locator('[data-app]').all()) {
    const href = await a.evaluate((el) => (el as HTMLAnchorElement).href);
    expect((await page.request.get(href)).status(), href).toBe(200);
    const img = await a.locator('img').evaluate((el) => (el as HTMLImageElement).src);
    expect((await page.request.get(img)).status(), img).toBe(200);
  }
  expect(errors).toEqual([]);
});

test('the camera card opens the camera app', async ({ page }) => {
  await page.goto('../');
  await page.locator('[data-app="instruments"]').click();
  await expect(page).toHaveURL(/\/thoremin\/instruments\/$/);
});

test('the listening card opens the listening games, which ask for no camera', async ({ page }) => {
  await page.addInitScript(COUNT_MEDIA);
  await page.goto('../');
  await page.locator('[data-app="listen"]').click();
  await expect(page).toHaveURL(/\/thoremin\/play\/$/);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => (window as unknown as { mediaRequests: number }).mediaRequests)).toBe(0);
});

test('an old link with a query still opens the camera app, query intact', async ({ page }) => {
  await page.goto('../?slot.source=synthetic-hands');
  await expect(page).toHaveURL(/\/thoremin\/instruments\/\?slot\.source=synthetic-hands$/);
  await expect(page.getByRole('button', { name: /tap to play/i })).toBeVisible({ timeout: 60_000 });
});
