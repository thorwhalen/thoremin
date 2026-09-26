/**
 * Join the flute or bass landmark streams with their audio pitch labels into a local
 * dataset of pitch-class samples: `datasets/air/<instrument>/pitch_class.ndjson`
 * (grouped by player) plus `pitch_class.stats.json`. The flute join runs on a bundle of
 * the hands and face streams (both hands + the embouchure blendshapes per frame); the
 * bass join on the hands stream (fretting-hand shape + position along the neck).
 *
 * The label is the PITCH CLASS of the sounding note. For the flute the first and
 * second octaves share most fingerings, so the class is the fingering up to the
 * octave key and the embouchure; for the bass the same pitch class sits on several
 * strings at different frets, so the number is an upper bound on what a position
 * model can do. Frames within `--margin` seconds of a note change are dropped.
 *
 * Usage:
 *   npx vite-node scripts/air/build_pitch_dataset.ts flute [--margin 0.08] [--no-face]
 *   npx vite-node scripts/air/build_pitch_dataset.ts bass  [--margin 0.08]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { airDir, landmarksPath } from './lib_air_paths';
import {
  bundleStreams,
  joinLabelledFrames,
  pitchClassLabeller,
  readLandmarks,
  readSegmentLabels,
  samplesToNdjson,
  type FrameBundle,
  type JoinStats,
} from './lib_chord_shape_dataset';
import type { Sample } from './lib_chord_shape_model';
import { parseSourcesFor } from './lib_sources';
import { bassFeaturizer, fluteFeaturizer } from './lib_wind_string_features';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const instrument = process.argv[2];
if (instrument !== 'flute' && instrument !== 'bass') throw new Error('usage: build_pitch_dataset.ts <flute|bass>');
const margin = Number(arg('margin', '0.08'));
const withFace = !process.argv.includes('--no-face');

const outDir = airDir('datasets', instrument);
mkdirSync(outDir, { recursive: true });
const all: Sample[] = [];
const stats: Record<string, JoinStats & { player: string; missing?: string }> = {};
const empty = (): JoinStats => ({ frames: 0, handFrames: 0, labelledFrames: 0, samples: 0, perLabel: {} });

const json = readFileSync(join(__dirname, 'sources', `${instrument}.json`), 'utf8');
const sources = instrument === 'flute' ? parseSourcesFor(json, 'flute').sources : parseSourcesFor(json, 'bass').sources;
for (const src of sources) {
  const hands = landmarksPath(instrument, src.id);
  const labels = join(airDir('labels', instrument), `${src.id}.pitch.json`);
  if (!existsSync(hands) || !existsSync(labels)) {
    stats[src.id] = { ...empty(), player: src.player, missing: !existsSync(hands) ? 'landmarks' : 'labels' };
    console.error(`skip ${src.id}: missing ${stats[src.id].missing}`);
    continue;
  }
  const labelOf = pitchClassLabeller(readSegmentLabels(labels).segments, margin);
  let result: { samples: Sample[]; stats: JoinStats };
  if (instrument === 'flute') {
    const s = src as Extract<typeof src, { leftHand: 'min' | 'max' }>;
    const facePath = join(airDir('landmarks', 'flute'), `${src.id}.face.ndjson`);
    const face = withFace && existsSync(facePath) ? readLandmarks(facePath) : undefined;
    const records = bundleStreams({ hands: readLandmarks(hands), face });
    result = joinLabelledFrames<FrameBundle>(records, { group: src.player, featurize: fluteFeaturizer({ leftHand: s.leftHand, withFace: withFace && !!face }), labelOf });
  } else {
    const s = src as Extract<typeof src, { frettingHand: unknown }>;
    const records = bundleStreams({ hands: readLandmarks(hands) });
    result = joinLabelledFrames<FrameBundle>(records, { group: src.player, featurize: bassFeaturizer(s.frettingHand), labelOf });
  }
  stats[src.id] = { ...result.stats, player: src.player };
  all.push(...result.samples);
  console.error(`${src.id}: frames=${result.stats.frames} hands=${result.stats.handFrames} labelled=${result.stats.labelledFrames} ${JSON.stringify(result.stats.perLabel)}`);
}
// Every sample must carry the same id set (a frame without a face has NaN face ids, not missing ones).
const ids = new Set(all.flatMap((s) => Object.keys(s.vector)));
for (const s of all) for (const id of ids) if (!(id in s.vector)) s.vector[id] = NaN;
const name = withFace || instrument === 'bass' ? 'pitch_class' : 'pitch_class_noface';
writeFileSync(join(outDir, `${name}.ndjson`), samplesToNdjson(all));
writeFileSync(join(outDir, `${name}.stats.json`), JSON.stringify({ margin, withFace, perVideo: stats }, null, 1));
console.error(`wrote ${all.length} samples -> ${outDir}/${name}.ndjson`);
