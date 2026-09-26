/**
 * Join every guitar source's landmark stream with its audio chord labels into one
 * local dataset: `datasets/air/guitar/chord_shapes.ndjson` (one `Sample` per line,
 * grouped by PLAYER, the held-out unit) plus `chord_shapes.stats.json` with the
 * per-video join counts. Holdout probes have no labels and go into
 * `chord_shapes.probe.ndjson` with every frame labelled `?`. Local only; see
 * `lib_air_paths.ts` for why nothing here is committed.
 *
 * Windows declared on a source were already applied by `extract.py` / `label_chords.py`
 * (both work on the excerpt), so times here are excerpt-relative on both sides and the
 * join applies no window of its own.
 *
 * Usage:
 *   npx vite-node scripts/air/build_chord_shape_dataset.ts [--margin 0.25] [--orientation]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airDir, chordLabelsPath, landmarksPath } from './lib_air_paths';
import {
  joinLabelledFrames,
  joinUnlabelledFrames,
  readChordLabels,
  readLandmarks,
  samplesToNdjson,
  segmentLabeller,
  type JoinStats,
} from './lib_chord_shape_dataset';
import { chordShapeFeaturizer } from './lib_chord_shape_features';
import type { Sample } from './lib_chord_shape_model';
import { parseGuitarSources } from './lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const margin = Number(arg('margin', '0.25'));
const withOrientation = process.argv.includes('--orientation');

const doc = parseGuitarSources(readFileSync(join(__dirname, 'sources', 'guitar.json'), 'utf8'));
const outDir = airDir('datasets', 'guitar');
mkdirSync(outDir, { recursive: true });

const all: Sample[] = [];
const probe: Sample[] = [];
const stats: Record<string, JoinStats & { player: string; holdout?: boolean; missing?: string }> = {};
const empty = (): JoinStats => ({ frames: 0, handFrames: 0, labelledFrames: 0, samples: 0, perLabel: {} });
for (const src of doc.sources) {
  const lm = landmarksPath('guitar', src.id);
  if (!existsSync(lm)) {
    stats[src.id] = { ...empty(), player: src.player, missing: 'landmarks' };
    console.error(`skip ${src.id}: missing landmarks`);
    continue;
  }
  const featurize = chordShapeFeaturizer(src.frettingHand, { withOrientation });
  if (src.holdout) {
    const { samples, stats: s } = joinUnlabelledFrames(readLandmarks(lm), { group: src.player, featurize });
    stats[src.id] = { ...s, player: src.player, holdout: true };
    probe.push(...samples);
    console.error(`${src.id} (probe): frames=${s.frames} hand=${s.handFrames}`);
    continue;
  }
  const lb = chordLabelsPath('guitar', src.id);
  if (!existsSync(lb)) {
    stats[src.id] = { ...empty(), player: src.player, missing: 'labels' };
    console.error(`skip ${src.id}: missing labels`);
    continue;
  }
  const { samples, stats: s } = joinLabelledFrames(readLandmarks(lm), {
    group: src.player,
    featurize,
    labelOf: segmentLabeller(readChordLabels(lb).segments, margin),
    vocabulary: new Set(src.chords),
  });
  stats[src.id] = { ...s, player: src.player };
  all.push(...samples);
  console.error(`${src.id}: frames=${s.frames} hand=${s.handFrames} labelled=${s.labelledFrames} ${JSON.stringify(s.perLabel)}`);
}
const suffix = withOrientation ? '_orient' : '';
writeFileSync(join(outDir, `chord_shapes${suffix}.ndjson`), samplesToNdjson(all));
writeFileSync(join(outDir, `chord_shapes${suffix}.probe.ndjson`), samplesToNdjson(probe));
writeFileSync(join(outDir, `chord_shapes${suffix}.stats.json`), JSON.stringify({ margin, withOrientation, perVideo: stats }, null, 1));
console.error(`wrote ${all.length} samples + ${probe.length} probe frames -> ${outDir}`);
