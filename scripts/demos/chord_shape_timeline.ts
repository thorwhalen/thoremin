/**
 * Per-frame chord-shape predictions for one guitar video, for the demo page.
 *
 * The demo shows what the enrolment result in `docs/research/air-instruments.md`
 * (§6.3) means in practice: a player demonstrates each chord for a few seconds (the
 * first `--seconds` of each audio-labelled chord in the video), a softmax model is
 * trained on that alone, and every LATER frame is classified from the fretting hand's
 * shape only. The audio label is carried along so the renderer can show when the hand
 * and the sound disagree; it is never an input to the prediction.
 *
 * Writes `<out>` as JSON: the enrolment windows, the held-out accuracy, and one row
 * per frame `{t, pred, truth, p}` (pred = smoothed prediction, p = its probability,
 * truth = the audio label or null inside a change margin / no hand).
 *
 * Usage:
 *   npx vite-node scripts/demos/chord_shape_timeline.ts --video <id> --out <file.json>
 *     [--seconds 3] [--gap 2] [--smooth 9]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HandsFrame } from '@/nodes/domain';
import { chordLabelsPath, landmarksPath } from '../air/lib_air_paths';
import { joinLabelledFrames, readChordLabels, readLandmarks, segmentLabeller, NO_CHORD } from '../air/lib_chord_shape_dataset';
import { chordShapeFeatureIds, chordShapeFeaturizer } from '../air/lib_chord_shape_features';
import { enrolmentSplit, evaluate, predictProba, smoothPredictions, trainSoftmax } from '../air/lib_chord_shape_model';
import { parseGuitarSources } from '../air/lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const videoId = arg('video', '2pXS8k1zx8U');
const out = arg('out', 'chord_timeline.json');
const seconds = Number(arg('seconds', '3'));
const gap = Number(arg('gap', '2'));
const smooth = Number(arg('smooth', '9'));

const doc = parseGuitarSources(readFileSync(join(__dirname, '..', 'air', 'sources', 'guitar.json'), 'utf8'));
const src = doc.sources.find((s) => s.id === videoId);
if (!src) throw new Error(`${videoId} is not in scripts/air/sources/guitar.json`);

const records = readLandmarks(landmarksPath('guitar', videoId));
const fps = records.length > 1 ? 1 / (records[1].t - records[0].t) : 30;
const featurize = chordShapeFeaturizer(src.frettingHand);
const labels = readChordLabels(chordLabelsPath('guitar', videoId));
const labelOf = segmentLabeller(labels.segments);

// Enrolment: the player's first `seconds` of each chord, from the audio labels.
const { samples } = joinLabelledFrames(records, { group: src.player, featurize, labelOf });
const chordSamples = samples.filter((s) => s.label !== NO_CHORD);
const { enrol, test } = enrolmentSplit(chordSamples, { seconds, fps, gapSeconds: gap });
const F = chordShapeFeatureIds();
const model = trainSoftmax(enrol, F, {});
const enrolWindows = [...new Set(enrol.map((s) => s.label))].map((label) => {
  const ts = enrol.filter((s) => s.label === label).map((s) => s.t ?? 0);
  return { label, from: Math.min(...ts), to: Math.max(...ts) };
});
const enrolEnd = Math.max(...enrolWindows.map((w) => w.to));

// Every frame with a fretting hand, in time order.
const rows: { t: number; raw: string; p: number; truth: string | null }[] = [];
for (const r of records) {
  const v = featurize(r.value as HandsFrame);
  if (!v) continue;
  const proba = predictProba(model, v);
  const [raw, p] = Object.entries(proba).sort((a, b) => b[1] - a[1])[0];
  rows.push({ t: r.t, raw, p, truth: labelOf(r.t) });
}
const smoothed = smoothPredictions(
  rows.map((r) => r.raw),
  smooth,
  rows.map((r) => r.t),
  0.5,
);
const frames = rows.map((r, i) => ({ t: r.t, pred: smoothed[i], p: Number(r.p.toFixed(3)), truth: r.truth }));

// Held-out accuracy on the enrolment split's test frames, smoothed as shown.
const testTimes = new Set(test.map((s) => s.t));
const scored = frames.filter((f) => testTimes.has(f.t) && f.truth && f.truth !== NO_CHORD);
const heldOut = evaluate(
  scored.map((f) => f.truth!),
  scored.map((f) => f.pred),
).accuracy;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ video: videoId, player: src.player, fps, seconds, gap, enrolWindows, enrolEnd, heldOut, scoredFrames: scored.length, frames }),
);
console.log(
  `${videoId}: enrolled ${enrol.length} frames (${enrolWindows.map((w) => w.label).join(' ')}), held-out ${(100 * heldOut).toFixed(1)}% on ${scored.length} frames -> ${out}`,
);
