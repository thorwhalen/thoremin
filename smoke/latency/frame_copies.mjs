#!/usr/bin/env node
/**
 * How many 2D copies of the camera frame the camera models make per camera frame, and
 * what they cost on the main thread (#495).
 *
 * On the CPU delegate a rescaled camera frame is drawn into a canvas before a model reads
 * it (#324, `src/nodes/sources/model_input.ts`). With the hand and body models both on, the
 * copy was made once per model. This runs the BUILT bundle in headless Chromium (where
 * `delegate: 'auto'` picks the CPU: the renderer is SwiftShader) with a fake camera playing
 * `--video` (give it a native size other than 1280x720, so the app's request is
 * crop-and-scaled and the copy is needed), turns on "Conduct with body" (hands and body),
 * and counts every `drawImage` of a `<video>` and the presented camera frames over a window.
 *
 *   npm run build
 *   ffmpeg -i clip.mp4 -t 4 -vf scale=1920:1080,fps=30 -pix_fmt yuv420p body1080.y4m
 *   node smoke/latency/frame_copies.mjs --video body1080.y4m --query hands.runner=main [--seconds 10] [--port 4394]
 *
 * `--query hands.runner=main` keeps the hand model on the main thread: in a worker it is
 * handed an `ImageBitmap` and makes no copy. "Conduct with body" and "Start conducting"
 * compose the body model; `running` in the output says both produced frames.
 *
 * The camera video is data: keep it outside the repo.
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const video = arg('video');
if (!video) throw new Error('--video FILE.y4m is required');
const seconds = Number(arg('seconds', '10'));
const port = Number(arg('port', '4394'));
const query = arg('query', '');

/** Counts every video drawImage and its time, and the presented frames of each video. */
function instrument() {
  const stats = { copies: 0, ms: 0 };
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) {
    if (!(image instanceof HTMLVideoElement)) return draw.call(this, image, ...rest);
    const t0 = performance.now();
    const out = draw.call(this, image, ...rest);
    // A readback forces the copy to finish here, as the model's read does.
    this.getImageData(0, 0, 1, 1);
    stats.ms += performance.now() - t0;
    stats.copies++;
    return out;
  };
  window.__frameCopies = stats;
}

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
try {
  await new Promise((r) => setTimeout(r, 4000));
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${resolve(video)}`],
  });
  const page = await browser.newPage();
  await page.addInitScript(instrument);
  await page.goto(`http://localhost:${port}/thoremin/instruments/${query ? '?' + query : ''}`);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 60_000 });
  await page.locator('[data-tools-bar] [data-tool="conductor"]').click();
  await page.getByRole('radio', { name: 'Conduct with body' }).click();
  await page.getByRole('button', { name: 'Start conducting' }).click();
  // Both models loaded and running: wait until copies flow, then a settling period.
  await page.waitForFunction(() => window.__frameCopies.copies > 30, null, { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const read = () =>
    page.evaluate(() => ({
      ...window.__frameCopies,
      frames: [...document.querySelectorAll('video')].map((v) => v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0).reduce((a, b) => Math.max(a, b), 0),
      renderer: (() => {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })(),
    }));
  const a = await read();
  await page.waitForTimeout(seconds * 1000);
  const b = await read();
  // Both models must be running, or the count says nothing about sharing.
  const running = await page.evaluate(() => ({
    hands: Number.isFinite(window.thoremin?.getOutput('cam', 'hands')?.t),
    body: Number.isFinite(window.thoremin?.getOutput('camBody', 'body')?.t),
  }));
  const copies = b.copies - a.copies;
  const frames = b.frames - a.frames;
  console.log(JSON.stringify({
    renderer: b.renderer,
    running,
    seconds,
    cameraFrames: frames,
    copies,
    copiesPerCameraFrame: +(copies / Math.max(1, frames)).toFixed(2),
    msPerCopy: +((b.ms - a.ms) / Math.max(1, copies)).toFixed(2),
    copyMsPerSecond: +((b.ms - a.ms) / seconds).toFixed(1),
  }));
  await browser.close();
} finally {
  server.kill();
}
