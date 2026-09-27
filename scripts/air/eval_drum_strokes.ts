/**
 * Score the frame-level stroke detector against the audio onsets of every drum source,
 * and describe the strokes of the air sources and any local clip that has no audio
 * hits. Writes `results/air/drums/strokes.results.json` (local) and a markdown table.
 *
 * Scoring is the beat-tracking F-measure from `packages/ictus/src/metrics.ts` (an onset and a
 * stroke match within a window), at two windows: one frame period (the honest
 * frame-level number) and 70 ms (the MIR convention), each raw AND after removing the
 * median signed lag between strokes and onsets. The wrist's reversal trails the sound
 * by a roughly constant amount (Dahl's finding), so the raw one-frame F-measure mostly
 * measures that lag, and the lag itself is reported in milliseconds: it is the number
 * the sub-frame stream must predict away. Flams (two hits inside the onset labeller's
 * minimum gap) count as one onset and two strokes, against precision.
 *
 * Tracked points (#246): the pose wrist is the baseline; when the source also has a
 * hands stream (`extract.py --streams hands`), each point on the hand the air drum can
 * track (`src/nodes/music/drum_anchor.ts`: the hand's wrist landmark, the index
 * fingertip, the estimated stick tip) is scored on the same onsets, one row per point,
 * the hands joined to the pose by tick for identity and normalisation
 * (`handTracks`). `--points` narrows the list.
 *
 * Usage:
 *   npx vite-node scripts/air/eval_drum_strokes.ts [--min-noise 12] [--points poseWrist,stickTip] [--stick-length 3] [--file <stem> ...]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fMeasure, medianInterval } from '@thoremin/ictus/metrics';
import { airDir } from './lib_air_paths';
import { readLandmarks } from './lib_chord_shape_dataset';
import { DRUM_ANCHOR_POINTS, DEFAULT_STICK_LENGTH, type DrumAnchorPoint } from '@/nodes/music/drum_anchor';
import { assignStrokes, handTracks, maskTracks, median, strokesOfTracks, timingErrors, wristTracks, type Cluster, type Stroke, type Wrist, type WristSample } from './lib_drum_strokes';
import { parseSourcesFor } from './lib_sources';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const minNoise = Number(arg('min-noise', '12'));
const stickLength = Number(arg('stick-length', String(DEFAULT_STICK_LENGTH)));
/** `poseWrist` is the pose model's wrist; `poseWristSame` the same, kept only on the
 *  samples where the hand points are tracked on that arm (the like-for-like baseline;
 *  every hand point shares one coverage); the rest are points on the hand. */
type TrackedPoint = 'poseWrist' | 'poseWristSame' | DrumAnchorPoint;
const ALL_POINTS: TrackedPoint[] = ['poseWrist', 'poseWristSame', ...DRUM_ANCHOR_POINTS];
const points = arg('points', ALL_POINTS.join(',')).split(',') as TrackedPoint[];
for (const p of points) if (!ALL_POINTS.includes(p)) throw new Error(`unknown point ${p}; one of ${ALL_POINTS.join(', ')}`);
const extraFiles = (() => {
  const i = process.argv.indexOf('--file');
  if (i < 0) return [];
  const out: string[] = [];
  for (const a of process.argv.slice(i + 1)) {
    if (a.startsWith('--')) break;
    out.push(a);
  }
  return out;
})();

