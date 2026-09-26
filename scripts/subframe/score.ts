/**
 * Score the sub-frame impact estimators on an `an.impacts` clip set.
 *
 *   npx vite-node scripts/subframe/score.ts [--set DIR] [--noise 0,1,2] [--min-lead 0,0.03,0.06]
 *                                           [--magnetism 0.5,1] [--out results.json] [--limit N]
 *
 * For every clip (see `gen_clip_sets.py`) the impact keypoint's observation stream is
 * read from `keypoints.ndjson`, optionally corrupted with seeded Gaussian tracker
 * noise, and fed causally to each estimator. Estimates are matched to the ground
 * truth events in `truth.json` (nearest within a window; the rest are misses and
 * spurious events) and scored three ways, one per objective of
 * `docs/research/intent-and-subframe-timing.md` §3:
 *
 * - **actuality**: estimate minus `t_impact` (the executed impact time);
 * - **intent**: estimate minus `t_grid` (the intended grid time);
 * - **lead**: `t_impact` minus the sample time the estimate was committed at — how
 *   early the instrument could have sounded it. A frame-snapped detector commits one
 *   frame AFTER the impact frame (negative lead); a predictor commits before it.
 *
 * Estimators:
 *
 * - `lowest`       — the frame-snapped baseline: the shipped ictus detector with its
 *                    sub-frame refinement OFF (the deepest sample's own time, confirmed
 *                    by the sample after it; median filter off). The bar to beat.
 * - `parabola`     — the shipped ictus detector as shipped (turning mode, median
 *                    filter on: one more frame of latency, one-frame spikes removed).
 * - `parabolaRaw`  — the same with the median filter off.
 * - `confirm`      — `createImpactPredictor`'s post-hoc `confirm` (crossing + lag).
 * - `predict`      — its committed PREDICTION, one per stroke, per `minLead`; the floor
 *                    learned (`auto` mode).
 * - `predictKnown` — the same on surface clips with the contact plane GIVEN (a
 *                    calibrated table).
 * - `sounded`      — what the instrument would play: the prediction when there was
 *                    one, else the confirmation (late).
 * - `grid:<prior>` — the rhythm prior's nearest expected beat at the prediction (the
 *                    pure intent estimate); priors: `osc` (the adaptive oscillator)
 *                    and `trend` (the least-squares tempo trend).
 * - `magnet<m>:<prior>` — the prediction pulled toward that grid by magnetism `m`: its
 *                    "vs grid" column is how close what the instrument SOUNDS lands to
 *                    the intended time, its actuality column what that cost.
 *
 * Output: a JSON file with every matched record and per-cell aggregates, and a
 * Markdown summary printed to stdout and written next to the JSON. Everything lands
 * under the set directory, which is never committed.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createAdaptiveOscillator, createIctusDetector, type Anchor, type RhythmPrior, type Sample } from '@/ictus';
import { createImpactPredictor, type ImpactEvent, type ImpactPredictorOptions } from '@/ictus/impact';
import { magnetise } from '@/ictus/magnet';
import { createTrendPrior } from '@/ictus/trend_prior';

// ---- CLI ----------------------------------------------------------------------

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const list = (s: string) => s.split(',').map(Number);

const SET = arg('set', join(homedir(), '.local', 'share', 'thoremin', 'synthetic', 'bench-v2'));
const NOISES = list(arg('noise', '0,1,2'));
const MIN_LEADS = list(arg('min-lead', '0,0.03,0.06'));
const MAGNETISMS = list(arg('magnetism', '0.5'));
const LIMIT = Number(arg('limit', '0'));
const OUT = arg('out', join(SET, 'results.json'));
/** An estimate further than this from every truth event is spurious (seconds). */
const MATCH_WINDOW = 0.12;
/** The rhythm priors scored on the intent axis: the shipped oscillator, the same with
 *  a faster period memory, and the trend prior at two memories and two orders. */
