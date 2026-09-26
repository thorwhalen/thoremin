/**
 * The hits the shipped `air-drum` node (#233) plays over one `an.impacts` clip, for
 * the demo page.
 *
 * The clip's impact keypoint stands in for the player's right wrist (as in
 * `test/subframe/air_drum_node.test.ts`), one hands frame per camera frame, and the
 * node is ticked by hand so three things a live session has can be simulated:
 *
 * - `--latency S`: the pipeline delay from capture to tick (inference, scheduling).
 *   Each frame carries its capture stamp and the node sees it `S` seconds later, so
 *   the node's lead is counted from its decision, exactly as live (#226). With a
 *   delay the node can no longer commit every stroke far enough ahead, and those
 *   strokes become ghost notes, sounded late on confirmation.
 * - `--magnetism M`: the pull toward the beat. The node's `time` input is a beat
 *   follower's `MusicalTime`; here the follower is the trend prior listening to the
 *   drum's own hits (in the app, the conductor provides it).
 * - `--min-lead S`: the node's dial (default the dial's 50 ms).
 *
 * Writes JSON in the `impact_onsets.ts` shape, `onsets[<name>]` = the hits
 * `{t, at, predicted, velocity, pull}`, and prints how many were predicted and their
 * errors against the true impacts and the intended beats.
 *
 * Usage:
 *   npx vite-node scripts/demos/air_drum_hits.ts <clip-dir> <out.json> \
 *     [--name drum] [--latency 0] [--magnetism 0] [--min-lead 0.05] [--merge]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeContext } from '@/dag';
import { createTrendPrior, type Anchor } from '@/ictus';
import { airDrumNode, type DrumHit, type HandsFrame } from '@/nodes';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const [clipDir, out] = process.argv.slice(2);
if (!clipDir || !out) throw new Error('usage: air_drum_hits.ts <clip-dir> <out.json>');
const name = arg('name', 'drum');
const latency = Number(arg('latency', '0'));
const magnetism = Number(arg('magnetism', '0'));
const minLead = Number(arg('min-lead', '0.05'));

interface Truth {
  spec: { fps: number; kind: string; object: string };
  objects: { name: string; impact_keypoint: string }[];
  events: { index: number; t_impact: number; t_grid: number }[];
}
const truth = JSON.parse(readFileSync(join(clipDir, 'truth.json'), 'utf8')) as Truth;
const obj = truth.objects[0];
const fps = truth.spec.fps;

// One hands frame per camera frame, stamped with its capture time.
const frames: HandsFrame[] = [];
for (const line of readFileSync(join(clipDir, 'keypoints.ndjson'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line) as { t: number; value: { width: number; height: number; keypoints: { object: string; name: string; x: number; y: number }[] } };
  const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint)!;
  const keypoints = Array.from({ length: 21 }, () => ({ x: p.x, y: p.y }));
  frames.push({
    width: rec.value.width,
    height: rec.value.height,
    // The mirrored webcam labels the player's RIGHT hand 'Left'.
    hands: [{ handedness: 'Left', keypoints }],
    t: rec.t,
    tSource: 'rvfc',
    tOrigin: performance.timeOrigin,
  } as HandsFrame);
}

const handlers = airDrumNode.make(airDrumNode.params.parse({ enabled: true, minLead, magnetism }));
const resources = { timeScale: 1 };
const follower = createTrendPrior({ memory: 12, quadraticAfter: 5 });
const hits: (DrumHit & { at: number })[] = [];
// The follower hears a hit once it has sounded (never the future).
const pending: DrumHit[] = [];
for (let i = 0; i < frames.length; i++) {
  const now = frames[i].t! + latency;
  follower.advance(now);
  while (pending.length && pending[0].t <= now) {
    const h = pending.shift()!;
    const anchor: Anchor = { t: h.t, confidence: 1, strength: h.velocity, sharpness: NaN, lateral: 0 };
    follower.update(anchor);
  }
  const ctx: NodeContext = { tick: i, time: now, dt: i === 0 ? 0 : 1 / fps, resources, log: undefined as never };
  const outs = handlers.process({ hands: frames[i], time: follower.state() }, ctx) ?? {};
  for (const h of (outs.hits as DrumHit[] | undefined) ?? []) {
    hits.push({ ...h, at: now });
    pending.push(h);
    pending.sort((a, b) => a.t - b.t);
  }
}
handlers.dispose?.();

const doc = existsSync(out) && process.argv.includes('--merge') ? JSON.parse(readFileSync(out, 'utf8')) : { clip: clipDir.split('/').filter(Boolean).pop(), fps, kind: truth.spec.kind, events: truth.events, onsets: {}, settings: {} };
doc.onsets[name] = hits.map((h) => ({ t: h.t, at: h.at, predicted: h.predicted, velocity: h.velocity, pull: h.pull }));
doc.settings[name] = { latency, magnetism, minLead };
writeFileSync(out, JSON.stringify(doc, null, 1));

const ms = (x: number) => (1000 * x).toFixed(1);
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const nearest = (t: number) => truth.events.reduce((b, e) => (Math.abs(e.t_impact - t) < Math.abs(b.t_impact - t) ? e : b));
const errI = hits.map((h) => h.t - nearest(h.t).t_impact);
const errG = hits.map((h) => h.t - nearest(h.t).t_grid);
console.log(
  `${name}: ${hits.length}/${truth.events.length} hits, ${hits.filter((h) => h.predicted).length} predicted, ${hits.filter((h) => !h.predicted).length} ghost | vs impact mean ${ms(mean(errI))} MAE ${ms(mean(errI.map(Math.abs)))} | vs beat MAE ${ms(mean(errG.map(Math.abs)))} | mean |pull| ${ms(mean(hits.map((h) => Math.abs(h.pull))))}`,
);
