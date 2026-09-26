/**
 * The enrolment experiment: how many seconds of a player's OWN footage per chord does
 * it take to recognise their chord shapes, and does footage of other players help or
 * hurt once they have enrolled?
 *
 * For every player in the local dataset and every budget in `--seconds`, the player's
 * first `seconds` of each chord (in time order, what they would demonstrate to the
 * trainer) is the enrolment set and their later frames, after a gap, the test set.
 * Three models are scored on that test set: softmax on the enrolment alone, softmax on
 * every other player plus the enrolment, and the trainer's nearest centroid on the
 * enrolment alone. Written to `results/air/guitar/chord_shapes.enrol.json` (local) and
 * printed as a markdown table for the research doc.
 *
 * Usage:
 *   npx vite-node scripts/air/enrol_chord_shape.ts [--seconds 2,5,10,20] [--gap 2] [--epochs 200]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airDir } from './lib_air_paths';
import { samplesFromNdjson } from './lib_chord_shape_dataset';
import { chordShapeFeatureIds } from './lib_chord_shape_features';
import { enrolmentSplit, evaluate, predict, predictCentroid, trainCentroid, trainSoftmax } from './lib_chord_shape_model';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const budgets = arg('seconds', '2,5,10,20').split(',').map(Number);
const gap = Number(arg('gap', '2'));
const epochs = Number(arg('epochs', '200'));
/** Frames per second the landmark streams were decoded at (25 to 30 here; 27 splits the difference). */
const fps = Number(arg('fps', '27'));

const dsPath = join(airDir('datasets', 'guitar'), 'chord_shapes.ndjson');
if (!existsSync(dsPath)) throw new Error(`no dataset at ${dsPath}; run build_chord_shape_dataset.ts first`);
const all = samplesFromNdjson(readFileSync(dsPath, 'utf8'));
const F = chordShapeFeatureIds();
const players = [...new Set(all.map((s) => s.group))].sort();

interface Row {
  player: string;
  seconds: number;
  enrol: number;
  test: number;
  labels: string[];
  ownSoftmax: number;
  othersPlusOwn: number;
  ownCentroid: number;
}
const rows: Row[] = [];
for (const seconds of budgets) {
  for (const p of players) {
    const mine = all.filter((s) => s.group === p);
    const others = all.filter((s) => s.group !== p);
    const { enrol, test } = enrolmentSplit(mine, { seconds, fps, gapSeconds: gap });
    if (test.length === 0 || enrol.length === 0) continue;
    const truth = test.map((s) => s.label);
    const own = trainSoftmax(enrol, F, { epochs });
    const both = trainSoftmax([...others, ...enrol], F, { epochs });
    const cent = trainCentroid(enrol, F);
    rows.push({
      player: p,
      seconds,
      enrol: enrol.length,
      test: test.length,
      labels: [...new Set(enrol.map((s) => s.label))].sort(),
      ownSoftmax: evaluate(truth, test.map((s) => predict(own, s.vector))).accuracy,
      othersPlusOwn: evaluate(truth, test.map((s) => predict(both, s.vector))).accuracy,
      ownCentroid: evaluate(truth, test.map((s) => predictCentroid(cent, s.vector))).accuracy,
    });
  }
}
const resDir = airDir('results', 'guitar');
mkdirSync(resDir, { recursive: true });
writeFileSync(join(resDir, 'chord_shapes.enrol.json'), JSON.stringify({ budgets, gap, fps, epochs, rows }, null, 1));

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
console.log('| player | enrolment s/chord | enrol frames | test frames | chords | own only, softmax | others + own, softmax | own only, centroid |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.player} | ${r.seconds} | ${r.enrol} | ${r.test} | ${r.labels.join(' ')} | ${pct(r.ownSoftmax)} | ${pct(r.othersPlusOwn)} | ${pct(r.ownCentroid)} |`);
}
