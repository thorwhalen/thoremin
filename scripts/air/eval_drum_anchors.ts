/**
 * Which point on the hand should the air drum track? (#246) Scored on the `an.impacts`
 * stick clips, where the truth is exact: a synthetic hand grips each clip's stick
 * (`lib_synthetic_grip.ts`), the shipped `air-drum` node is replayed over it once per
 * tracked point (`packages/sdk/src/nodes/music/drum_anchor.ts`), and its hits are matched to the
 * clip's ground-truth impacts.
 *
 * Swept: the tracked point (wrist, index fingertip, estimated stick tip), the arm's
 * share of the stroke (0 = a pure wrist stroke, the roll §7.3 of the research doc says
 * the pose wrist misses; larger = the whole-arm air drummer), and landmark noise in grip
 * lengths. Only the `timing: exact` clips are used: the node is replayed on the tick
 * clock, so a clip whose frames were captured off the grid would be scored on a clock it
 * was not captured on.
 *
 * Scores, per cell: recall (truth impacts that got a hit within 120 ms), precision (hits
 * that matched one), the share of matched hits that were PREDICTED ahead of the impact
 * (rather than sounded late on confirmation), and the median and 90th-percentile
 * absolute error of the sounded time against the executed impact.
 *
 * Usage:
 *   npx vite-node scripts/air/eval_drum_anchors.ts [--set DIR] [--arm 0,0.25,1] [--noise 0,0.02,0.05] [--min-lead 0.03]
 *
 * Writes `anchors.results.json` under the drum results dir (local, never committed) and
 * prints a Markdown table.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { replayNode } from '@thoremin/dag';
import { airDrumNode, type DrumHit } from '@thoremin/ext-air/nodes/air_drum';
import { DRUM_ANCHOR_POINTS, type DrumAnchorPoint } from '@thoremin/sdk/nodes/music/drum_anchor';
import { airDir } from './lib_air_paths';
import { gripFrames, parseStickClip } from './lib_synthetic_grip';
import { median } from './lib_drum_strokes';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const nums = (s: string) => s.split(',').map(Number);

const SET = arg('set', join(homedir(), '.local', 'share', 'thoremin', 'synthetic', 'bench-v2'));
const ARMS = nums(arg('arm', '0,0.25,1'));
const NOISES = nums(arg('noise', '0,0.02,0.05'));
const MIN_LEAD = Number(arg('min-lead', '0.03'));
/** A hit further than this from every truth impact is spurious (the sub-frame scorer's window). */
const MATCH_WINDOW = 0.12;

interface IndexClip {
  clip: string;
  axes: { object: string; kind: string; fps: number; exposure: number; timing: string; seed: number };
}
interface Truth {
  events: { t_impact: number }[];
}

export interface CellScore {
  events: number;
  hits: number;
  matched: number;
  predicted: number;
  errors: number[];
}

/** One-to-one nearest matching of hits to truth impacts within the window. */
export function matchHits(truth: readonly number[], hits: readonly DrumHit[], window = MATCH_WINDOW): { matched: number; predicted: number; errors: number[] } {
  const used = new Set<number>();
  let matched = 0;
  let predicted = 0;
  const errors: number[] = [];
  for (const h of [...hits].sort((a, b) => a.t - b.t)) {
    let best = -1;
    let bestD = Infinity;
    truth.forEach((t, i) => {
      const d = Math.abs(h.t - t);
      if (!used.has(i) && d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0 || bestD > window) continue;
    used.add(best);
    matched += 1;
    if (h.predicted) predicted += 1;
    errors.push(h.t - truth[best]);
  }
  return { matched, predicted, errors };
}

async function main() {
  const indexPath = join(SET, 'index.json');
  if (!existsSync(indexPath)) {
    console.error(`no clip set at ${SET}; generate one with scripts/subframe/gen_clip_sets.py`);
    process.exit(1);
  }
  const clips = (JSON.parse(readFileSync(indexPath, 'utf8')) as { clips: IndexClip[] }).clips.filter(
    (c) => c.axes.object === 'stick' && c.axes.timing === 'exact',
  );
  const cells = new Map<string, CellScore>();
  const key = (kind: string, arm: number, noise: number, point: DrumAnchorPoint) => `${kind}|${arm}|${noise}|${point}`;
  for (const c of clips) {
    const dir = join(SET, c.clip);
    const truth = (JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth).events.map((e) => e.t_impact);
    const poses = parseStickClip(readFileSync(join(dir, 'keypoints.ndjson'), 'utf8'));
    for (const arm of ARMS) {
      for (const noise of NOISES) {
        const frames = gripFrames(poses, { arm, noise, seed: c.axes.seed + 1 });
        for (const point of DRUM_ANCHOR_POINTS) {
          const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, point, minLead: MIN_LEAD }));
          const outs = await replayNode(h, { hands: frames }, { dt: 1 / c.axes.fps });
          const hits = outs.flatMap((o) => o.hits as DrumHit[]);
          const m = matchHits(truth, hits);
          const k = key(c.axes.kind, arm, noise, point);
          const cell = cells.get(k) ?? { events: 0, hits: 0, matched: 0, predicted: 0, errors: [] };
          cell.events += truth.length;
          cell.hits += hits.length;
          cell.matched += m.matched;
          cell.predicted += m.predicted;
          cell.errors.push(...m.errors);
          cells.set(k, cell);
        }
      }
    }
    console.error(`${c.clip}: done`);
  }

  const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
  const ms = (x: number) => (Number.isFinite(x) ? (1000 * x).toFixed(1) : '');
  const p90 = (xs: number[]) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(0.9 * s.length))];
  };
  const rows: Record<string, unknown>[] = [];
  const lines = [
    '| stroke | arm share | noise (grip lengths) | point | recall | precision | predicted | median abs error ms | p90 abs error ms |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const kind of ['air', 'surface']) {
    for (const arm of ARMS) {
      for (const noise of NOISES) {
        for (const point of DRUM_ANCHOR_POINTS) {
          const cell = cells.get(key(kind, arm, noise, point));
          if (!cell) continue;
          const abs = cell.errors.map(Math.abs);
          const row = {
            kind,
            arm,
            noise,
            point,
            recall: cell.matched / Math.max(1, cell.events),
            precision: cell.hits ? cell.matched / cell.hits : 0,
            predicted: cell.matched ? cell.predicted / cell.matched : 0,
            medianAbs: median(abs),
            p90Abs: p90(abs),
            medianSigned: median(cell.errors),
            events: cell.events,
            hits: cell.hits,
          };
          rows.push(row);
          // The arm's share of the stroke: the hand travels arm/(1+arm) of the tip's path.
          const share = arm / (1 + arm);
          lines.push(
            `| ${kind} | ${pct(share)} | ${noise} | ${point} | ${pct(row.recall)} | ${pct(row.precision)} | ${pct(row.predicted)} | ${ms(row.medianAbs)} | ${ms(row.p90Abs)} |`,
          );
        }
      }
    }
  }
  const resDir = airDir('results', 'drums');
  mkdirSync(resDir, { recursive: true });
  writeFileSync(join(resDir, 'anchors.results.json'), JSON.stringify({ set: SET, minLead: MIN_LEAD, clips: clips.length, rows }, null, 1));
  console.log(`${clips.length} stick clips (timing exact), minLead ${MIN_LEAD * 1000} ms\n`);
  console.log(lines.join('\n'));
}

main();
