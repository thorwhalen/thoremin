/**
 * The impact predictor on a slow camera and a slow machine (the timing plan's step 1b):
 * the commit deadline reads the expected next gap, not the last one, and the floor is
 * learned from a departure that spans time rather than counts samples.
 *
 * The committed fixtures (`test/fixtures/subframe_*`, see `impact_predictor.test.ts`)
 * are thinned two ways with the scorer's own decimators: to a regular 15 and 20 fps
 * (the 60 fps ball, the 30 fps stick), and inference-paced on the 30 fps stick — a
 * frame is processed only when the simulated inference of the previous one has
 * finished, latest frame wins, every frame keeping its capture stamp — which gives the
 * alternating 33 / 67 ms spacings a slow laptop produces. Before this step the 15 fps
 * stick never committed a prediction (the departure needed 200 ms of settling, the
 * next descent began first, the floor was never learned), and under 33 / 67 ms pacing
 * the deadline, guessing the next gap from the last, committed short or late.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createImpactPredictor, expectedGap, type ImpactConfirmation, type ImpactPrediction, type Sample } from '@thoremin/ictus';
import { decimateByInference, decimateToFps } from '../../scripts/subframe/decimate';
import { FIXTURES } from '../helpers/fixtures';

interface Truth {
  spec: { fps: number; kind: 'surface' | 'air' };
  objects: { name: string; impact_keypoint: string }[];
  events: { index: number; t_impact: number }[];
}

function loadFixture(name: string): { truth: Truth; samples: Sample[] } {
  const dir = join(FIXTURES, name);
  const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth;
  const obj = truth.objects[0];
  const samples: Sample[] = [];
  for (const line of readFileSync(join(dir, 'keypoints.ndjson'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as { t: number; value: { keypoints: { object: string; name: string; x: number; y: number }[] } };
    const p = rec.value.keypoints.find((k) => k.object === obj.name && k.name === obj.impact_keypoint)!;
    samples.push({ t: rec.t, x: p.x, y: p.y });
  }
  return { truth, samples };
}

/** What a real caller sets (see `impact_predictor.test.ts`). */
const FLOOR = { minAmplitude: 12 };
const MIN_LEAD = 0.06;
/** The time compression that turns the fixtures' 96 to 132 bpm into 160 to 220. */
const FAST = 0.6;

function run(samples: Sample[], opts: Parameters<typeof createImpactPredictor>[0] = {}) {
  const pred = createImpactPredictor({ minLead: MIN_LEAD, ...FLOOR, ...opts });
  const predictions: ImpactPrediction[] = [];
  const confirmations: ImpactConfirmation[] = [];
  for (const s of samples) {
    for (const e of pred.push(s)) {
      if (e.kind === 'predict') predictions.push(e);
      else confirmations.push(e);
    }
  }
  return { predictions, confirmations, pred };
}

const nearest = <T extends { t: number }>(events: T[], t: number): T => events.reduce((b, e) => (Math.abs(e.t - t) < Math.abs(b.t - t) ? e : b));

describe('expectedGap', () => {
  it('is the gap itself under regular sampling and the long gap under alternation', () => {
    expect(Number.isNaN(expectedGap([]))).toBe(true);
    expect(expectedGap([1 / 30, 1 / 30, 1 / 30])).toBeCloseTo(1 / 30, 9);
    expect(expectedGap([1 / 30, 2 / 30, 1 / 30, 2 / 30, 1 / 30, 2 / 30, 1 / 30, 2 / 30])).toBeCloseTo(2 / 30, 9);
    // One long gap in eight is the 90th percentile; one in twenty would not be.
    expect(expectedGap([1, 1, 1, 1, 1, 1, 1, 3])).toBe(3);
  });
});

describe('the decimators', () => {
  it('decimateToFps keeps one sample per tick; decimateByInference alternates on a 30 fps stream', () => {
    const thirty = Array.from({ length: 30 }, (_, i) => ({ t: i / 30, x: 0, y: i }));
    const fifteen = decimateToFps(thirty, 15);
    expect(fifteen.length).toBe(15);
    expect(fifteen.map((s) => s.y)).toEqual(thirty.filter((_, i) => i % 2 === 0).map((s) => s.y));
    // 45 ms of inference on 33 ms frames: 33, 67, 33, 67 ... between processed frames.
    const paced = decimateByInference(thirty, 0.045);
    const gaps = paced.slice(1).map((s, i) => Math.round((s.t - paced[i].t) * 30));
    expect(gaps.every((g) => g === 1 || g === 2)).toBe(true);
    // 45 ms of inference on 33 ms frames: one processed frame in three is 67 ms late.
    expect(gaps.filter((g) => g === 2).length).toBeGreaterThanOrEqual(Math.floor(gaps.length / 3));
    expect(paced.length).toBeLessThan(thirty.length);
  });
});

