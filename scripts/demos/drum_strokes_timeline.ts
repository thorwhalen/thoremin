/**
 * The wrist strokes and their drum assignment for one drums source, for the demo page.
 *
 * The same pipeline and settings as `scripts/air/eval_drum_strokes.ts` (the pose
 * stream's wrists through the ictus detector, landing points clustered by recursive
 * bisection), for one source, with the audio onsets alongside when the source has
 * them. What the renderer shows is the gap between the two: every audio hit with no
 * stroke near it is a hit the wrists did not see.
 *
 * Writes `{id, fps, strokes: [{t, wrist, drum, x, y}], clusters, onsets?, lag?, f70?, f70Lagged?}`.
 *
 * Usage:
 *   npx vite-node scripts/demos/drum_strokes_timeline.ts --id <source id or local stem> [--min-noise 12] [--out FILE]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fMeasure } from '@/ictus/metrics';
import { airDir, dataRoot } from '../air/lib_air_paths';
import { readLandmarks } from '../air/lib_chord_shape_dataset';
import { assignStrokes, median, strokesOf, timingErrors } from '../air/lib_drum_strokes';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const id = arg('id', '');
if (!id) throw new Error('--id is required');
const minNoise = Number(arg('min-noise', '12'));
const out = arg('out', join(dataRoot(), 'demos', 'drums', `${id}.strokes.json`));

const records = readLandmarks(join(airDir('landmarks', 'drums'), `${id}.pose.ndjson`));
const fps = records.length > 1 ? (records.length - 1) / (records[records.length - 1].t - records[0].t) : 30;
const strokes = strokesOf(records, { minAmplitudeNoiseUnits: minNoise });
const clusters = assignStrokes(strokes);

const doc: Record<string, unknown> = {
  id,
  fps,
  strokes: strokes.map((s) => ({ t: s.t, wrist: s.wrist, drum: s.drum ?? null, x: s.x, y: s.y })),
  clusters,
};
const onsetsPath = join(airDir('labels', 'drums'), `${id}.onsets.json`);
if (existsSync(onsetsPath)) {
  const onsets = (JSON.parse(readFileSync(onsetsPath, 'utf8')) as { onsets: number[] }).onsets;
  const est = strokes.map((s) => s.t);
  const lag = median(timingErrors(onsets, est, 0.1));
  Object.assign(doc, {
    onsets,
    lag,
    f70: fMeasure(onsets, est, 0.07),
    f70Lagged: Number.isFinite(lag) ? fMeasure(onsets, est.map((t) => t - lag), 0.07) : null,
  });
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc));
const pct = (x: unknown) => (typeof x === 'number' ? `${(100 * x).toFixed(1)}%` : '-');
console.log(
  `${id}: ${strokes.length} strokes (L ${strokes.filter((s) => s.wrist === 'left').length} / R ${strokes.filter((s) => s.wrist === 'right').length}), drums L+R ${clusters.filter((c) => c.wrist === 'left').length}+${clusters.filter((c) => c.wrist === 'right').length}` +
    (doc.onsets ? `, onsets ${(doc.onsets as number[]).length}, lag ${(1000 * (doc.lag as number)).toFixed(0)} ms, F@70 ${pct(doc.f70)} / lag-corrected ${pct(doc.f70Lagged)}` : '') +
    ` -> ${out}`,
);
