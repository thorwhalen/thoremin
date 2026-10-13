/**
 * The conducting fixtures' beat-tracking numbers, as one table: what the ictus
 * detector (through the facade) scores on `test/fixtures/conducting_{44,34,24}` at the
 * recorded 30 fps and decimated to 15 fps (every other frame, the slow-laptop regime),
 * with the mean confirmation latency (the confirming sample's time past the anchor's),
 * and what the follower makes of those anchors: the fraction of anchors it was
 * `running` at, its tempo at the last anchor, its state at the end of the clip (she
 * lowers her hands: `hold` is right) and the F-measure of its next-beat PREDICTIONS
 * against the stated grid (the four things `test/ictus_detector.test.ts` asserts of
 * the lock).
 *
 *   npx vite-node scripts/ictus/conducting_metrics.ts [--prior oscillator|trend|blend]
 *       [--prefilter spikes|median|none] [--detector '{"reversalFraction":0.03}']
 *       [--oscillator '{"lostPhaseError":0.45}'] [--trace]
 *
 * Exists so a change to the detector or the prior can be measured before and after on
 * the same fixtures and the same metrics the suite asserts (#231's acceptance is
 * "F-measure and CMLt unchanged within 0.01, also at 15 fps"; #232's is the 2/4 lock
 * restored with the 4/4 and 3/4 rows unchanged); the suite's bounds are loose by
 * design and would not show a 0.02 shift. `--trace` prints every anchor of every run
 * (its time, the interval, the follower's innovation and tempo) for reading why a
 * lock went. Prints Markdown; nothing is written.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  continuity,
  createIctus,
  fMeasure,
  fitGrid,
  nearestExpectedBeat,
  DEFAULT_RHYTHM_PRIOR,
  type DetectorOptions,
  type OscillatorOptions,
  type RhythmPriorKind,
  type Sample,
} from '@thoremin/ictus';
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
/** The prediction F-measure's tolerance, as the suite's: 30 % of a beat. */
const PREDICTION_TOLERANCE = 0.3;

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

interface Run {
  times: number[];
  latency: number;
  /** The follower's next-beat prediction at each anchor. */
  predicted: number[];
  runningFraction: number;
  tempoAtLast: number;
  endState: string;
}

function run(samples: Sample[], detector: DetectorOptions, prior: RhythmPriorKind, oscillator: OscillatorOptions, trace: string | null): Run {
  const ictus = createIctus({ detector, prior, oscillator });
  const times: number[] = [];
  const predicted: number[] = [];
  let lag = 0;
  let running = 0;
  let tempoAtLast = NaN;
  let last = ictus.state();
  for (const s of samples) {
    const before = ictus.state();
    last = ictus.feed(s);
    if (!last.anchor) continue;
    const a = last.anchor;
    times.push(a.t);
    lag += s.t - a.t;
    if (last.state === 'running') running++;
    if (Number.isFinite(last.nextBeatAt)) predicted.push(last.nextBeatAt);
    tempoAtLast = last.tempo;
    if (trace) {
      const grid = nearestExpectedBeat(before, a.t);
      const iai = times.length > 1 ? a.t - times[times.length - 2] : NaN;
      const innovation = Number.isFinite(grid) ? `${((a.t - grid) * 1000).toFixed(0).padStart(5)} ms` : '      - ';
      console.log(`  ${trace} #${String(times.length).padStart(2)} t=${a.t.toFixed(3)} iai=${iai.toFixed(3)} innov=${innovation} ${last.state.padEnd(7)} ${last.tempo.toFixed(1)} bpm conf=${last.confidence.toFixed(2)}`);
    }
  }
  return {
    times,
    latency: times.length ? lag / times.length : NaN,
    predicted,
    runningFraction: times.length ? running / times.length : NaN,
    tempoAtLast,
    endState: last.state,
  };
}

const prefilter = arg('prefilter', '') as DetectorOptions['prefilter'] | '';
/** Any other detector option, as JSON (an ablation knob; nothing here is shipped). */
const detector: DetectorOptions = { ...(JSON.parse(arg('detector', '{}')) as DetectorOptions), ...(prefilter ? { prefilter } : {}) };
const prior = arg('prior', DEFAULT_RHYTHM_PRIOR) as RhythmPriorKind;
/** Oscillator options (the blend's oscillator half too), as JSON. */
const oscillator = JSON.parse(arg('oscillator', '{}')) as OscillatorOptions;
const trace = process.argv.includes('--trace');
const f = (x: number) => x.toFixed(3);

console.log(`prior: ${prior}`);
console.log(`| fixture | fps | anchors | F (17.5%) | F (30%) | F (70 ms) | CMLt | confirm latency (ms) | running | tempo at last | end | predictions F (30%) |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
for (const scenario of SCENARIOS) {
  const { samples, meta } = load(scenario);
  const period = 60 / meta.statedBpm;
  for (const factor of DECIMATIONS) {
    const r = run(decimate(samples, meta.fps, factor), detector, prior, oscillator, trace ? `${scenario}@${meta.fps / factor}` : null);
    const { times } = r;
    const fit = fitGrid(times, meta.statedBpm, times[0], times[times.length - 1] + 1e-6);
    const row = [
      scenario,
      String(meta.fps / factor),
      String(times.length),
      f(fMeasure(fit.grid, times, 0.175 * period)),
      f(fMeasure(fit.grid, times, 0.3 * period)),
      f(fit.fMeasure),
      f(continuity(fit.grid, times)),
      (1000 * r.latency).toFixed(0),
      `${(100 * r.runningFraction).toFixed(0)} %`,
      `${r.tempoAtLast.toFixed(1)} bpm`,
      r.endState,
      f(fMeasure(fit.grid, r.predicted, PREDICTION_TOLERANCE * period)),
    ];
    console.log(`| ${row.join(' | ')} |`);
  }
}
