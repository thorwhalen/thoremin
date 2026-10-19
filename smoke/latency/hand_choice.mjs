#!/usr/bin/env node
/**
 * Which hand a one-hand instrument gets, and what it costs (#634, #480 item 3).
 *
 * Runs three MediaPipe hand landmarkers on the SAME camera frames in a real Chromium: one looking
 * for two hands (the reference: which hands are in view, and the cost before #325), one looking
 * for one (#325's saving, holding whichever hand it found first), and one looking for one under
 * a candidate hand governor (`./lib/hand_governor.ts`, bundled with esbuild), which looks for
 * two while the wrong hand is tracked (`--drop-when alone|present`, `--drop-after N` results). For each: the cost per frame, and how often the preferred
 * hand is in view (by the reference) but not the hand reported.
 *
 * The camera is Chromium's fake device playing a clip (`--video FILE.y4m`, kept under
 * `~/.local/share/thoremin/`, never in the repo). The preferred hand is a raw MediaPipe label;
 * run it once per side.
 *
 * Usage (from the repo root, after `npm run smoke:setup`):
 *
 *   node smoke/latency/hand_choice.mjs --video conduct720.y4m [--prefer Right] [--frames 450] [--delegate CPU] [--headed] [--out report.json]
 *
 * `--headed` matters for a GPU number: headless Chromium renders WebGL in software.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
/** Must match `src/nodes/sources/tasks_vision.ts` and the hand node's model path. */
const TASKS_VISION_VERSION = '0.10.35';
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function parseArgs(argv) {
  const a = { video: null, prefer: 'Right', frames: 450, delegate: 'CPU', headed: false, out: null, capture: '1280x720', dropWhen: 'alone', dropAfter: 15 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--video') a.video = resolve(argv[++i]);
    else if (k === '--prefer') a.prefer = argv[++i];
    else if (k === '--frames') a.frames = Number(argv[++i]);
    else if (k === '--delegate') a.delegate = argv[++i];
    else if (k === '--headed') a.headed = true;
    else if (k === '--out') a.out = resolve(argv[++i]);
    else if (k === '--capture') a.capture = argv[++i];
    else if (k === '--drop-when') a.dropWhen = argv[++i];
    else if (k === '--drop-after') a.dropAfter = Number(argv[++i]);
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.video) throw new Error('--video FILE.y4m is required (a clip with both hands in view)');
  if (a.prefer !== 'Left' && a.prefer !== 'Right') throw new Error('--prefer is Left or Right (a raw MediaPipe label)');
  return a;
}

/** The candidate governor, bundled for the page. */
function governorBundle() {
  const esbuild = resolve(ROOT, 'node_modules', '.bin', 'esbuild');
  return execFileSync(esbuild, [resolve(HERE, 'lib', 'hand_governor.ts'), '--bundle', '--format=iife', '--global-name=HandGovernor'], { encoding: 'utf8' });
}

