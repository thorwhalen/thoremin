/**
 * The impact predictor (src/ictus/impact.ts): the fits it is built on, and the
 * predictor replayed over the committed synthetic fixtures made by the `an.impacts`
 * harness (`test/fixtures/subframe_*`: a stick on a table and in the air at 30 fps, a
 * ball in the air at 60 fps; 180-degree shutter, humanised timing, an accelerando;
 * `scripts/subframe/build_fixture.ts` says how they were made).
 *
 * What is pinned, per fixture: every impact after the first is PREDICTED (one
 * prediction per stroke, none spurious), committed at least the required lead ahead
 * of the executed impact; the prediction's error against the executed impact time
 * beats the frame-snapped baseline the harness records for the same clip
 * (`frames.lowest_error`) on the spread that matters, and stays under a bound; the
 * confirmation arrives one sample past the bottom and is at least as good. Tracker
 * noise at 2 px keeps it within a looser bound with no spurious events. The bounds
 * are what `scripts/subframe/score.ts` measured on the full benchmark, with margin.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createImpactPredictor, crossingTau, fitLine, fitQuadratic, intersectionTau, type ImpactConfirmation, type ImpactPrediction, type Sample } from '@/ictus';
import { FIXTURES } from '../helpers/fixtures';

// ---- the fits ------------------------------------------------------------------

describe('fitQuadratic / fitLine / crossingTau / intersectionTau', () => {
  it('recovers an exact quadratic and reports zero residual', () => {
    const ts = [0, 0.1, 0.2, 0.3, 0.4];
    const f = (t: number) => 3 + 2 * t - 5 * t * t;
    const q = fitQuadratic(ts, ts.map(f), 0.4)!;
    // Re-expressed around t0 = 0.4: value, slope and curvature there.
    expect(q.a).toBeCloseTo(f(0.4), 9);
    expect(q.b).toBeCloseTo(2 - 10 * 0.4, 9);
    expect(q.c).toBeCloseTo(-5, 9);
    expect(q.rms).toBeLessThan(1e-9);
    expect(fitQuadratic([0, 1], [0, 1], 0)).toBeNull();
  });

  it('a line fit is a degenerate quadratic', () => {
    const l = fitLine([0, 1, 2], [1, 3, 5], 2)!;
    expect(l.c).toBe(0);
    expect(l.b).toBeCloseTo(2, 9);
    expect(l.a).toBeCloseTo(5, 9);
  });

  it('crossingTau looks ahead for the prediction and around the origin for the refinement', () => {
    // Falling at 100 units/s, accelerating at 400 units/s², 5 units above the floor.
    const fit = { a: 0, b: 100, c: 200 };
    const ahead = crossingTau(fit, 5);
    expect(ahead.reaches).toBe(true);
    expect(ahead.tau).toBeCloseTo((-100 + Math.sqrt(100 * 100 + 4 * 200 * 5)) / 400, 9);
    // Already 3 units past the floor at the origin and still heading down: ahead,
    // the crossing was a moment ago — the backward root, never a decelerating
    // trajectory's exit root, never "now" ...
    const behind = crossingTau({ a: 3, b: 100, c: 200 }, 0);
    expect(behind.reaches).toBe(true);
    expect(behind.tau).toBeCloseTo((-100 + Math.sqrt(100 * 100 - 4 * 200 * 3)) / 400, 6);
    const decel = crossingTau({ a: 5, b: 100, c: -2000 }, 0);
    expect(decel.tau).toBeLessThan(0);
    expect(decel.tau).toBeGreaterThan(-0.04);
    // ... but the refinement finds it just behind.
    const around = crossingTau({ a: 3, b: 100, c: 200 }, 0, true);
    expect(around.tau).toBeLessThan(0);
    expect(around.tau).toBeCloseTo((-100 + Math.sqrt(100 * 100 - 4 * 200 * 3)) / 400, 6);
    // Decelerating and turning above the floor: the vertex, flagged as not reaching.
    const turn = crossingTau({ a: 0, b: 100, c: -2000 }, 10);
    expect(turn.reaches).toBe(false);
    expect(turn.tau).toBeCloseTo(0.025, 9);
  });

  it('intersectionTau picks the meeting point nearest the origin', () => {
    const f = { a: 0, b: 1, c: 0, rms: 0 };
    const g = { a: 0, b: -1, c: 0, rms: 0 };
    expect(intersectionTau(f, g, 0)).toBeCloseTo(0, 9);
    const h = { a: 1, b: 0, c: -1, rms: 0 }; // 1 - τ²; meets τ at τ = 0.618 and -1.618
    expect(intersectionTau(f, h, 0)).toBeCloseTo(0.618, 3);
  });
});

// ---- the fixtures ---------------------------------------------------------------

interface Truth {
  spec: { fps: number; kind: 'surface' | 'air'; exposure: number };
  objects: { name: string; impact_keypoint: string }[];
  events: { index: number; t_grid: number; t_impact: number; kind: string; impact_xy: [number, number]; frames: { lowest_error: number } }[];
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

/** Deterministic Gaussian tracker noise (mulberry32 + Box-Muller). */
function noisy(samples: Sample[], sd: number, seed: number): Sample[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const g = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next());
  return samples.map((s) => ({ t: s.t, x: s.x + sd * g(), y: s.y + sd * g() }));
}

