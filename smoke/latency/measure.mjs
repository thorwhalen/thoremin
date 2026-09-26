#!/usr/bin/env node
/**
 * Measure thoremin's event-to-sound latency budget in a real Chromium (#227).
 *
 * The in-app probe (`?probe=latency`, `src/app/latencyProbe.ts`) times each stage of
 * the running instrument; this script drives it without a person, and adds the
 * measurements a page can make offline, so the budget in
 * `docs/research/latency-budget-and-browser-realtime.md` is re-derivable by one
 * command. Four parts:
 *
 * 1. `app`       — the BUILT bundle under `?probe=latency`, tapped to play, left to
 *                  run; the probe's report is collected. With `--video FILE.y4m` the
 *                  camera is Chromium's fake device playing that file (so MediaPipe
 *                  sees real hands and the inference cost is real); without it the
 *                  source is `synthetic-hands` (no camera, no model).
 * 2. `inference` — the same MediaPipe hand model the app loads, timed per frame on
 *                  the GPU (WebGL) delegate and on the CPU (WebAssembly + SIMD)
 *                  delegate, over the same camera. This is the "would WASM help?"
 *                  measurement: the CPU delegate IS the WebAssembly path.
 * 3. `audio`     — what each `latencyHint` buys on this machine (`baseLatency`,
 *                  `outputLatency`), and, offline, the look-ahead of a
 *                  DynamicsCompressor configured like the synth's output bus and the
 *                  step response of the synth's 30 ms `setTargetAtTime` glide.
 * 4. `env`       — browser, GPU renderer, display refresh.
 *
 * The camera video is data, not code: keep it under `~/.local/share/thoremin/`,
 * never in the repo. Make one from any clip with hands in it:
 *
 *   ffmpeg -ss 20 -t 6 -i clip.mp4 -vf scale=1280:720,fps=30 -pix_fmt yuv420p hands.y4m
 *
 * Usage (from the repo root, after `npm run build` and `npm run smoke:setup`):
 *
 *   node smoke/latency/measure.mjs [--video hands.y4m] [--seconds 20] [--headed] [--audible] [--out report.json]
 *
 * The instrument is muted during the run unless `--audible` is given.
 *
 * `--headed` matters on a laptop: headless Chromium may render WebGL in software
 * and has no real audio device, so its inference and audio numbers are not the
 * machine's. The report says which renderer and audio device it got.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BASE_PATH = '/thoremin/';
/** Must match `src/nodes/sources/tasks_vision.ts` and the hand node's model path. */
const TASKS_VISION_VERSION = '0.10.35';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
/** Must match the synth's output bus (`ensureBus` in `src/nodes/output/webaudio_synth.ts`). */
const SYNTH_COMPRESSOR = { threshold: -14, knee: 24, ratio: 3, attack: 0.005, release: 0.2 };
const SYNTH_FREQ_GLIDE_S = 0.03;

function parseArgs(argv) {
  const a = { video: null, seconds: 20, warmup: 4, headed: false, audible: false, out: null, port: 4174, frames: 150 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--video') a.video = resolve(argv[++i]);
    else if (k === '--seconds') a.seconds = Number(argv[++i]);
    else if (k === '--warmup') a.warmup = Number(argv[++i]);
    else if (k === '--frames') a.frames = Number(argv[++i]);
    else if (k === '--headed') a.headed = true;
    else if (k === '--audible') a.audible = true;
    else if (k === '--out') a.out = resolve(argv[++i]);
    else if (k === '--port') a.port = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

async function startPreview(port) {
  // vite itself, not through npx: killing an npx wrapper can leave the server running
  // and the next run failing on --strictPort.
  const vite = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://localhost:${port}${BASE_PATH}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return { proc, url };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview did not come up on ${url} (did you run npm run build?)`);
}

async function measureApp(page, url, args) {
  const query = args.video ? '?probe=latency' : '?probe=latency&slot.source=synthetic-hands';
  await page.goto(url + query);
  await page.getByRole('button', { name: /tap to play/i }).click({ timeout: 90_000 });
  await page.waitForFunction(() => window.thoreminLatency && window.thoremin?.audio().state === 'running', null, { timeout: 30_000 });
  // Mute (the `m` shortcut) unless asked not to: it ramps the host master gain to 0 and
  // changes nothing the probe measures (scheduling, output timestamps, the tick).
  if (!args.audible) await page.keyboard.press('m');
  await page.waitForTimeout(args.warmup * 1000);
  await page.evaluate(() => window.thoreminLatency.reset());
  await page.waitForTimeout(args.seconds * 1000);
  return page.evaluate(() => window.thoreminLatency.report());
}

async function measureInference(page, frames) {
  return page.evaluate(
    async ({ version, model, frames }) => {
      const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      const out = {};
      for (const delegate of ['GPU', 'CPU']) {
        let lm;
        try {
          lm = await vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate }, numHands: 2, runningMode: 'VIDEO' });
        } catch (e) {
          out[delegate] = { error: String(e) };
          continue;
        }
        const ms = [];
        let withHands = 0;
        let lastTime = -1;
        let ts = 0;
        const deadline = performance.now() + 60_000;
        while (ms.length < frames && performance.now() < deadline) {
          await new Promise((r) => requestAnimationFrame(r));
          if (video.currentTime === lastTime) continue;
          lastTime = video.currentTime;
          ts = Math.max(ts + 1, Math.floor(performance.now()));
          const t0 = performance.now();
          const res = lm.detectForVideo(video, ts);
          ms.push(performance.now() - t0);
          if (res.landmarks.length) withHands++;
        }
        lm.close();
        out[delegate] = { samples: ms.slice(10), withHands, frames: ms.length };
      }
      stream.getTracks().forEach((t) => t.stop());
      return out;
    },
    { version: TASKS_VISION_VERSION, model: HAND_MODEL, frames },
  );
}