describe.each([
  { name: 'subframe_ball_air_60', fps: 15 },
  { name: 'subframe_ball_air_60', fps: 20 },
  { name: 'subframe_stick_surface_30', fps: 15 },
  { name: 'subframe_stick_air_30', fps: 15 },
])('$name decimated to $fps fps', ({ name, fps }) => {
  const { truth, samples } = loadFixture(name);
  const slow = decimateToFps(samples, fps);
  const events = truth.events.map((e) => ({ ...e, t: e.t_impact }));

  it('learns the floor and predicts most strokes, none spurious, each ahead of its impact', () => {
    const { predictions, confirmations, pred } = run(slow);
    expect(Number.isFinite(pred.level())).toBe(true);
    expect(pred.unlearnedConfirmations()).toBe(0);
    expect(confirmations.length).toBeGreaterThanOrEqual(events.length - 1);
    // The first stroke has no floor; of the rest, at least 80 % are predicted.
    expect(predictions.length).toBeGreaterThanOrEqual(Math.ceil(0.8 * (events.length - 1)));
    expect(predictions.length).toBeLessThanOrEqual(events.length);
    const matched = new Set<number>();
    for (const p of predictions) {
      const e = nearest(events, p.t);
      expect(matched.has(e.index)).toBe(false);
      matched.add(e.index);
      expect(p.at).toBeLessThan(e.t_impact);
      // Within two frames of the impact at this rate: the approach is two or three
      // samples, so the fit is coarse, but it is a prediction, not a ghost.
      expect(Math.abs(p.t - e.t_impact)).toBeLessThan(2 / fps);
    }
  });

  it('at a faster tempo the three-sample departure alone (the pre-step-1b count) loses the floor; the time-based one keeps it', () => {
    if (fps !== 15) return;
    // The same strokes played 1.7 times faster (160 to 220 bpm): 200 ms of departure
    // settling no longer fits before the next descent.
    const fast = decimateToFps(samples.map((s) => ({ ...s, t: s.t * FAST })), fps);
    const counted = run(fast, { departureWindow: Infinity });
    const spanned = run(fast);
    // An air stroke leaves its bottom slowly, so its third departure sample is what
    // the next descent overruns; a surface stroke rebounds at its approach speed and
    // its three samples still fit.
    if (truth.spec.kind === 'air') expect(counted.pred.unlearnedConfirmations()).toBeGreaterThan(0);
    expect(spanned.pred.unlearnedConfirmations()).toBe(0);
    expect(spanned.predictions.length).toBeGreaterThanOrEqual(counted.predictions.length);
    expect(spanned.predictions.length).toBeGreaterThanOrEqual(Math.ceil(0.6 * (events.length - 1)));
  });
});

describe('subframe_stick_surface_30 inference-paced at 45 ms (33 / 67 ms stamps)', () => {
  const { truth, samples } = loadFixture('subframe_stick_surface_30');
  const paced = decimateByInference(samples, 0.045);
  const events = truth.events.map((e) => ({ ...e, t: e.t_impact }));

  it('predicts most strokes with the required lead from the decision, none short of it', () => {
    const { predictions } = run(paced);
    expect(predictions.length).toBeGreaterThanOrEqual(Math.ceil(0.8 * (events.length - 1)));
    for (const p of predictions) {
      const e = nearest(events, p.t);
      // The deadline expected the long gap, so the commit leaves the lead the
      // consumer asked for (against the predicted impact) and precedes the impact.
      expect(p.lead).toBeGreaterThanOrEqual(MIN_LEAD - 0.005);
      expect(e.t_impact - p.at).toBeGreaterThan(0);
      expect(Math.abs(p.t - e.t_impact)).toBeLessThan(0.03);
    }
  });
});