const PRIORS: Record<string, () => RhythmPrior> = {
  osc: () => createAdaptiveOscillator({ initialTempo: 100 }),
  oscFast: () => createAdaptiveOscillator({ initialTempo: 100, periodMemory: 0.7, periodGain: 0.7 }),
  trend6q: () => createTrendPrior({ memory: 6, quadraticAfter: 4 }),
  trend12q: () => createTrendPrior({ memory: 12, quadraticAfter: 5 }),
  trend12l: () => createTrendPrior({ memory: 12, quadraticAfter: Infinity }),
  trend4l: () => createTrendPrior({ memory: 4, quadraticAfter: Infinity }),
};

// ---- Clip loading -------------------------------------------------------------

interface TruthEvent {
  index: number;
  t_grid: number;
  t_impact: number;
  kind: 'surface' | 'air';
  amplitude: number;
  impact_xy: [number, number];
  frames: { lowest_error: number; nearest_error: number };
}
interface Truth {
  spec: { object: string; kind: string; fps: number; exposure: number; timestamp_jitter_sd: number; timestamp_noise_sd: number; timestamps: string; seed: number };
  objects: { name: string; impact_keypoint: string }[];
  events: TruthEvent[];
  clip: { duration: number; fps: number; frame_count: number };
}
interface Clip {
  name: string;
  axes: Record<string, string | number>;
  truth: Truth;
  /** The impact keypoint's observations. */
  samples: Sample[];
}

