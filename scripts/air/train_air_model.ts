/**
 * Train and evaluate one air-instrument dataset, held out by player, and write the
 * numbers down: `results/air/<instrument>/<name>.results.json` (every fold, every
 * confusion matrix), the final model `models/air/<instrument>/<name>.json` (local;
 * YouTube-derived weights are never committed) and a markdown summary on stdout for
 * the research doc. The dataset is `datasets/air/<instrument>/<name>.ndjson` (+ an
 * optional `<name>.probe.ndjson`), as the build scripts write it, and its feature ids
 * are read from the samples themselves (every sample carries the full id set).
 *
 * Usage:
 *   npx vite-node scripts/air/train_air_model.ts <instrument> <name> [--target "pitch class"] [--epochs 300] [--smooth 9] [--min-per-group 30]
 *   e.g. train_air_model.ts flute pitch_class ; train_air_model.ts bass pitch_class
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIR_INSTRUMENTS, airDir, type AirInstrument } from './lib_air_paths';
import { runHeldOut } from './lib_air_train';
import { samplesFromNdjson } from './lib_chord_shape_dataset';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
const instrument = positional[0] as AirInstrument;
const name = positional[1];
if (!AIR_INSTRUMENTS.includes(instrument) || !name) throw new Error('usage: train_air_model.ts <instrument> <name>');

const dsPath = join(airDir('datasets', instrument), `${name}.ndjson`);
if (!existsSync(dsPath)) throw new Error(`no dataset at ${dsPath}; build it first`);
const samples = samplesFromNdjson(readFileSync(dsPath, 'utf8'));
const probePath = join(airDir('datasets', instrument), `${name}.probe.ndjson`);
const probe = existsSync(probePath) ? samplesFromNdjson(readFileSync(probePath, 'utf8')) : [];
if (samples.length === 0) throw new Error(`${dsPath} is empty`);
const features = Object.keys(samples[0].vector);

const { report, model, markdown } = runHeldOut(samples, probe, {
  features,
  target: arg('target', name.replace(/_/g, ' ')),
  epochs: Number(arg('epochs', '300')),
  smoothWindow: Number(arg('smooth', '9')),
  minPerGroup: Number(arg('min-per-group', '30')),
});
const resDir = airDir('results', instrument);
const modelDir = airDir('models', instrument);
mkdirSync(resDir, { recursive: true });
mkdirSync(modelDir, { recursive: true });
writeFileSync(join(resDir, `${name}.results.json`), JSON.stringify(report, null, 1));
writeFileSync(join(modelDir, `${name}.json`), JSON.stringify(model));
console.log(markdown);