const args = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({
  headless: !args.headed,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${args.video}`],
});
try {
  const page = await browser.newPage();
  // A localhost page (served by the route, no server): the camera needs a secure context.
  await page.route('http://localhost/hand-choice', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>hand choice</title>' }));
  await page.goto('http://localhost/hand-choice');
  await page.addScriptTag({ content: governorBundle() });
  const report = await page.evaluate(
    async ({ version, model, frames, delegate, prefer, capture, dropWhen, dropAfter }) => {
      const vision = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/vision_bundle.mjs`);
      const fileset = await vision.FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${version}/wasm`);
      const [width, height] = capture.split('x').map(Number);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: width }, height: { ideal: height } } });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      // One copy per frame, shared by the three (the CPU delegate is handed a 2D copy, as in the app).
      const copy = document.createElement('canvas');
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      const make = (numHands) => vision.HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate }, numHands, runningMode: 'VIDEO' });
      const two = await make(2);
      const one = await make(1);
      const governed = await make(1);
      const governor = globalThis.HandGovernor.createHandGovernor({ dropWhen, dropAfterResults: dropAfter });
      let governedCount = 1;
      const stats = () => ({ ms: [], wrong: 0, preferredInView: 0, labelChanges: 0, last: null });
      const s = { two: stats(), one: stats(), governed: stats() };
      let escalatedFrames = 0;
      let reconfigurations = 0;
      let lastTime = -1;
      let ts = 0;
      const labelsOf = (r) => r.handedness.map((h) => h[0]?.categoryName ?? '');
      const deadline = performance.now() + 10 * 60_000;
      let n = 0;
      while (n < frames && performance.now() < deadline) {
        await new Promise((r) => requestAnimationFrame(r));
        if (video.currentTime === lastTime) continue;
        lastTime = video.currentTime;
        ts = Math.max(ts + 1, Math.floor(performance.now()));
        if (copy.width !== video.videoWidth) copy.width = video.videoWidth;
        if (copy.height !== video.videoHeight) copy.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, copy.width, copy.height);
        const input = delegate === 'CPU' ? copy : video;
        const timed = (lm) => {
          const t0 = performance.now();
          const r = lm.detectForVideo(input, ts);
          return { r, ms: performance.now() - t0 };
        };
        const ref = timed(two);
        const solo = timed(one);
        // The governed landmarker follows the governor's count, as `webcam-hands` does: a change
        // costs its `setOptions` (counted in that frame's time).
        const want = governor.count(1);
        let extra = 0;
        if (want !== governedCount) {
          const t0 = performance.now();
          await governed.setOptions({ numHands: want });
          extra = performance.now() - t0;
          governedCount = want;
          reconfigurations++;
        }
        const gov = timed(governed);
        gov.ms += extra;
        governor.observe({ wanted: 1, prefer, labels: labelsOf(gov.r) });
        if (governedCount === 2) escalatedFrames++;
        const inView = labelsOf(ref.r).includes(prefer);
        for (const [k, x] of [['two', ref], ['one', solo], ['governed', gov]]) {
          const st = s[k];
          st.ms.push(x.ms);
          const labels = labelsOf(x.r);
          if (inView) {
            st.preferredInView++;
            if (!labels.includes(prefer)) st.wrong++;
          }
          const key = labels.slice().sort().join('+');
          if (st.last !== null && key !== st.last && labels.length === 1 && st.last.split('+').length === 1 && st.last !== '') st.labelChanges++;
          st.last = key;
        }
        n++;
      }
      stream.getTracks().forEach((t) => t.stop());
      const summary = (st) => {
        const ms = st.ms.slice(10).sort((a, b) => a - b);
        const q = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
        const mean = ms.reduce((a, b) => a + b, 0) / (ms.length || 1);
        return { frames: st.ms.length, msMean: +mean.toFixed(1), msP50: +q(0.5).toFixed(1), msP95: +q(0.95).toFixed(1), preferredInView: st.preferredInView, wrongHand: st.wrong, wrongRate: +(st.wrong / (st.preferredInView || 1)).toFixed(3), singleHandSwitches: st.labelChanges };
      };
      return { prefer, delegate, granted: `${video.videoWidth}x${video.videoHeight}`, two: summary(s.two), one: summary(s.one), governed: { ...summary(s.governed), escalatedFrames, reconfigurations } };
    },
    { version: TASKS_VISION_VERSION, model: HAND_MODEL, frames: args.frames, delegate: args.delegate, prefer: args.prefer, capture: args.capture, dropWhen: args.dropWhen, dropAfter: args.dropAfter },
  );
  const env = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, webglRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null };
  });
  const out = { measuredAt: new Date().toISOString(), options: { ...args, video: undefined }, env, ...report };
  const text = JSON.stringify(out, null, 2);
  if (args.out) writeFileSync(args.out, text);
  console.log(text);
} finally {
  await browser.close();
}