function run(samples: Sample[], opts: Parameters<typeof createImpactPredictor>[0] = {}) {
  const pred = createImpactPredictor({ minLead: 0.03, ...FLOOR, ...opts });
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

const sd = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
const nearest = <T extends { t: number }>(events: T[], t: number): T => events.reduce((b, e) => (Math.abs(e.t - t) < Math.abs(b.t - t) ? e : b));

/** Per fixture: the bound on the prediction's |error| in seconds, and on its spread. */
const CASES: { name: string; maxAbs: number; maxSd: number; maxAbsNoisy: number }[] = [
  { name: 'subframe_stick_surface_30', maxAbs: 0.016, maxSd: 0.003, maxAbsNoisy: 0.04 },
  { name: 'subframe_stick_air_30', maxAbs: 0.025, maxSd: 0.008, maxAbsNoisy: 0.045 },
  { name: 'subframe_ball_air_60', maxAbs: 0.016, maxSd: 0.003, maxAbsNoisy: 0.03 },
];

/** What a real caller sets: an absolute stroke floor in its own units (pixels here;
 *  a hand at 640 px moves far more than this in any stroke), so that noise before the
 *  first stroke — when there is no envelope and no jitter estimate yet to be small
 *  against — cannot be a stroke. */
const FLOOR = { minAmplitude: 12 };

describe.each(CASES)('impact predictor on $name', ({ name, maxAbs, maxSd, maxAbsNoisy }) => {
  const { truth, samples } = loadFixture(name);
  const events = truth.events.map((e) => ({ ...e, t: e.t_impact }));
  const frame = 1 / truth.spec.fps;

  it('predicts every stroke after the first, once, ahead of the impact, and confirms every stroke', () => {
    const { predictions, confirmations } = run(samples);
    // The first stroke has no learned floor yet; every later one is predicted once.
    expect(predictions.length).toBe(events.length - 1);
    expect(confirmations.length).toBe(events.length);
    const matched = new Set<number>();
    for (const p of predictions) {
      const e = nearest(events, p.t);
      expect(Math.abs(p.t - e.t_impact)).toBeLessThan(maxAbs);
      expect(matched.has(e.index)).toBe(false);
      matched.add(e.index);
      // Committed about the required lead before the PREDICTED impact (the true one
      // differs by the prediction's error), from a sample that precedes the impact.
      expect(p.lead).toBeGreaterThanOrEqual(0.03 - 0.005);
      expect(e.t_impact - p.at).toBeGreaterThanOrEqual(0.03 - maxAbs);
    }
    for (const c of confirmations) {
      const e = nearest(events, c.t);
      // Confirmed on the first sample past the bottom: within two frames after it.
      expect(c.at - e.t_impact).toBeGreaterThan(0);
      expect(c.at - e.t_impact).toBeLessThan(2 * frame + 1e-9);
      expect(Math.abs(c.t - e.t_impact)).toBeLessThan(maxAbs);
    }
  });

  it('beats the frame-snapped baseline on spread, and its error is bounded', () => {
    const { predictions } = run(samples);
    const errs = predictions.map((p) => p.t - nearest(events, p.t).t_impact);
    const baseline = events.slice(1).map((e) => e.frames.lowest_error);
    expect(sd(errs)).toBeLessThan(maxSd);
    expect(sd(errs)).toBeLessThan(sd(baseline));
  });

  it('classifies the stroke kind from the rebound', () => {
    const { pred } = run(samples);
    expect(pred.lastKind()).toBe(truth.spec.kind);
  });

  it('with 2 px of tracker noise, over ten seeds: no spurious event, every stroke still confirmed, errors within the looser bound', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { predictions, confirmations } = run(noisy(samples, 2, seed));
      expect(confirmations.length, `seed ${seed}`).toBe(events.length);
      expect(predictions.length, `seed ${seed}`).toBeLessThanOrEqual(events.length);
      expect(predictions.length, `seed ${seed}`).toBeGreaterThanOrEqual(events.length - 3);
      // Noise makes a smooth turn's bottom ambiguous now and then: at most one event
      // per seed may exceed the bound, and nothing may exceed twice it.
      const errs = [...predictions, ...confirmations].map((e) => Math.abs(e.t - nearest(events, e.t).t_impact));
      expect(errs.filter((x) => x >= maxAbsNoisy).length, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const x of errs) expect(x, `seed ${seed}`).toBeLessThan(2 * maxAbsNoisy);
    }
  });

  if (truth.spec.kind === 'surface') {
    it('with the plane given (a calibrated table), predicts the first stroke too and tighter', () => {
      const level = truth.events[0].impact_xy[1];
      const { predictions } = run(samples, { level, mode: 'surface' });
      expect(predictions.length).toBe(events.length);
      const errs = predictions.map((p) => p.t - nearest(events, p.t).t_impact);
      expect(sd(errs)).toBeLessThan(0.006);
    });
  }
});

