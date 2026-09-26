/**
 * Per-frame pitch predictions for one held-out player of an air-instrument dataset
 * (bass, flute), for the demo page.
 *
 * This is one fold of the leave-one-player-out evaluation in
 * `docs/research/air-instruments.md` §7: a softmax model is trained on every OTHER
 * player's labelled frames (`datasets/air/<instrument>/<name>.ndjson`, as
 * `build_pitch_dataset.ts` writes it) and classifies this player's frames, which it has
 * never seen. The audio label is carried along so the renderer can show and sound the
 * disagreement; it is never an input to the prediction.
 *
 * Writes the same JSON shape as `chord_shape_timeline.ts`, so `render_chord_demo.py`
 * renders it. The player should have a single video in the dataset (the samples carry a
 * time but no video id).
 *
 * Usage:
 *   npx vite-node scripts/demos/air_pitch_timeline.ts --instrument bass --player trevor
 *     [--name pitch_class] [--smooth 9] [--epochs 300] [--out FILE]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { airDir, dataRoot, type AirInstrument } from '../air/lib_air_paths';
import { samplesFromNdjson } from '../air/lib_chord_shape_dataset';
import { evaluate, predictProba, smoothPredictions, trainSoftmax } from '../air/lib_chord_shape_model';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const instrument = arg('instrument', 'bass') as AirInstrument;
const player = arg('player', '');
const name = arg('name', 'pitch_class');
const smooth = Number(arg('smooth', '9'));
const epochs = Number(arg('epochs', '300'));
const out = arg('out', join(dataRoot(), 'demos', instrument, `${player}.timeline.json`));
if (!player) throw new Error('--player is required');

const all = samplesFromNdjson(readFileSync(join(airDir('datasets', instrument), `${name}.ndjson`), 'utf8'));
const mine = all.filter((s) => s.group === player).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
const others = all.filter((s) => s.group !== player);
if (mine.length === 0) throw new Error(`no samples for player ${player}`);
const features = Object.keys(all[0].vector);
const model = trainSoftmax(others, features, { epochs });

const rows = mine.map((s) => {
  const [raw, p] = Object.entries(predictProba(model, s.vector)).sort((a, b) => b[1] - a[1])[0];
  return { t: s.t ?? 0, raw, p, truth: s.label };
});
const smoothed = smoothPredictions(
  rows.map((r) => r.raw),
  smooth,
  rows.map((r) => r.t),
  0.5,
);
const frames = rows.map((r, i) => ({ t: r.t, pred: smoothed[i], p: Number(r.p.toFixed(3)), truth: r.truth }));
const heldOut = evaluate(
  frames.map((f) => f.truth),
  frames.map((f) => f.pred),
).accuracy;
const classes = [...new Set(all.map((s) => s.label))].length;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ instrument, player, name, trainedOn: others.length, classes, heldOut, scoredFrames: frames.length, frames }));
console.log(`${instrument}/${player}: trained on ${others.length} frames of other players, held-out ${(100 * heldOut).toFixed(1)}% on ${frames.length} frames (${classes} classes, chance ${(100 / classes).toFixed(1)}%) -> ${out}`);