function loadClip(dir: string, name: string, axes: Record<string, string | number>): Clip {
  const truth = JSON.parse(readFileSync(join(dir, name, 'truth.json'), 'utf8')) as Truth;
  const obj = truth.objects[0];
  const samples: Sample[] = [];
  for (const line of readFileSync(join(dir, name, 'keypoints.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { t: number; value: { keypoints: { object: string; name: string; x: number; y: number }[] } };
    const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint);
    if (p) samples.push({ t: rec.t, x: p.x, y: p.y });
  }
  return { name, axes, truth, samples };
}

function loadSet(dir: string): Clip[] {
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { clips: { clip: string; axes: Record<string, string | number> }[] };
  const clips = index.clips.filter((c) => existsSync(join(dir, c.clip, 'truth.json')));
  return (LIMIT > 0 ? clips.slice(0, LIMIT) : clips).map((c) => loadClip(dir, c.clip, c.axes));
}

// ---- Noise --------------------------------------------------------------------

/** mulberry32: a small seeded PRNG, deterministic per clip and noise level. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(next: () => number): number {
  const u = Math.max(1e-12, next());
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function withNoise(samples: Sample[], sd: number, seed: number): Sample[] {
  if (!(sd > 0)) return samples;
  const next = rng(seed);
  return samples.map((s) => ({ t: s.t, x: s.x + sd * gaussian(next), y: s.y + sd * gaussian(next) }));
}

// ---- Estimators ---------------------------------------------------------------

/** One estimate: the time it claims, and the sample time it was committed at. */
interface Estimate {
  t: number;
  at: number;
  /** For the magnet family: the prior's grid time (the intent estimate). */
  grid?: number;
}

/** The shipped ictus detector, with options. */
function detector(samples: Sample[], opts: Parameters<typeof createIctusDetector>[0]): Estimate[] {
  const det = createIctusDetector({ initialPeriod: 0.5, ...opts });
  const out: Estimate[] = [];
  for (const s of samples) {
    const a = det.push(s);
    if (a) out.push({ t: a.t, at: s.t });
  }
  return out;
}

interface PredictorRun {
  predictions: Estimate[];
  confirmations: Estimate[];
  sounded: Estimate[];
  /** Per prior name, per magnetism: the pulled prediction, with the grid. */
  magnet: Map<string, Map<number, Estimate[]>>;
  grid: Map<string, Estimate[]>;
  kinds: ('surface' | 'air' | null)[];
}

function runPredictor(samples: Sample[], opts: ImpactPredictorOptions, magnetisms: number[], priors: Record<string, () => RhythmPrior>): PredictorRun {
  const pred = createImpactPredictor(opts);
  const live = Object.fromEntries(Object.entries(priors).map(([k, mk]) => [k, mk()]));
  const names = Object.keys(live);
  const run: PredictorRun = {
    predictions: [],
    confirmations: [],
    sounded: [],
    magnet: new Map(names.map((n) => [n, new Map(magnetisms.map((m) => [m, []]))])),
    grid: new Map(names.map((n) => [n, []])),
    kinds: [],
  };
  for (const s of samples) {
    const events: ImpactEvent[] = pred.push(s);
    for (const n of names) live[n].advance(s.t);
    for (const e of events) {
      if (e.kind === 'predict') {
        run.predictions.push({ t: e.t, at: e.at });
        run.sounded.push({ t: e.t, at: e.at });
        for (const n of names) {
          const state = live[n].state();
          for (const m of magnetisms) {
            const r = magnetise(e.t, state, m);
            run.magnet.get(n)!.get(m)!.push({ t: r.t, at: e.at, grid: r.grid });
          }
          const g = magnetise(e.t, state, 0).grid;
          if (Number.isFinite(g)) run.grid.get(n)!.push({ t: g, at: e.at });
        }
      } else {
        run.confirmations.push({ t: e.t, at: e.at });
        if (e.predicted === null) run.sounded.push({ t: e.t, at: e.at });
        const anchor: Anchor = { t: e.t, confidence: e.confidence, strength: e.strength, sharpness: NaN, lateral: 0 };
        for (const n of names) live[n].update(anchor);
        if (names.length) pred.setPeriod(live[names[0]].state().period);
        run.kinds.push(pred.lastKind());
      }
    }
  }
  return run;
}

// ---- Scoring ------------------------------------------------------------------

interface Record_ {
  clip: string;
  estimator: string;
  noise: number;
  minLead: number;
  event: number;
  /** ms */
  errImpact: number;
  errGrid: number;
  lead: number;
}
interface CellStats {
  n: number;
  events: number;
  missed: number;
  spurious: number;
  mean: number;
  sd: number;
  mae: number;
  p95: number;
  meanGrid: number;
  maeGrid: number;
  meanLead: number;
  minLead: number;
}

function match(events: TruthEvent[], estimates: Estimate[]): { pairs: { e: TruthEvent; est: Estimate }[]; missed: number; spurious: number } {
  const used = new Set<number>();
  const pairs: { e: TruthEvent; est: Estimate }[] = [];
  let missed = 0;
  for (const e of events) {
    let best = -1;
    let bestD = MATCH_WINDOW;
    estimates.forEach((est, i) => {
      if (used.has(i)) return;
      const d = Math.abs(est.t - e.t_impact);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      pairs.push({ e, est: estimates[best] });
    } else missed++;
  }
  return { pairs, missed, spurious: estimates.length - used.size };
}

const ms = (s: number) => 1000 * s;
function stats(records: Record_[], events: number, missed: number, spurious: number): CellStats {
  const n = records.length;
  const errs = records.map((r) => r.errImpact);
  const mean = errs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n));
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const grid = records.map((r) => r.errGrid);
  const leads = records.map((r) => r.lead);
  return {
    n,
    events,
    missed,
    spurious,
    mean,
    sd,
    mae: abs.reduce((a, b) => a + b, 0) / Math.max(1, n),
    p95: abs[Math.min(abs.length - 1, Math.floor(0.95 * abs.length))] ?? NaN,
    meanGrid: grid.reduce((a, b) => a + b, 0) / Math.max(1, n),
    maeGrid: grid.map(Math.abs).reduce((a, b) => a + b, 0) / Math.max(1, n),
    meanLead: leads.reduce((a, b) => a + b, 0) / Math.max(1, n),
    minLead: leads.length ? Math.min(...leads) : NaN,
  };
}

// ---- Main ---------------------------------------------------------------------

const clips = loadSet(SET);
console.error(`${clips.length} clips from ${SET}`);

const records: Record_[] = [];
const tallies = new Map<string, { events: number; missed: number; spurious: number }>();
const kindHits = { total: 0, right: 0 };

