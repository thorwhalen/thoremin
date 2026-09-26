/**
 * Record a short tour of the live instrument as it builds today, with its sound.
 *
 * Drives the built bundle (served by `vite preview`) in headless Chromium with the
 * camera-free `synthetic-hands` source, and records two things at once: the page as a
 * video (Playwright's recorder, no sound) and the page's own audio (every node that
 * connects to the AudioContext's destination is also tapped into a MediaRecorder, so
 * what is recorded is exactly what the instrument plays). The two are muxed with
 * ffmpeg, aligned on the wall-clock time the audio recorder started.
 *
 * Playwright is not an app dependency; it is resolved from `smoke/node_modules`
 * (run `npm ci` in `smoke/` first).
 *
 * Usage:
 *   npx vite preview --port 4391 --strictPort &
 *   node scripts/demos/tour_live.mjs --url http://localhost:4391/thoremin/ --out DIR [--screens-only]
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'smoke', 'package.json'));
const { chromium } = require('@playwright/test');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const url = arg('url', 'http://localhost:4391/thoremin/');
const out = arg('out', 'tour');
const query = arg('query', '?slot.source=synthetic-hands');
const screensOnly = process.argv.includes('--screens-only');
const W = 1280;
const H = 800;
mkdirSync(out, { recursive: true });

/** Injected before any page script: tap every destination-bound node into a recorder. */
function tapAudio() {
  const Ctx = window.AudioContext;
  const taps = new WeakMap();
  const origConnect = AudioNode.prototype.connect;
  window.__demoAudio = { chunks: [], started: null, recorder: null };
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = origConnect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode) {
      const ctx = this.context;
      let tap = taps.get(ctx);
      if (!tap) {
        tap = ctx.createMediaStreamDestination();
        taps.set(ctx, tap);
        const rec = new MediaRecorder(tap.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
        rec.ondataavailable = (e) => e.data.size && window.__demoAudio.chunks.push(e.data);
        rec.start(250);
        window.__demoAudio.started = Date.now();
        window.__demoAudio.recorder = rec;
      }
      origConnect.call(this, tap);
    }
    return result;
  };
  void Ctx;
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  ...(screensOnly ? {} : { recordVideo: { dir: out, size: { width: W, height: H } } }),
});
await context.addInitScript(tapAudio);
const page = await context.newPage();
const videoStart = Date.now();
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const beats = [];
const mark = (label) => beats.push({ label, t: (Date.now() - videoStart) / 1000 });

await page.goto(url + query);
await page.getByRole('button', { name: /tap to play/i }).waitFor({ timeout: 60_000 });
mark('ready');
await page.waitForTimeout(1200);
await shot('01-ready');
await page.getByRole('button', { name: /tap to play/i }).click();
mark('live');
await page.waitForTimeout(6000);
await shot('02-live');

// The tour: a list of [chapter, action, seconds to dwell]. Each chapter is marked on
// the timeline (beats.json) so the page can caption it.
const button = (name) => page.getByRole('button', { name, exact: true }).first();
const steps = [
  ['Pentatonic, the default instrument: the synthetic right hand sweeps across the pitch lanes', async () => {}, 4000],
  ['Load "Glass Bells" from the instrument library', async () => page.getByText('Glass Bells', { exact: true }).first().click(), 5000],
  ['Close the library: the full stage, hand skeleton over the note lanes', async () => button('Close').click(), 6000],
  ['The command palette (Cmd-K): every control is a command you can also type', async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await page.waitForTimeout(700);
    await page.keyboard.type('instrument', { delay: 70 });
  }, 3500],
  ['Back to playing', async () => page.keyboard.press('Escape'), 4000],
  ['Open the Feature Lab: the live feature vector the mappings read', async () => button('Feature Lab').click(), 6000],
];
for (const [i, [label, act, dwell]] of steps.entries()) {
  try {
    await act();
  } catch (e) {
    console.error(`step ${i} failed: ${e.message}`);
  }
  mark(label);
  await page.waitForTimeout(dwell);
  await shot(`03-${i}`);
}
mark('end');

let audioStart = null;
if (!screensOnly) {
  const b64 = await page.evaluate(async () => {
    const a = window.__demoAudio;
    if (!a.recorder) return null;
    await new Promise((r) => {
      a.recorder.onstop = r;
      a.recorder.stop();
    });
    const blob = new Blob(a.chunks, { type: 'audio/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  audioStart = await page.evaluate(() => window.__demoAudio.started);
  if (b64) writeFileSync(join(out, 'audio.webm'), Buffer.from(b64, 'base64'));
}
await context.close();
await browser.close();
writeFileSync(join(out, 'beats.json'), JSON.stringify({ beats, audioOffset: audioStart ? (audioStart - videoStart) / 1000 : null }, null, 1));

if (!screensOnly) {
  const vid = readdirSync(out).find((f) => f.endsWith('.webm') && f !== 'audio.webm');
  renameSync(join(out, vid), join(out, 'screen.webm'));
  const offset = Math.max(0, (audioStart - videoStart) / 1000);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', join(out, 'screen.webm'),
    '-itsoffset', String(offset), '-i', join(out, 'audio.webm'),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-vf', 'scale=960:-2',
    '-c:a', 'aac', '-b:a', '160k',
    join(out, 'tour.mp4'),
  ]);
}
console.log(JSON.stringify(beats));