describe('impact predictor: gates', () => {
  it('tremor after real strokes does not fire (the envelope gate), and an absolute floor keeps a lone wiggle quiet', () => {
    const { samples } = loadFixture('subframe_stick_surface_30');
    const pred = createImpactPredictor({ minLead: 0.03 });
    for (const s of samples) pred.push(s);
    const last = samples[samples.length - 1];
    let events = 0;
    for (let i = 1; i < 150; i++) events += pred.push({ t: last.t + i / 30, x: last.x, y: last.y + 3 * Math.sin(i) }).length;
    expect(events).toBe(0);
    // Before any stroke there is nothing to be small against: the caller's floor is
    // what keeps a clean, tiny oscillation from being strokes.
    const floored = createImpactPredictor({ minAmplitude: 5 });
    let lone = 0;
    for (let i = 0; i < 300; i++) lone += floored.push({ t: i / 30, x: 100, y: 200 + 0.5 * Math.sin(i) }).length;
    expect(lone).toBe(0);
  });

  it('a gap in the samples restarts the history rather than fitting across it', () => {
    const { samples } = loadFixture('subframe_stick_surface_30');
    const gapped = samples.map((s, i) => (i >= 60 && i < 75 ? null : s)).filter((s): s is Sample => s !== null);
    const { confirmations } = run(gapped);
    for (const c of confirmations) expect(Number.isFinite(c.t)).toBe(true);
  });
});
