#!/usr/bin/env node
/**
 * How short is the capture-lag shift of a `clock` stamp on the animation-frame path (#545)?
 *
 * The frame pump learns `captureLag` as (delivery - captureTime) from frames the video frame
 * callback delivers, then moves a `clock` stamp (taken when the animation loop NOTICES a new
 * frame) back by that lag. The animation loop notices a frame up to one display period after
 * the callback would have, so the shift is short by the extra wait. Here both are timed over
 * the same frames in a real Chromium on its fake camera: per frame, the callback's
 * (now - captureTime) and the animation loop's (now - captureTime), where "now" is the first
 * animation frame whose `currentTime` shows the frame.
 *
 * Usage (repo root, after `npm run smoke:setup`): node smoke/latency/clock_stamp_shortfall.mjs [--seconds 10] [--fps 30] [--out file.json]
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const seconds = Number(arg('seconds', 10));
const fps = Number(arg('fps', 30));
const out = arg('out', '');

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
// getUserMedia needs a secure context; localhost is one, and the route serves an empty page.
await page.route('http://localhost:9/', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
await page.goto('http://localhost:9/');
const result = await page.evaluate(
  async ({ seconds, fps }) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: fps } });
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = stream;
    document.body.appendChild(v);
    await v.play();
    const meta = new Map(); // mediaTime -> { cb: now - captureTime (ms), capture }
    const rows = [];
    let seen = -1;
    let raf = [];
    const onVfc = (now, m) => {
      if (typeof m.captureTime === 'number') meta.set(m.mediaTime, { cb: now - m.captureTime, capture: m.captureTime });
      v.requestVideoFrameCallback(onVfc);
    };
    v.requestVideoFrameCallback(onVfc);
    const frameMs = [];
    const tick = () => {
      const now = performance.now();
      raf.push(now);
      if (v.currentTime !== seen) {
        seen = v.currentTime;
        rows.push({ t: now, mediaTime: v.currentTime });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    stream.getTracks().forEach((t) => t.stop());
    // Join: the callback's metadata for the frame the animation loop saw (nearest mediaTime).
    const keys = [...meta.keys()];
    const pairs = [];
    for (const r of rows) {
      let best = null;
      for (const k of keys) if (best === null || Math.abs(k - r.mediaTime) < Math.abs(best - r.mediaTime)) best = k;
      if (best === null || Math.abs(best - r.mediaTime) > 0.004) continue;
      const m = meta.get(best);
      pairs.push({ cb: m.cb, rafLag: r.t - m.capture });
    }
    const dt = raf.slice(1).map((t, i) => t - raf[i]);
    return { pairs, displayMs: dt.reduce((a, b) => a + b, 0) / dt.length, frames: rows.length };
  },
  { seconds, fps },
);
await browser.close();

const stat = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: xs.length, mean: +mean.toFixed(2), p05: +q(0.05).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2) };
};
const extra = result.pairs.map((p) => p.rafLag - p.cb);
const report = {
  displayPeriodMs: +result.displayMs.toFixed(2),
  callbackLagMs: stat(result.pairs.map((p) => p.cb)),
  animationLagMs: stat(result.pairs.map((p) => p.rafLag)),
  shortfallMs: stat(extra),
};
console.log(JSON.stringify(report, null, 1));
if (out) writeFileSync(out, JSON.stringify(report, null, 1));