interface Row {
  id: string;
  point: TrackedPoint;
  player: string;
  air: boolean;
  frames: number;
  /** Fraction of the frames where this point was tracked, per arm. */
  coverage: Record<Wrist, number>;
  fps: number;
  strokes: number;
  left: number;
  right: number;
  medianGap: number;
  onsets?: number;
  /** Median signed stroke-minus-onset lag, seconds (positive = the wrist reverses after the sound). */
  lag?: number;
  fFrame?: number;
  f70?: number;
  /** Precision and recall at 70 ms, raw. */
  p70?: number;
  r70?: number;
  fFrameLagged?: number;
  f70Lagged?: number;
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
  const handsPath = join(airDir('landmarks', 'drums'), `${job.id}.src.hands.ndjson`);
  const handRecords = existsSync(handsPath) || existsSync(`${handsPath}.gz`) ? readLandmarks(handsPath) : null;
  const fps = records.length > 1 ? (records.length - 1) / (records[records.length - 1].t - records[0].t) : 30;
  const onsetsPath = join(airDir('labels', 'drums'), `${job.id}.onsets.json`);
  const onsets = !job.air && existsSync(onsetsPath) ? (JSON.parse(readFileSync(onsetsPath, 'utf8')) as { onsets: number[] }).onsets : null;
  for (const point of points) {
    let tracks: Record<Wrist, WristSample[]>;
    if (point === 'poseWrist') tracks = wristTracks(records);
    else if (!handRecords) continue;
    else if (point === 'poseWristSame') tracks = maskTracks(wristTracks(records), handTracks(handRecords, records, { point: 'wrist', stickLength }));
    else tracks = handTracks(handRecords, records, { point, stickLength });
    const coverage = (w: Wrist) => tracks[w].filter((s) => s.visible).length / Math.max(1, records.length);
    const strokes: Stroke[] = strokesOfTracks(tracks, { minAmplitudeNoiseUnits: minNoise });
    const drums = assignStrokes(strokes);
    const row: Row = {
      id: job.id,
      point,
      player: job.player,
      air: job.air,
      frames: records.length,
      coverage: { left: coverage('left'), right: coverage('right') },
      fps,
      strokes: strokes.length,
      left: strokes.filter((s) => s.wrist === 'left').length,
      right: strokes.filter((s) => s.wrist === 'right').length,
      medianGap: medianInterval(strokes.map((s) => s.t)),
      drums,
    };
    if (onsets) {
      const est = strokes.map((s) => s.t);
      row.onsets = onsets.length;
      row.fFrame = fMeasure(onsets, est, 1 / fps);
      row.f70 = fMeasure(onsets, est, 0.07);
      // F = 2m / (strokes + onsets), so the match count, precision and recall follow.
      const m = (row.f70 * (est.length + onsets.length)) / 2;
      row.p70 = est.length ? m / est.length : 0;
      row.r70 = m / onsets.length;
      const lag = median(timingErrors(onsets, est, 0.1));
      if (Number.isFinite(lag)) {
        row.lag = lag;
        const shifted = est.map((t) => t - lag);
        row.fFrameLagged = fMeasure(onsets, shifted, 1 / fps);
        row.f70Lagged = fMeasure(onsets, shifted, 0.07);
      }
    }
    rows.push(row);
    console.error(`${job.id} ${point}: strokes=${strokes.length} drums=${drums.length}${row.f70 !== undefined ? ` F@70ms=${row.f70.toFixed(3)} lag=${((row.lag ?? 0) * 1000).toFixed(0)}ms` : ''}`);
  }
}
const resDir = airDir('results', 'drums');
mkdirSync(resDir, { recursive: true });
writeFileSync(join(resDir, 'strokes.results.json'), JSON.stringify({ minNoise, stickLength, rows }, null, 1));

const pct = (x?: number) => (x === undefined ? '' : `${(100 * x).toFixed(1)}%`);
console.log('| source (player) | point | frames | tracked L/R | fps | strokes L/R | median gap s | onsets | lag ms | F, 1 frame raw / lag-corrected | F, 70 ms raw / lag-corrected | P / R at 70 ms raw | drums L+R (clusters) |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const clusters = r.drums.map((c) => `${c.wrist[0].toUpperCase()}(${c.x.toFixed(2)}, ${c.y.toFixed(2)}) x${c.count}`).join('; ');
  const nL = r.drums.filter((d) => d.wrist === 'left').length;
  const nR = r.drums.length - nL;
  console.log(
    `| ${r.id} (${r.player})${r.air ? ' air' : ''} | ${r.point} | ${r.frames} | ${(100 * r.coverage.left).toFixed(0)}% / ${(100 * r.coverage.right).toFixed(0)}% | ${r.fps.toFixed(1)} | ${r.left}/${r.right} | ${Number.isFinite(r.medianGap) ? r.medianGap.toFixed(3) : ''} | ${r.onsets ?? ''} | ${r.lag === undefined ? '' : (1000 * r.lag).toFixed(0)} | ${pct(r.fFrame)} / ${pct(r.fFrameLagged)} | ${pct(r.f70)} / ${pct(r.f70Lagged)} | ${pct(r.p70)} / ${pct(r.r70)} | ${nL}+${nR}: ${clusters} |`,
  );
}
