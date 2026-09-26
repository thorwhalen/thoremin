/**
 * Train and evaluate the guitar chord-shape model on the local dataset: the guitar
 * instance of `train_air_model.ts` (dataset `chord_shapes`, or `chord_shapes_orient`
 * with `--orientation`). Kept as its own entry point because the research doc and the
 * README name it; the harness is `lib_air_train.ts`.
 *
 * Usage:
 *   npx vite-node scripts/air/train_chord_shape.ts [--orientation] [--epochs 300] [--smooth 9] [--min-per-group 30]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airDir } from './lib_air_paths';
import { runHeldOut } from './lib_air_train';
import { samplesFromNdjson } from './lib_chord_shape_dataset';
import { chordShapeFeatureIds } from './lib_chord_shape_features';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const withOrientation = process.argv.includes('--orientation');
const suffix = withOrientation ? '_orient' : '';
const name = `chord_shapes${suffix}`;

const dsPath = join(airDir('datasets', 'guitar'), `${name}.ndjson`);
if (!existsSync(dsPath)) throw new Error(`no dataset at ${dsPath}; run build_chord_shape_dataset.ts first`);
const samples = samplesFromNdjson(readFileSync(dsPath, 'utf8'));
const probePath = join(airDir('datasets', 'guitar'), `${name}.probe.ndjson`);
const probe = existsSync(probePath) ? samplesFromNdjson(readFileSync(probePath, 'utf8')) : [];

const { report, model, markdown } = runHeldOut(samples, probe, {
  features: chordShapeFeatureIds({ withOrientation }),
  target: `chord shape (${withOrientation ? 'with' : 'without'} palm orientation)`,
  epochs: Number(arg('epochs', '300')),
  smoothWindow: Number(arg('smooth', '9')),
  minPerGroup: Number(arg('min-per-group', '30')),
});
const resDir = airDir('results', 'guitar');
const modelDir = airDir('models', 'guitar');
mkdirSync(resDir, { recursive: true });
mkdirSync(modelDir, { recursive: true });
writeFileSync(join(resDir, `${name}.results.json`), JSON.stringify(report, null, 1));
writeFileSync(join(modelDir, `${name}.json`), JSON.stringify(model));
console.log(markdown);