async function measureAudio(page) {
  return page.evaluate(
    async ({ comp, glide }) => {
      const hints = {};
      for (const hint of ['interactive', 'balanced', 'playback', 0]) {
        const ac = new AudioContext({ latencyHint: hint });
        await ac.resume();
        await new Promise((r) => setTimeout(r, 300));
        hints[String(hint)] = { baseLatencyMs: ac.baseLatency * 1000, outputLatencyMs: (ac.outputLatency ?? NaN) * 1000, sampleRate: ac.sampleRate };
        await ac.close();
      }
      // The synth bus compressor's look-ahead: an impulse through it, offline.
      const sr = 48000;
      const off = new OfflineAudioContext(1, sr / 10, sr);
      const buf = off.createBuffer(1, sr / 10, sr);
      buf.getChannelData(0)[480] = 0.5; // 10 ms in, well below threshold
      const src = off.createBufferSource();
      src.buffer = buf;
      const c = off.createDynamicsCompressor();
      c.threshold.value = comp.threshold;
      c.knee.value = comp.knee;
      c.ratio.value = comp.ratio;
      c.attack.value = comp.attack;
      c.release.value = comp.release;
      src.connect(c).connect(off.destination);
      src.start();
      const rendered = (await off.startRendering()).getChannelData(0);
      let peak = 0;
      for (let i = 1; i < rendered.length; i++) if (Math.abs(rendered[i]) > Math.abs(rendered[peak])) peak = i;
      const compressorDelayMs = ((peak - 480) / sr) * 1000;
      // The glide: a 0 -> 1 step through setTargetAtTime with the synth's constant.
      const off2 = new OfflineAudioContext(1, sr / 2, sr);
      const cs = off2.createConstantSource();
      cs.offset.value = 0;
      cs.offset.setTargetAtTime(1, 0, glide);
      cs.connect(off2.destination);
      cs.start();
      const step = (await off2.startRendering()).getChannelData(0);
      const reach = (f) => (step.findIndex((x) => x >= f) / sr) * 1000;
      return {
        hints,
        renderQuantumMs: (128 / sr) * 1000,
        compressorDelayMs,
        glide: { timeConstantMs: glide * 1000, to50pctMs: reach(0.5), to90pctMs: reach(0.9), to95pctMs: reach(0.95) },
      };
    },
    { comp: SYNTH_COMPRESSOR, glide: SYNTH_FREQ_GLIDE_S },
  );
}

async function measureEnv(page) {
  return page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null;
    const t = [];
    await new Promise((done) => {
      const step = (now) => {
        t.push(now);
        if (t.length < 121) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
    return { userAgent: navigator.userAgent, webglRenderer: renderer, rafMedianMs: d[d.length >> 1], crossOriginIsolated };
  });
}

function summarize(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { n: 0 };
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const q = (p) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
  return { n: s.length, mean, sd: Math.sqrt(s.reduce((a, x) => a + (x - mean) ** 2, 0) / s.length), p50: q(0.5), p95: q(0.95) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { proc, url } = await startPreview(args.port);
  const launchArgs = ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (args.video) launchArgs.push(`--use-file-for-fake-video-capture=${args.video}`);
  let browser;
  try {
    browser = await chromium.launch({ headless: !args.headed, args: launchArgs });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    // No local paths in the report: it is meant to be shareable.
    const report = { measuredAt: new Date().toISOString(), options: { ...args, video: args.video ? '(local file)' : null, out: args.out ? '(local file)' : null } };
    report.app = await measureApp(page, url, args);
    await page.goto(url + 'manual.html'); // a light static page on the same origin
    report.env = await measureEnv(page);
    report.audio = await measureAudio(page);
    if (args.video) {
      const inf = await measureInference(page, args.frames);
      report.inference = Object.fromEntries(
        Object.entries(inf).map(([k, v]) => [k, v.samples ? { ...summarize(v.samples), withHands: v.withHands, frames: v.frames } : v]),
      );
    }
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
