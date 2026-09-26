/**
 * Join every guitar source's landmark stream with its audio chord labels into one
 * local dataset: `datasets/air/guitar/chord_shapes.ndjson` (one `Sample` per line)
 * plus a `chord_shapes.stats.json` with the per-video join counts. Local only; see
 * `lib_air_paths.ts` for why nothing here is committed.
 *
 * Windows declared on a source were already applied by `extract.py` / `label_chords.py`
 * (both work on the excerpt), so times here are excerpt-relative on both sides and the
 * join applies no window of its own.
 *
 * Usage:
 *   npx vite-node scripts/air/build_chord_shape_dataset.ts [--margin 0.25] [--min-score 0.5] [--orientation]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airDir, chordLabelsPath, landmarksPath } from './lib_air_paths';
import { joinLabelledFrames, readChordLabels, readLandmarks, samplesToNdjson, type JoinStats } from './lib_chord_shape_dataset';
import type { Sample } from './lib_chord_shape_model';
import { parseSources } from './lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const margin = Number(arg('margin', '0.25'));
const minScore = Number(arg('min-score', '0'));
const withOrientation = process.argv.includes('--orientation');

const doc = parseSources(readFileSync(join(__dirname, 'sources', 'guitar.json'), 'utf8'));
const outDir = airDir('datasets', 'guitar');
mkdirSync(outDir, { recursive: true });

const all: Sample[] = [];
const stats: Record<string, JoinStats & { holdout?: boolean; missing?: string }> = {};
for (const src of doc.sources) {
  const lm = landmarksPath('guitar', src.id);
  const lb = chordLabelsPath('guitar', src.id);
  if (!existsSync(lm) || !existsSync(lb)) {
    stats[src.id] = { frames: 0, handFrames: 0, labelledFrames: 0, samples: 0, perLabel: {}, missing: !existsSync(lm) ? 'landmarks' : 'labels' };
    console.error(`skip ${src.id}: missing ${stats[src.id].missing}`);
    continue;
  }
  const { samples, stats: s } = joinLabelledFrames(readLandmarks(lm), readChordLabels(lb).segments, {
    group: src.id,
    pick: src.frettingHand,
    marginSeconds: margin,
    vocabulary: new Set(src.chords),
    minScore: minScore > 0 ? minScore : undefined,
    features: { withOrientation },
  });
  stats[src.id] = { ...s, holdout: src.holdout };
  all.push(...samples);
  console.error(`${src.id}: frames=${s.frames} hand=${s.handFrames} labelled=${s.labelledFrames} ${JSON.stringify(s.perLabel)}`);
}
const suffix = withOrientation ? '_orient' : '';
writeFileSync(join(outDir, `chord_shapes${suffix}.ndjson`), samplesToNdjson(all));
writeFileSync(join(outDir, `chord_shapes${suffix}.stats.json`), JSON.stringify({ margin, minScore, withOrientation, perVideo: stats }, null, 1));
console.error(`wrote ${all.length} samples -> ${outDir}`);
