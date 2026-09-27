/**
 * Render a take's events to a WAV through the shipped WebAudio sinks (see
 * `offline_audio/main.ts`), in headless Chromium against the Vite dev server.
 *
 * Playwright is resolved from `smoke/node_modules` (run `npm ci` in `smoke/` first).
 *
 * Usage:
 *   npx vite --port 4392 --strictPort &
 *   node scripts/demos/render_take_audio.mjs <take.json> <out.wav> [--url http://localhost:4392/thoremin] [--tail 1.5]
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'smoke', 'package.json'));
const { chromium } = require('@playwright/test');

const [takePath, out] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
if (!takePath || !out) throw new Error('usage: render_take_audio.mjs <take.json> <out.wav>');
const base = arg('url', 'http://localhost:4392/thoremin'); // vite.config.ts serves under its `base`
const tail = Number(arg('tail', '1.5'));

const take = JSON.parse(readFileSync(takePath, 'utf8'));
const duration = take.frames.length / take.fps + tail;
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page]', e.message));
await page.goto(`${base}/scripts/demos/offline_audio/index.html`);
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 60_000 });
const { sampleRate, pcm16 } = await page.evaluate((t) => window.renderTake(t), { instrument: take.instrument, events: take.events, duration });
await browser.close();

const pcm = Buffer.from(pcm16, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(sampleRate * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`${take.instrument}: ${take.events.length} events, ${duration.toFixed(1)} s -> ${out}`);
