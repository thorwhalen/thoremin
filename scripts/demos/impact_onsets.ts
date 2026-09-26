/**
 * The onsets three timing strategies would SOUND for one `an.impacts` clip, for the
 * demo page's "hear the difference" videos.
 *
 * The same estimators the benchmark scores (`scripts/subframe/score.ts`), run on the
 * clip's keypoint stream, but reduced to the one thing a listener hears: when each
 * stroke sounds. The rule is the same for all three — a stroke sounds at its estimate
 * but never before the estimator knows it (`max(t, at)`), with no output latency added
 * (real output latency delays all three equally; it is not what differs here):
 *
 * - `frameSnapped` — the frame-snapped baseline (`lowest` in the doc: the ictus
 *   detector with no refinement and no median). It learns of a stroke from the frame
 *   AFTER the lowest one, so it sounds about a frame late.
 * - `predicted`    — the impact predictor (`predict`, floor learned): the stroke is
 *   committed before contact and sounds at the predicted time. Strokes it did not
 *   predict (the first, before a floor exists) sound at their confirmation.
 * - `magnet`       — the prediction pulled halfway (magnetism 0.5) toward the trend
 *   prior's beat grid (`magnet0.5:trend12q`): closer to the intended beat, further from
 *   the executed contact.
 *
 * Writes JSON `{clip, fps, events: [{t_impact, t_grid, ...}], onsets: {name: [{t, at}]}}`.
 *
 * Usage: npx vite-node scripts/demos/impact_onsets.ts <clip-dir> <out.json> [--min-lead 0.03] [--magnetism 0.5]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIctusDetector, type Anchor, type Sample } from '@/ictus';
import { createImpactPredictor } from '@/ictus/impact';
import { magnetise } from '@/ictus/magnet';
import { createTrendPrior } from '@/ictus/trend_prior';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const [clipDir, out] = process.argv.slice(2);
if (!clipDir || !out) throw new Error('usage: impact_onsets.ts <clip-dir> <out.json>');
const minLead = Number(arg('min-lead', '0.03'));
const magnetism = Number(arg('magnetism', '0.5'));

interface Truth {
  spec: { fps: number; kind: string; object: string };
  objects: { name: string; impact_keypoint: string }[];
  events: { index: number; t_grid: number; t_impact: number; frames: { lowest_t_reported?: number; lowest_error: number } }[];
}
const truth = JSON.parse(readFileSync(join(clipDir, 'truth.json'), 'utf8')) as Truth;
const obj = truth.objects[0];
const samples: Sample[] = [];
for (const line of readFileSync(join(clipDir, 'keypoints.ndjson'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const rec = JSON.parse(line) as { t: number; value: { keypoints: { object: string; name: string; x: number; y: number }[] } };
  const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint);
  if (p) samples.push({ t: rec.t, x: p.x, y: p.y });
}

type Onset = { t: number; at: number };
const sound = (t: number, at: number): Onset => ({ t: Math.max(t, at), at });

// The frame-snapped baseline, configured as the benchmark's `lowest`.
const det = createIctusDetector({ initialPeriod: 0.5, refine: false, medianFilter: false });
const frameSnapped: Onset[] = [];
for (const s of samples) {
  const a = det.push(s);
  if (a) frameSnapped.push(sound(a.t, s.t));
}

// The predictor with a learned floor, and the magnet toward the trend prior.
const pred = createImpactPredictor({ minAmplitude: 12, minLead });
const prior = createTrendPrior({ memory: 12, quadraticAfter: 5 });
const predicted: Onset[] = [];
const magnet: Onset[] = [];
for (const s of samples) {
  const events = pred.push(s);
  prior.advance(s.t);
  for (const e of events) {
    if (e.kind === 'predict') {
      predicted.push(sound(e.t, e.at));
      magnet.push(sound(magnetise(e.t, prior.state(), magnetism).t, e.at));
    } else {
      if (e.predicted === null) {
        predicted.push(sound(e.t, e.at));
        magnet.push(sound(e.t, e.at));
      }
      const anchor: Anchor = { t: e.t, confidence: e.confidence, strength: e.strength, sharpness: NaN, lateral: 0 };
      prior.update(anchor);
      pred.setPeriod(prior.state().period);
    }
  }
}

writeFileSync(
  out,
  JSON.stringify(
    {
      clip: clipDir.split('/').filter(Boolean).pop(),
      fps: truth.spec.fps,
      kind: truth.spec.kind,
      object: truth.spec.object,
      minLead,
      magnetism,
      events: truth.events.map((e) => ({ index: e.index, t_impact: e.t_impact, t_grid: e.t_grid })),
      onsets: { frameSnapped, predicted, magnet },
    },
    null,
    1,
  ),
);

// A quick per-strategy report against the truth (nearest onset within 120 ms).
const ms = (x: number) => (1000 * x).toFixed(1);
for (const [name, ons] of Object.entries({ frameSnapped, predicted, magnet })) {
  const errI: number[] = [];
  const errG: number[] = [];
  for (const e of truth.events) {
    const o = ons.reduce<Onset | null>((b, x) => (b === null || Math.abs(x.t - e.t_impact) < Math.abs(b.t - e.t_impact) ? x : b), null);
    if (o && Math.abs(o.t - e.t_impact) < 0.12) {
      errI.push(o.t - e.t_impact);
      errG.push(o.t - e.t_grid);
    }
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
  const mae = (a: number[]) => mean(a.map(Math.abs));
  console.log(
    `${name}: n=${errI.length}/${truth.events.length} vs contact mean ${ms(mean(errI))} sd ${ms(sd(errI))} MAE ${ms(mae(errI))} | vs grid MAE ${ms(mae(errG))}`,
  );
}
