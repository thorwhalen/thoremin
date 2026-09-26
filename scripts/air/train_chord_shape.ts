/**
 * Train and evaluate the guitar chord-shape model on the local dataset, and write the
 * numbers down: `results/air/guitar/chord_shapes.results.json` (every fold, every
 * confusion matrix) and a markdown summary on stdout for the research doc. The final
 * model, fitted on every trainable video, goes to `models/air/guitar/chord_shapes.json`
 * (local; YouTube-derived weights are never committed).
 *
 * Three numbers, always together, because each answers a different question:
 *   1. leave-one-video-out, softmax  — does a shape learned on other players transfer?
 *   2. leave-one-video-out, centroid — would the trainer's own classifier have done?
 *   3. within-video random split     — the optimistic bound (adjacent frames leak).
 * Sources flagged `holdout` are scored in their own fold but never trained on.
 *
 * Usage:
 *   npx vite-node scripts/air/train_chord_shape.ts [--orientation] [--epochs 300] [--smooth 9] [--min-per-video 30]
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
  softmaxTrainer,
  trainSoftmax,
  withinGroupSplit,
} from './lib_chord_shape_model';
import { parseSources } from './lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const withOrientation = process.argv.includes('--orientation');
const epochs = Number(arg('epochs', '300'));
const smoothWindow = Number(arg('smooth', '9'));
const minPerVideo = Number(arg('min-per-video', '30'));
const suffix = withOrientation ? '_orient' : '';

const dsPath = join(airDir('datasets', 'guitar'), `chord_shapes${suffix}.ndjson`);
if (!existsSync(dsPath)) throw new Error(`no dataset at ${dsPath}; run build_chord_shape_dataset.ts first`);
const samples = samplesFromNdjson(readFileSync(dsPath, 'utf8'));
const doc = parseSources(readFileSync(join(__dirname, 'sources', 'guitar.json'), 'utf8'));
const holdout = new Set(doc.sources.filter((s) => s.holdout).map((s) => s.id));

// Drop videos with too few labelled frames to be a fold.
const perGroup = new Map<string, number>();
for (const s of samples) perGroup.set(s.group, (perGroup.get(s.group) ?? 0) + 1);
const kept = samples.filter((s) => (perGroup.get(s.group) ?? 0) >= minPerVideo);
const dropped = [...perGroup].filter(([, n]) => n < minPerVideo).map(([g, n]) => `${g} (${n})`);

const features = chordShapeFeatureIds({ withOrientation });
const labels = [...new Set(kept.map((s) => s.label))].sort();
const perLabel: Record<string, number> = {};
for (const s of kept) perLabel[s.label] = (perLabel[s.label] ?? 0) + 1;

const lovoSoftmax = leaveOneGroupOut(kept, features, softmaxTrainer({ epochs }), { smoothWindow, holdoutOnly: holdout });
const lovoCentroid = leaveOneGroupOut(kept, features, centroidTrainer, { smoothWindow, holdoutOnly: holdout });
const trainable = kept.filter((s) => !holdout.has(s.group));
const within = withinGroupSplit(trainable, features, softmaxTrainer({ epochs }));
const finalModel = trainSoftmax(trainable, features, { epochs });

const resDir = airDir('results', 'guitar');
const modelDir = airDir('models', 'guitar');
mkdirSync(resDir, { recursive: true });
mkdirSync(modelDir, { recursive: true });
writeFileSync(
  join(resDir, `chord_shapes${suffix}.results.json`),
  JSON.stringify({ features, labels, perLabel, dropped, epochs, smoothWindow, lovoSoftmax, lovoCentroid, within }, null, 1),
);
writeFileSync(join(modelDir, `chord_shapes${suffix}.json`), JSON.stringify(finalModel));

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const lines = [
  `Features: ${features.length} (${withOrientation ? 'with' : 'without'} palm orientation). Labels: ${labels.join(', ')}.`,
  `Samples: ${kept.length} frames over ${perGroup.size - dropped.length} videos${dropped.length ? `; dropped ${dropped.join(', ')}` : ''}.`,
  `Per label: ${Object.entries(perLabel).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
  '',
  `### Leave-one-video-out, softmax regression`,
  formatFolds(lovoSoftmax),
  '',
  `### Leave-one-video-out, nearest centroid (the trainer's classifier)`,
  formatFolds(lovoCentroid),
  '',
  `### Within-video random split (optimistic bound): accuracy ${pct(within.accuracy)}, macro-F1 ${pct(within.macroF1)} on ${within.n} frames`,
  '',
  `Pooled confusion (softmax, raw), rows = truth:`,
  '| | ' + Object.keys(lovoSoftmax.pooledRaw.confusion).join(' | ') + ' |',
  '|---|' + Object.keys(lovoSoftmax.pooledRaw.confusion).map(() => '---').join('|') + '|',
  ...Object.entries(lovoSoftmax.pooledRaw.confusion).map(([t, row]) => `| **${t}** | ${Object.values(row).join(' | ')} |`),
];
console.log(lines.join('\n'));
