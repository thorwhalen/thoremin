/**
 * Decompose the impact predictor's AIR error into the parts it is built from (#352).
 *
 *   npx vite-node scripts/subframe/decompose.ts [--set DIR] [--min-lead 0.03,0.077]
 *                                               [--predict-opts '<json>']
 *
 * A prediction is `commit crossing + lag`, and the lag is learned as `reference -
 * confirmation crossing` (for an air stroke the reference is the three-sample vertex,
 * `airReference: 'vertex'`, the default). So, per confirmed prediction, the error against the true
 * impact splits into three parts that add up to it:
 *
 * - `commitX - confX`: how far the crossing extrapolated at the commit sits from the
 *   one the confirmation fits; it moves with the lead (the fit is extrapolated further).
 * - `ref - T`: the reference's own bias against the true impact (the three-sample
 *   vertex is late on a sharp-arrival, slow-departure turn).
 * - `lag - (ref - confX)`: the learned lag against this stroke's reference offset (the
 *   EW average trails the strokes it learned from).
 *
 * Air strokes only: a surface stroke's reference (the kink) is fitted after the
 * confirmation and is not on any event. Native rates only, noise 0: the decomposition is about the bias, and
 * the scorer (`score.ts`) is the one place the full columns are measured.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createImpactPredictor, type ImpactPredictorOptions } from '@thoremin/ictus/impact';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const SET = arg('set', join(homedir(), '.local', 'share', 'thoremin', 'synthetic', 'bench-v2'));
const MIN_LEADS = arg('min-lead', '0.03,0.077').split(',').map(Number);
const PREDICT_OPTS = JSON.parse(arg('predict-opts', '{}')) as ImpactPredictorOptions;
/** A confirmation further than this from every truth event is not matched (seconds). */
const MATCH_WINDOW = 0.12;

interface Part {
  fps: number;
  err: number;
  commitOffset: number;
  referenceBias: number;
  lagTrail: number;
  lead: number;
}

function decompose(minLead: number): Part[] {
  const index = JSON.parse(readFileSync(join(SET, 'index.json'), 'utf8')) as { clips: { clip: string; axes: Record<string, string | number> }[] };
  const parts: Part[] = [];
  for (const c of index.clips) {
    if (c.axes.kind !== 'air' || !existsSync(join(SET, c.clip, 'truth.json'))) continue;
    const truth = JSON.parse(readFileSync(join(SET, c.clip, 'truth.json'), 'utf8')) as { objects: { name: string; impact_keypoint: string }[]; events: { t_impact: number }[] };
    const obj = truth.objects[0];
    const pred = createImpactPredictor({ minAmplitude: 12, ...PREDICT_OPTS, minLead });
    const commits = new Map<number, { crossing: number; lag: number; lead: number }>();
    for (const line of readFileSync(join(SET, c.clip, 'keypoints.ndjson'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line) as { t: number; value: { keypoints: { object: string; name: string; x: number; y: number }[] } };
      const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint);
      if (!p) continue;
      const lag = pred.lag();
      for (const e of pred.push({ t: rec.t, x: p.x, y: p.y })) {
        if (e.kind === 'predict') {
          commits.set(e.t, { crossing: e.crossing, lag, lead: e.lead });
          continue;
        }
        const commit = e.predicted === null ? undefined : commits.get(e.predicted);
        if (!commit || !Number.isFinite(commit.crossing) || !Number.isFinite(e.crossing)) continue;
        const T = truth.events.reduce((b, x) => (Math.abs(x.t_impact - e.t) < Math.abs(b.t_impact - e.t) ? x : b)).t_impact;
        if (Math.abs(T - e.t) > MATCH_WINDOW) continue;
        const ref = e.vertex;
        parts.push({
          fps: Number(c.axes.fps),
          err: e.predicted! - T,
          commitOffset: commit.crossing - e.crossing,
          referenceBias: ref - T,
          lagTrail: commit.lag - (ref - e.crossing),
          lead: commit.lead,
        });
      }
    }
  }
  return parts;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const cell = (xs: number[]) => `${(mean(xs) * 1000).toFixed(1)} ± ${(sd(xs) * 1000).toFixed(1)}`;

console.log(`# The predictor's air error, decomposed (${SET})\n`);
console.log('mean ± sd, ms; the three parts add up to the error.\n');
console.log('| fps | minLead | n | error | commitX - confX | ref - T | lag - (ref - confX) | lead |');
console.log('|---|---|---|---|---|---|---|---|');
for (const minLead of MIN_LEADS) {
  const parts = decompose(minLead);
  for (const fps of [...new Set(parts.map((p) => p.fps))].sort((a, b) => a - b)) {
    const r = parts.filter((p) => p.fps === fps);
    const col = (k: keyof Part) => cell(r.map((p) => p[k]));
    console.log(`| ${fps} | ${minLead} | ${r.length} | ${col('err')} | ${col('commitOffset')} | ${col('referenceBias')} | ${col('lagTrail')} | ${col('lead')} |`);
  }
}