function score(clip: Clip, estimator: string, noise: number, minLead: number, estimates: Estimate[]) {
  const { pairs, missed, spurious } = match(clip.truth.events, estimates);
  const key = JSON.stringify({ clip: clip.name, estimator, noise, minLead });
  tallies.set(key, { events: clip.truth.events.length, missed, spurious });
  for (const { e, est } of pairs) {
    records.push({
      clip: clip.name,
      estimator,
      noise,
      minLead,
      event: e.index,
      errImpact: ms(est.t - e.t_impact),
      errGrid: ms(est.t - e.t_grid),
      lead: ms(e.t_impact - est.at),
    });
  }
}

const BASELINES = ['lowest', 'parabola', 'parabolaRaw'];
const PREDICTOR_FAMILY = ['confirm', 'predict', 'predictKnown', 'sounded'];
const PRIOR_FAMILY = Object.keys(PRIORS).flatMap((p) => [`grid:${p}`, ...MAGNETISMS.map((m) => `magnet${m}:${p}`)]);

for (const clip of clips) {
  for (const noise of NOISES) {
    const samples = withNoise(clip.samples, noise, hash(clip.name) ^ Math.round(noise * 1000));
    score(clip, 'lowest', noise, 0, detector(samples, { refine: false, medianFilter: false }));
    score(clip, 'parabola', noise, 0, detector(samples, {}));
    score(clip, 'parabolaRaw', noise, 0, detector(samples, { medianFilter: false }));
    for (const minLead of MIN_LEADS) {
      const run = runPredictor(samples, { minLead }, MAGNETISMS, PRIORS);
      score(clip, 'predict', noise, minLead, run.predictions);
      score(clip, 'confirm', noise, minLead, run.confirmations);
      score(clip, 'sounded', noise, minLead, run.sounded);
      for (const p of Object.keys(PRIORS)) {
        score(clip, `grid:${p}`, noise, minLead, run.grid.get(p)!);
        for (const m of MAGNETISMS) score(clip, `magnet${m}:${p}`, noise, minLead, run.magnet.get(p)!.get(m)!);
      }
      if (minLead === MIN_LEADS[0]) {
        for (const k of run.kinds) {
          if (k === null) continue;
          kindHits.total++;
          if (k === clip.truth.spec.kind) kindHits.right++;
        }
      }
      // The known-plane variant for surface clips (a calibrated table): the contact
      // level is the impact keypoint's y at contact, read from the truth.
      if (clip.truth.spec.kind === 'surface' && clip.truth.events.length) {
        const level = clip.truth.events[0].impact_xy[1];
        const known = runPredictor(samples, { minLead, level, mode: 'surface' }, [], {});
        score(clip, 'predictKnown', noise, minLead, known.predictions);
      }
    }
  }
}

// ---- Aggregation --------------------------------------------------------------

type Axis = 'kind' | 'fps' | 'exposure' | 'timing' | 'object';
const axesOf = (clipName: string) => clips.find((c) => c.name === clipName)!.axes;

