#!/usr/bin/env node
/**
 * The held-frame backdrop in a real browser (#850): is the bitmap for a hand result present in
 * time, and how many camera frames late does the held backdrop show against the live video?
 *
 * Chromium's fake camera plays a clip with a FRAME-INDEX BARCODE burned into its top-left corner
 * (16 bits of luma, made here with ffmpeg; the clip and the barcoded copy stay out of the repo).
 * The page records, for every backdrop the overlay draws, the index read from the very image drawn
 * (the held `ImageBitmap` or the live `<video>`) and the index of the live video at that moment.
 * Their difference is how many camera frames the picture lags the live one. `frameHold.stats()`
 * (`window.thoremin.holdStats()`) says how often the hand result's own frame was found.
 *
 * What this shows: that the held bitmap exists when the overlay wants it (the hit rate), that it
 * is a real camera frame (indices rise, no repeats beyond the lag), and the cost in frames, for
 * the main-thread and the worker runner. What it does NOT show: that the landmarks were inferred
 * on that very frame (the `accepted` callback and the stamp key make that so by construction, and
 * `test/frame_hold.test.ts` proves the key match), or anything a real sensor adds (#146).
 *
 *   npm run build && node smoke/latency/held_frame.mjs [--video hands.y4m] [--seconds 12] [--runners main,worker] [--out report.json]
 *
 * `--video` defaults to ~/.local/share/thoremin/latency/hands_720p30.y4m (see measure.mjs for
 * how to make one). Needs ffmpeg and the smoke harness's Playwright (`npm run smoke:setup`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASE_PATH = '/thoremin/';
/** The barcode: this many bits, each a square of BIT_PX luma pixels, in the top-left corner. */
const BITS = 16;
const BIT_PX = 16;

function parseArgs(argv) {
  const a = { video: join(homedir(), '.local/share/thoremin/latency/hands_720p30.y4m'), seconds: 12, runners: ['main', 'worker'], out: null, port: 4175, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--video') a.video = resolve(argv[++i]);
    else if (k === '--seconds') a.seconds = Number(argv[++i]);
    else if (k === '--runners') a.runners = argv[++i].split(',').map((x) => x.trim());
    else if (k === '--out') a.out = resolve(argv[++i]);
    else if (k === '--port') a.port = Number(argv[++i]);
    else if (k === '--headed') a.headed = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** The clip with its frame index burned in, and how many frames it has (the camera loops it). */
function burnBarcode(video) {
  const frames = Number(spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout.trim());
  if (!Number.isFinite(frames) || frames < 2) throw new Error(`ffprobe could not count the frames of ${video}`);
  const out = join(mkdtempSync(join(tmpdir(), 'held-frame-')), 'barcoded.y4m');
  const geq = `lum='if(lt(Y,${BIT_PX})*lt(X,${BITS * BIT_PX}),255*bitand(floor(N/pow(2,floor(X/${BIT_PX}))),1),lum(X,Y))':cb='cb(X,Y)':cr='cr(X,Y)'`;
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', video, '-vf', `geq=${geq}`, '-pix_fmt', 'yuv420p', out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return { path: out, frames };
}

async function startPreview(port) {
  const vite = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://localhost:${port}${BASE_PATH}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { proc, url };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview did not come up on ${url} (did you run npm run build?)`);
}

/** In the page: wrap drawImage to read the barcode of every full-size backdrop the overlay draws. */
const INIT = ({ bits, bitPx }) => {
  const scratch = document.createElement('canvas');
  scratch.width = bits * bitPx;
  scratch.height = bitPx;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  const native = CanvasRenderingContext2D.prototype.drawImage;
  const decode = (src) => {
    try {
      native.call(sg, src, 0, 0, bits * bitPx, bitPx, 0, 0, bits * bitPx, bitPx);
      const px = sg.getImageData(0, 0, bits * bitPx, bitPx).data;
      let n = 0;
      for (let i = 0; i < bits; i++) if (px[((bitPx >> 1) * bits * bitPx + i * bitPx + (bitPx >> 1)) * 4] > 128) n |= 1 << i;
      return n;
    } catch {
      return -1;
    }
  };
  const draws = [];
  window.__heldDraws = draws;
  let inside = false;
  CanvasRenderingContext2D.prototype.drawImage = function (src, ...rest) {
    if (!inside && this.canvas.width >= 640 && (src instanceof ImageBitmap || src instanceof HTMLVideoElement) && rest.length === 4) {
      inside = true;
      const video = document.querySelector('video');
      draws.push({ kind: src instanceof ImageBitmap ? 'bitmap' : 'video', idx: decode(src), live: video && video.readyState >= 2 ? decode(video) : -1, t: performance.now() });
      inside = false;
    }
    return native.call(this, src, ...rest);
  };
};

const q = (xs, p) => xs[Math.min(xs.length - 1, Math.round(p * (xs.length - 1)))];

async function run(browser, url, runner, hold, args, frames) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.addInitScript(INIT, { bits: BITS, bitPx: BIT_PX });
  await page.goto(`${url}?hands.runner=${runner}${hold ? '&overlay.hold=hands' : ''}`);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 90_000 });
  await page.waitForFunction(() => window.thoremin?.audio().state === 'running', null, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => (window.__heldDraws.length = 0));
  await page.waitForTimeout(args.seconds * 1000);
  const { draws, stats } = await page.evaluate(() => ({ draws: window.__heldDraws.slice(), stats: window.thoremin.holdStats() }));
  await context.close();
  const kinds = {};
  for (const d of draws) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1;
  // Frames the drawn picture lags the live video (the camera loops the clip, so modulo its length).
  const lag = draws.filter((d) => d.idx >= 0 && d.live >= 0).map((d) => (((d.live - d.idx) % frames) + frames) % frames).sort((a, b) => a - b);
  const monotone = draws.filter((d) => d.idx >= 0).every((d, i, a) => i === 0 || (((d.idx - a[i - 1].idx) % frames) + frames) % frames < frames / 2);
  return { runner, hold, draws: draws.length, kinds, undecoded: draws.filter((d) => d.idx < 0).length, lagFrames: lag.length ? { p50: q(lag, 0.5), p95: q(lag, 0.95), max: lag[lag.length - 1] } : null, indicesNeverGoBack: monotone, holdStats: stats };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { path, frames } = burnBarcode(args.video);
  const { proc, url } = await startPreview(args.port);
  const launchArgs = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path}`];
  let browser;
  try {
    browser = await chromium.launch({ headless: !args.headed, args: launchArgs });
    const results = [];
    for (const runner of args.runners) for (const hold of [false, true]) results.push(await run(browser, url, runner, hold, args, frames));
    const report = { measuredAt: new Date().toISOString(), clipFrames: frames, seconds: args.seconds, results };
    const json = JSON.stringify(report, null, 2);
    if (args.out) writeFileSync(args.out, json);
    console.log(json);
  } finally {
    await browser?.close();
    proc.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
