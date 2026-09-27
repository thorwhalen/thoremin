/**
 * Record the air instruments' UI in the built bundle: the Instruments view's Air group
 * (#249) and the air drum's pad editor (#245), placing, moving, resizing and recolouring
 * pads. Silent (the sound of the pads is `instrument_take.ts` + `render_take_audio.mjs`,
 * which hear the shipped voices from a scripted drummer).
 *
 * Drives `vite preview` in headless Chromium with the camera-free `synthetic-hands`
 * source, records the page (Playwright's recorder), and writes `marks.json`: when each
 * step happened and the on-screen box of the panel it happened in, so a GIF can be cut
 * and cropped to it. Also writes a screenshot per step.
 *
 * Playwright is resolved from `smoke/node_modules` (run `npm ci` in `smoke/` first).
 *
 * Usage:
 *   npx vite preview --port 4391 --strictPort &
 *   node scripts/demos/tour_air.mjs [--url http://localhost:4391/thoremin/] [--out DIR]
 */
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'smoke', 'package.json'));
const { chromium } = require('@playwright/test');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const url = arg('url', 'http://localhost:4391/thoremin/');
const out = arg('out', join(process.env.THOREMIN_DATA_DIR ?? join(homedir(), '.local', 'share', 'thoremin'), 'demos', 'round3', 'tour'));
mkdirSync(out, { recursive: true });
const W = 1280;
const H = 860;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
const page = await context.newPage();
const t0 = Date.now();
const marks = [];
const box = async (locator) => (await locator.count()) ? await locator.first().boundingBox() : null;
const mark = async (label, locator) => {
  marks.push({ label, t: (Date.now() - t0) / 1000, box: locator ? await box(locator) : null });
  await page.screenshot({ path: join(out, `${String(marks.length).padStart(2, '0')}.png`) });
};
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(url + '?slot.source=synthetic-hands');
await page.getByRole('button', { name: /tap to play/i }).waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: /tap to play/i }).click();
await pause(1500);

// 1. The Instruments view, grouped: scroll the Air group into view.
const air = page.getByText(/^Air instruments$/i).last();
const panel = page.locator('text=Instruments').first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
if (await air.count()) await air.evaluate((el) => el.scrollIntoView({ block: 'start' }));
await pause(800);
await mark('instruments: the Air group', panel);

// 2. Load the Air Drum instrument and open its editor.
await page.getByText('Air Drum', { exact: true }).first().click();
await pause(1200);
await page.getByRole('button', { name: 'Edit Air Drum' }).first().click();
await pause(1500);
const stage = page.getByLabel('Pad stage');
await stage.scrollIntoViewIfNeeded();
await pause(600);
const editor = stage.locator('xpath=ancestor::div[.//button[normalize-space()="Starter kit"]][1]');
await mark('editor open', editor);

const drag = async (from, to, steps = 18) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await pause(30);
  }
  await page.mouse.up();
};
const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// Place: add pads one at a time.
for (let i = 0; i < 3; i++) {
  await page.getByRole('button', { name: /^Add pad$/ }).click();
  await pause(700);
}
await mark('placed three pads', editor);

// Move: drag the first pad to the upper left.
const sb = await stage.boundingBox();
const p1 = page.getByLabel(/^Pad p1:/);
const b1 = await p1.boundingBox();
if (b1 && sb) await drag(centre(b1), { x: sb.x + sb.width * 0.3, y: sb.y + sb.height * 0.35 });
await pause(600);
await mark('moved a pad', editor);

// Resize: drag its corner handle out.
const handle = page.getByLabel('Resize pad p1');
const hb = await handle.boundingBox();
if (hb) await drag(centre(hb), { x: centre(hb).x + sb.width * 0.08, y: centre(hb).y + sb.height * 0.08 });
await pause(600);
await mark('resized it', editor);

// Recolour and re-voice the selected pad.
await p1.click();
await pause(300);
const colour = editor.locator('input[type="color"]').first();
if (await colour.count()) await colour.fill('#22d3ee');
await pause(700);
const sound = editor.locator('select').first();
if (await sound.count()) await sound.selectOption({ index: 5 }).catch(() => {});
await pause(900);
await mark('recoloured it and changed its drum', editor);

// The starter kit, for the full picture.
await page.getByRole('button', { name: /^Starter kit$/ }).click();
await pause(1500);
await mark('the starter kit', editor);
await pause(800);

await context.close();
await browser.close();
const vid = readdirSync(out).find((f) => f.endsWith('.webm'));
if (vid) renameSync(join(out, vid), join(out, 'tour.webm'));
writeFileSync(join(out, 'marks.json'), JSON.stringify({ viewport: { width: W, height: H }, marks }, null, 1));
console.log(JSON.stringify(marks.map((m) => [m.label, m.t.toFixed(1), m.box && Math.round(m.box.width)])));
