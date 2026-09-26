/**
 * Train and evaluate the guitar chord-shape model on the local dataset, and write the
 * numbers down: `results/air/guitar/chord_shapes.results.json` (every fold, every
 * confusion matrix) and a markdown summary on stdout for the research doc. The final
 * model, fitted on every trainable video, goes to `models/air/guitar/chord_shapes.json`
 * (local; YouTube-derived weights are never committed).
 *
 * Three numbers, always together, because each answers a different question:
 *   1. leave-one-player-out, softmax  — does a shape learned on other players transfer?
 *   2. leave-one-player-out, centroid — would the trainer's own classifier have done?
 *   3. within-player random split     — the optimistic bound (adjacent frames leak).
 * The holdout probe (air guitar, unlabelled) is reported separately: how many frames
 * had a usable hand, what the final model predicted on them, and how confident it was.
 * That is a description of the domain shift, not an accuracy.
 *
 * Usage:
 *   npx vite-node scripts/air/train_chord_shape.ts [--orientation] [--epochs 300] [--smooth 9] [--min-per-group 30]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airDir } from './lib_air_paths';
import { samplesFromNdjson } from './lib_chord_shape_dataset';
import { chordShapeFeatureIds } from './lib_chord_shape_features';
import {
  centroidTrainer,
  formatFolds,
  leaveOneGroupOut,
  predictProba,
  softmaxTrainer,
  trainSoftmax,
  withinGroupSplit,
} from './lib_chord_shape_model';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const withOrientation = process.argv.includes('--orientation');
const epochs = Number(arg('epochs', '300'));
const smoothWindow = Number(arg('smooth', '9'));
const minPerGroup = Number(arg('min-per-group', '30'));
const suffix = withOrientation ? '_orient' : '';

const dsPath = join(airDir('datasets', 'guitar'), `chord_shapes${suffix}.ndjson`);
if (!existsSync(dsPath)) throw new Error(`no dataset at ${dsPath}; run build_chord_shape_dataset.ts first`);
const samples = samplesFromNdjson(readFileSync(dsPath, 'utf8'));
const probePath = join(airDir('datasets', 'guitar'), `chord_shapes${suffix}.probe.ndjson`);
const probe = existsSync(probePath) ? samplesFromNdjson(readFileSync(probePath, 'utf8')) : [];

// Drop players with too few labelled frames to be a fold.
const perGroup = new Map<string, number>();
for (const s of samples) perGroup.set(s.group, (perGroup.get(s.group) ?? 0) + 1);
const kept = samples.filter((s) => (perGroup.get(s.group) ?? 0) >= minPerGroup);
const dropped = [...perGroup].filter(([, n]) => n < minPerGroup).map(([g, n]) => `${g} (${n})`);

const features = chordShapeFeatureIds({ withOrientation });
const labels = [...new Set(kept.map((s) => s.label))].sort();
const perLabel: Record<string, number> = {};
for (const s of kept) perLabel[s.label] = (perLabel[s.label] ?? 0) + 1;

const lovoSoftmax = leaveOneGroupOut(kept, features, softmaxTrainer({ epochs }), { smoothWindow });
const lovoCentroid = leaveOneGroupOut(kept, features, centroidTrainer, { smoothWindow });
const within = withinGroupSplit(kept, features, softmaxTrainer({ epochs }));
const finalModel = trainSoftmax(kept, features, { epochs });

// The probe: prediction histogram and mean confidence per probe group.
const probeReport: Record<string, { frames: number; predicted: Record<string, number>; meanMaxProb: number }> = {};
for (const s of probe) {
  const p = predictProba(finalModel, s.vector);
  const best = Object.entries(p).sort((a, b) => b[1] - a[1])[0];
  const r = (probeReport[s.group] ??= { frames: 0, predicted: {}, meanMaxProb: 0 });
  r.frames += 1;
  r.predicted[best[0]] = (r.predicted[best[0]] ?? 0) + 1;
  r.meanMaxProb += best[1];
}
for (const r of Object.values(probeReport)) r.meanMaxProb = r.frames ? r.meanMaxProb / r.frames : 0;

const resDir = airDir('results', 'guitar');
const modelDir = airDir('models', 'guitar');
mkdirSync(resDir, { recursive: true });
mkdirSync(modelDir, { recursive: true });
writeFileSync(
  join(resDir, `chord_shapes${suffix}.results.json`),
  JSON.stringify({ features, labels, perLabel, dropped, epochs, smoothWindow, lovoSoftmax, lovoCentroid, within, probe: probeReport }, null, 1),
);
writeFileSync(join(modelDir, `chord_shapes${suffix}.json`), JSON.stringify(finalModel));

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const lines = [
  `Features: ${features.length} (${withOrientation ? 'with' : 'without'} palm orientation). Labels: ${labels.join(', ')}.`,
  `Samples: ${kept.length} frames over ${perGroup.size - dropped.length} players${dropped.length ? `; dropped ${dropped.join(', ')}` : ''}.`,
  `Per label: ${Object.entries(perLabel).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
  '',
  `### Leave-one-player-out, softmax regression`,
  formatFolds(lovoSoftmax),
  '',
  `### Leave-one-player-out, nearest centroid (the trainer's classifier)`,
  formatFolds(lovoCentroid),
  '',
  `### Within-player random split (optimistic bound): accuracy ${pct(within.accuracy)}, macro-F1 ${pct(within.macroF1)} on ${within.n} frames`,
  '',
  `### Probe (holdout, unlabelled): what the final model says on air guitar`,
  ...Object.entries(probeReport).map(
    ([g, r]) => `- ${g}: ${r.frames} hand frames; predicted ${Object.entries(r.predicted).map(([k, v]) => `${k}=${v}`).join(', ')}; mean max-probability ${r.meanMaxProb.toFixed(2)}`,
  ),
  '',
  `Pooled confusion (softmax, raw), rows = truth:`,
  '| | ' + Object.keys(lovoSoftmax.pooledRaw.confusion).join(' | ') + ' |',
  '|---|' + Object.keys(lovoSoftmax.pooledRaw.confusion).map(() => '---').join('|') + '|',
  ...Object.entries(lovoSoftmax.pooledRaw.confusion).map(([t, row]) => `| **${t}** | ${Object.values(row).join(' | ')} |`),
];
console.log(lines.join('\n'));
