/**
 * Score the frame-level stroke detector against the audio onsets of every drum source,
 * and describe the strokes of the air sources and any local clip that has no audio
 * hits. Writes `results/air/drums/strokes.results.json` (local) and a markdown table.
 *
 * Scoring is the beat-tracking F-measure from `src/ictus/metrics.ts` (an onset and a
 * stroke match within a window), at two windows: one frame period (the honest
 * frame-level number) and 70 ms (the MIR convention). A stroke detector that fires on
 * every hit but one frame late scores well here and is still useless as an instrument;
 * the sub-frame stream owns that gap.
 *
 * Usage:
 *   npx vite-node scripts/air/eval_drum_strokes.ts [--min-strength 3] [--file <stem> ...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fMeasure, medianInterval } from '@/ictus/metrics';
import { airDir } from './lib_air_paths';
import { readLandmarks } from './lib_chord_shape_dataset';
import { assignStrokes, strokesOf, wristTracks, type Cluster, type Stroke } from './lib_drum_strokes';
import { parseSourcesFor } from './lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const minStrength = Number(arg('min-strength', '3'));
const extraFiles = (() => {
  const i = process.argv.indexOf('--file');
  return i >= 0 ? process.argv.slice(i + 1).filter((a) => !a.startsWith('--')) : [];
})();

interface Row {
  id: string;
  player: string;
  air: boolean;
  frames: number;
  bodyFrames: number;
  fps: number;
  strokes: number;
  left: number;
  right: number;
  medianGap: number;
  onsets?: number;
  fFrame?: number;
  f70?: number;
  drums: Cluster[];
}

const doc = parseSourcesFor(readFileSync(join(__dirname, 'sources', 'drums.json'), 'utf8'), 'drums');
const jobs: { id: string; player: string; air: boolean }[] = doc.sources.map((s) => ({ id: s.id, player: s.player, air: !!s.air }));
for (const f of extraFiles) jobs.push({ id: f, player: 'local', air: true });

const rows: Row[] = [];
for (const job of jobs) {
  const pose = join(airDir('landmarks', 'drums'), `${job.id}.pose.ndjson`);
  if (!existsSync(pose) && !existsSync(`${pose}.gz`)) {
    console.error(`skip ${job.id}: no pose stream`);
    continue;
  }
  const records = readLandmarks(pose);
  const tracks = wristTracks(records);
  const bodyFrames = tracks.left.length;
  const fps = records.length > 1 ? (records.length - 1) / (records[records.length - 1].t - records[0].t) : 30;
  const strokes: Stroke[] = strokesOf(records, { minStrength });
  const drums = assignStrokes(strokes);
  const row: Row = {
    id: job.id,
    player: job.player,
    air: job.air,
    frames: records.length,
    bodyFrames,
    fps,
    strokes: strokes.length,
    left: strokes.filter((s) => s.wrist === 'left').length,
    right: strokes.filter((s) => s.wrist === 'right').length,
    medianGap: medianInterval(strokes.map((s) => s.t)),
    drums,
  };
  const onsetsPath = join(airDir('labels', 'drums'), `${job.id}.onsets.json`);
  if (!job.air && existsSync(onsetsPath)) {
    const onsets = (JSON.parse(readFileSync(onsetsPath, 'utf8')) as { onsets: number[] }).onsets;
    const est = strokes.map((s) => s.t);
    row.onsets = onsets.length;
    row.fFrame = fMeasure(onsets, est, 1 / fps);
    row.f70 = fMeasure(onsets, est, 0.07);
  }
  rows.push(row);
  console.error(`${job.id}: strokes=${strokes.length} drums=${drums.length}${row.f70 !== undefined ? ` F@70ms=${row.f70.toFixed(3)}` : ''}`);
}
const resDir = airDir('results', 'drums');
mkdirSync(resDir, { recursive: true });
writeFileSync(join(resDir, 'strokes.results.json'), JSON.stringify({ minStrength, rows }, null, 1));

const pct = (x?: number) => (x === undefined ? '' : `${(100 * x).toFixed(1)}%`);
console.log('| source (player) | frames | body found | fps | strokes L/R | median gap s | onsets | F, 1 frame | F, 70 ms | drums (clusters) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const clusters = r.drums.map((c) => `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}) x${c.count}`).join('; ');
  console.log(
    `| ${r.id} (${r.player})${r.air ? ' air' : ''} | ${r.frames} | ${((100 * r.bodyFrames) / Math.max(1, r.frames)).toFixed(0)}% | ${r.fps.toFixed(1)} | ${r.left}/${r.right} | ${Number.isFinite(r.medianGap) ? r.medianGap.toFixed(3) : ''} | ${r.onsets ?? ''} | ${pct(r.fFrame)} | ${pct(r.f70)} | ${r.drums.length}: ${clusters} |`,
  );
}