function aggregate(filter: (r: Record_) => boolean, group: (r: Record_) => string): Map<string, CellStats> {
  const groups = new Map<string, Record_[]>();
  for (const r of records) {
    if (!filter(r)) continue;
    const g = group(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  const out = new Map<string, CellStats>();
  for (const [g, rs] of groups) {
    let events = 0, missed = 0, spurious = 0;
    const seen = new Set<string>();
    for (const r of rs) {
      const key = JSON.stringify({ clip: r.clip, estimator: r.estimator, noise: r.noise, minLead: r.minLead });
      if (seen.has(key)) continue;
      seen.add(key);
      const t = tallies.get(key)!;
      events += t.events;
      missed += t.missed;
      spurious += t.spurious;
    }
    out.set(g, stats(rs, events, missed, spurious));
  }
  return out;
}

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
function table(title: string, rows: Map<string, CellStats>, keyHeader = 'cell'): string {
  const lines = [`### ${title}`, '', `| ${keyHeader} | n | mean (ms) | sd (ms) | MAE (ms) | p95 (ms) | vs grid MAE (ms) | mean lead (ms) | missed | spurious |`, '|---|---|---|---|---|---|---|---|---|---|'];
  for (const [k, s] of rows) {
    lines.push(`| ${k} | ${s.n} | ${fmt(s.mean)} | ${fmt(s.sd)} | ${fmt(s.mae)} | ${fmt(s.p95)} | ${fmt(s.maeGrid)} | ${fmt(s.meanLead)} | ${s.missed}/${s.events} | ${s.spurious} |`);
  }
  return lines.join('\n') + '\n';
}

const minLeadOf = (est: string, ml: number) => (BASELINES.includes(est) ? 0 : ml);
const byAxis = (estimator: string, noise: number, minLead: number, axis: Axis) =>
  aggregate((r) => r.estimator === estimator && r.noise === noise && r.minLead === minLeadOf(estimator, minLead), (r) => String(axesOf(r.clip)[axis]));
const ML = MIN_LEADS[Math.min(1, MIN_LEADS.length - 1)];

const md: string[] = [`# Sub-frame impact estimators on \`${SET.split('/').pop()}\``, '', `${clips.length} clips; noise ${NOISES.join('/')} px; minLead ${MIN_LEADS.join('/')} s; magnetism ${MAGNETISMS.join('/')}. Errors are estimate minus truth in ms (negative = early); "vs grid" is against the INTENDED grid time; lead is impact minus commit time (negative = after the fact).`, ''];

// 1. Headline: every estimator by kind, at each noise level, one minLead.
for (const noise of NOISES) {
  const rows = new Map<string, CellStats>();
  for (const est of [...BASELINES, ...PREDICTOR_FAMILY, ...PRIOR_FAMILY]) {
    for (const [k, s] of byAxis(est, noise, ML, 'kind')) rows.set(`${est} / ${k}`, s);
  }
  md.push(table(`Noise ${noise} px, minLead ${ML} s — by estimator and kind (all fps, shutters, timings, objects)`, rows, 'estimator / kind'));
}
// 2. The prediction by minLead.
{
  const rows = new Map<string, CellStats>();
  for (const ml of MIN_LEADS) for (const est of ['predict', 'sounded']) for (const [k, s] of byAxis(est, NOISES[0], ml, 'kind')) rows.set(`${est} minLead=${ml} / ${k}`, s);
  md.push(table(`Noise ${NOISES[0]} px — the prediction by required lead`, rows, 'estimator / kind'));
}
// 3. By fps, exposure, timing, object.
for (const axis of ['fps', 'exposure', 'timing', 'object'] as Axis[]) {
  const rows = new Map<string, CellStats>();
  for (const est of ['lowest', 'parabola', 'predict', 'predictKnown', 'sounded']) for (const [k, s] of byAxis(est, NOISES[0], ML, axis)) rows.set(`${est} / ${k}`, s);
  md.push(table(`By ${axis} — noise ${NOISES[0]} px, minLead ${ML} s`, rows, `estimator / ${axis}`));
}
md.push(`Stroke kind classified correctly by the predictor (auto mode, noise ${NOISES[0]} px): ${kindHits.right}/${kindHits.total}.`, '');

const summary = md.join('\n');
const cells: Record<string, CellStats> = {};
for (const noise of NOISES) for (const est of [...BASELINES, ...PREDICTOR_FAMILY, ...PRIOR_FAMILY]) for (const ml of MIN_LEADS) for (const axis of ['kind', 'fps', 'exposure', 'timing', 'object'] as Axis[]) for (const [k, s] of byAxis(est, noise, ml, axis)) cells[`${est}|noise=${noise}|minLead=${minLeadOf(est, ml)}|${axis}=${k}`] = s;
writeFileSync(OUT, JSON.stringify({ set: SET, noises: NOISES, minLeads: MIN_LEADS, magnetisms: MAGNETISMS, clips: clips.map((c) => ({ name: c.name, axes: c.axes })), kindHits, cells, records }, null, 0));
writeFileSync(OUT.replace(/\.json$/, '.md'), summary);
console.log(summary);
console.error(`wrote ${OUT}`);
