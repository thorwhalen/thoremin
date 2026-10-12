/**
 * The conducting fixtures' beat-tracking numbers, as one table: what the ictus
 * detector (through the facade) scores on `test/fixtures/conducting_{44,34,24}` at the
 * recorded 30 fps and decimated to 15 fps (every other frame, the slow-laptop regime),
 * with the mean confirmation latency (the confirming sample's time past the anchor's).
 *
 *   npx vite-node scripts/ictus/conducting_metrics.ts [--prefilter spikes|median|none] [--detector '{"reversalFraction":0.03}']
 *
 * Exists so a change to the detector can be measured before and after on the same
 * fixtures and the same metrics the suite asserts (#231's acceptance is "F-measure and
 * CMLt unchanged within 0.01, also at 15 fps"); the suite's bounds are loose by design
 * and would not show a 0.02 shift. Prints Markdown; nothing is written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { continuity, createIctus, fMeasure, fitGrid, type DetectorOptions, type Sample } from '@thoremin/ictus';
import { FIXTURES, loadStream } from '../../test/helpers/fixtures';

interface HandLike {
  handedness: string;
  keypoints: { x: number; y: number }[];
}
interface FrameLike {
  height: number;
  hands: HandLike[];
}
interface Meta {
  statedBpm: number;
  fps: number;
}

const SCENARIOS = ['conducting_44', 'conducting_34', 'conducting_24'];
/** The decimation factors scored: 1 (as recorded, 30 fps) and 2 (15 fps). */
const DECIMATIONS = [1, 2];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function load(scenario: string): { samples: Sample[]; meta: Meta } {
  const frames = loadStream(scenario, 'src.hands') as FrameLike[];
  const meta = JSON.parse(readFileSync(join(FIXTURES, scenario, 'meta.json'), 'utf8')) as Meta;
  const samples: Sample[] = [];
  frames.forEach((f, i) => {
    if (!f.hands.length) return;
    const hand = f.hands.find((h) => h.handedness === 'Right') ?? f.hands[0];
    const wrist = hand.keypoints[0];
    samples.push({ t: i / meta.fps, x: wrist.x / f.height, y: wrist.y / f.height });
  });
  return { samples, meta };
}

/** Keep every `factor`-th camera frame (by frame index, so a dropped frame stays dropped). */
function decimate(samples: Sample[], fps: number, factor: number): Sample[] {
  return samples.filter((s) => Math.round(s.t * fps) % factor === 0);
}

function anchors(samples: Sample[], detector: DetectorOptions): { times: number[]; latency: number } {
  const ictus = createIctus({ detector });
  const times: number[] = [];
  let lag = 0;
  for (const s of samples) {
    const st = ictus.feed(s);
    if (st.anchor) {
      times.push(st.anchor.t);
      lag += s.t - st.anchor.t;
    }
  }
  return { times, latency: times.length ? lag / times.length : NaN };
}

const prefilter = arg('prefilter', '') as DetectorOptions['prefilter'] | '';
/** Any other detector option, as JSON (an ablation knob; nothing here is shipped). */
const detector: DetectorOptions = { ...(JSON.parse(arg('detector', '{}')) as DetectorOptions), ...(prefilter ? { prefilter } : {}) };
const f = (x: number) => x.toFixed(3);

console.log(`| fixture | fps | anchors | F (17.5%) | F (30%) | F (70 ms) | CMLt | confirm latency (ms) |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const scenario of SCENARIOS) {
  const { samples, meta } = load(scenario);
  const period = 60 / meta.statedBpm;
  for (const factor of DECIMATIONS) {
    const { times, latency } = anchors(decimate(samples, meta.fps, factor), detector);
    const fit = fitGrid(times, meta.statedBpm, times[0], times[times.length - 1] + 1e-6);
    const row = [
      scenario,
      String(meta.fps / factor),
      String(times.length),
      f(fMeasure(fit.grid, times, 0.175 * period)),
      f(fMeasure(fit.grid, times, 0.3 * period)),
      f(fit.fMeasure),
      f(continuity(fit.grid, times)),
      (1000 * latency).toFixed(0),
    ];
    console.log(`| ${row.join(' | ')} |`);
  }
}
