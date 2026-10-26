/**
 * Print how far a drawn landmark trails its fingertip on a recorded sweep (#842).
 *
 *   vite-node scripts/overlay_offset.ts [fixture-dir] [--lag-ms 26] [--canvas-width 1280]
 *
 * The lag defaults to the measured camera-to-delivery 5.5 ms plus the hand model's 20.5 ms
 * (docs/research/latency-budget-and-browser-realtime.md). See `lib_overlay_offset.ts` for what
 * this is and is not.
 */
import { readFileSync } from 'node:fs';
import { speed, trailOffset, type TipSample } from './lib_overlay_offset';

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'test/fixtures/video_hand_sweep';
const lagMs = Number(arg('lag-ms', '26'));
const canvasWidth = Number(arg('canvas-width', '1280'));
const INDEX_TIP = 8;

const rows = readFileSync(`${dir}/src.hands.ndjson`, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { t: number; value: { width: number; height: number; hands: { keypoints: { x: number; y: number }[] }[] } });
const frameW = rows[0]!.value.width;
const samples: TipSample[] = rows.filter((r) => r.value.hands[0]).map((r) => ({ t: r.t, x: r.value.hands[0]!.keypoints[INDEX_TIP]!.x, y: r.value.hands[0]!.keypoints[INDEX_TIP]!.y }));
const scale = canvasWidth / frameW; // the frame fitted to a canvas of this width

const fmt = (s: { p50: number; p95: number; max: number }) => `p50 ${s.p50.toFixed(1)}  p95 ${s.p95.toFixed(1)}  max ${s.max.toFixed(1)}`;
console.log(`${dir}: ${samples.length} frames of the index tip, frame ${frameW}px wide, shown on a ${canvasWidth}px canvas`);
console.log(`tip speed (canvas px/s):   ${fmt(speed(samples.map((s) => ({ ...s, x: s.x * scale, y: s.y * scale }))))}`);
console.log(`live trail at ${lagMs} ms lag (canvas px): ${fmt(trailOffset(samples, lagMs / 1000, scale))}`);
console.log(`held-frame offset (canvas px): 0 by construction; the video then shows ${lagMs} ms late`);
