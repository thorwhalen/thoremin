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
 * Filtering, scoring and the vote follow `runHeldOut` / `leaveOneGroupOut`: players
 * under `--min-per-group` frames are dropped, only frames whose label the training
 * players have are scored, and the vote never crosses a gap. Both the raw and the voted
 * accuracy are reported, as in the doc's table.
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
/** As `runHeldOut`: a player with fewer frames is left out of training and of the folds. */
const minPerGroup = Number(arg('min-per-group', '30'));
const out = arg('out', join(dataRoot(), 'demos', instrument, `${player}.timeline.json`));
if (!player) throw new Error('--player is required');

const loaded = samplesFromNdjson(readFileSync(join(airDir('datasets', instrument), `${name}.ndjson`), 'utf8'));
const perGroup = new Map<string, number>();
for (const s of loaded) perGroup.set(s.group, (perGroup.get(s.group) ?? 0) + 1);
const all = loaded.filter((s) => (perGroup.get(s.group) ?? 0) >= minPerGroup);
const mine = all.filter((s) => s.group === player).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
const others = all.filter((s) => s.group !== player);
if (mine.length === 0) throw new Error(`no samples for player ${player} (or fewer than ${minPerGroup} frames)`);
const features = Object.keys(all[0].vector);
const model = trainSoftmax(others, features, { epochs });

const rows = mine.map((s) => {
  const [raw, p] = Object.entries(predictProba(model, s.vector)).sort((a, b) => b[1] - a[1])[0];
  return { t: s.t ?? 0, raw, p, truth: s.label };
});
// The same vote as the evaluation (`leaveOneGroupOut`): never across a gap in the join.
const smoothed = smoothPredictions(
  rows.map((r) => r.raw),
  smooth,
  rows.map((r) => r.t),
);
const frames = rows.map((r, i) => ({ t: r.t, pred: smoothed[i], p: Number(r.p.toFixed(3)), truth: r.truth }));
// Scored as the evaluation scores a fold: only frames whose label the training players
// have (a class the model never saw is reported as unscorable, not as a miss).
const trainLabels = new Set(others.map((s) => s.label));
const scorable = rows.map((r, i) => ({ ...r, pred: smoothed[i] })).filter((r) => trainLabels.has(r.truth));
const rawAccuracy = evaluate(scorable.map((r) => r.truth), scorable.map((r) => r.raw)).accuracy;
const heldOut = evaluate(scorable.map((r) => r.truth), scorable.map((r) => r.pred)).accuracy;
const unscorable = rows.length - scorable.length;
const classes = [...new Set(all.map((s) => s.label))].length;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ instrument, player, name, trainedOn: others.length, classes, rawAccuracy, heldOut, scoredFrames: scorable.length, unscorable, frames }));
console.log(`${instrument}/${player}: trained on ${others.length} frames of other players, held-out ${(100 * rawAccuracy).toFixed(1)}% raw / ${(100 * heldOut).toFixed(1)}% ${smooth}-frame vote on ${scorable.length} frames (${unscorable} unscorable; ${classes} classes, chance ${(100 / classes).toFixed(1)}%) -> ${out}`);
