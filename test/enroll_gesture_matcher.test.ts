/**
 * The window matcher (#752, phase 2 of `docs/design/dynamic-gestures.md`): banded DTW behind the
 * `WindowMatcher` seam, over scripted gestures of the articulated synthetic hand
 * (`helpers/wave_take.ts`, read by the live hand features).
 *
 * The goldens: the player's repetitions of four gestures (wave, nod, circle, push) are cut from
 * one take by the motion segmenter, as the session would; a second take, with another jitter
 * seed and made bigger and faster, is then played live through the matcher. Every repetition
 * must fire as the right gesture, once, with the size and the speed reported as the variation;
 * stillness and a gesture never taught (a diagonal swing) must fire nothing. The DTW and the
 * series are pinned on their own first, because the goldens would pass vacuously if the
 * distance ignored the shape.
 *
 * No recorded gesture take exists yet: the real-take set is the human-only prerequisite of #754.
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import {
  buildGestureModel,
  createDtwMatcher,
  createMotionSegmenter,
  dtwDistance,
  matchSegment,
  MATCHER_DEFAULTS,
  toSeries,
  type GestureFire,
  type GestureModel,
  type WindowMatcher,
} from '@thoremin/sdk/enroll/gestures';
import { createNoiseEstimator, scaleWeights, type NoiseEstimator } from '@thoremin/sdk/enroll/noise';
import type { Trace, TraceSample } from '@thoremin/sdk/enroll/types';
import { GESTURE_PATHS, waveTake, WAVE_SCRIPT, type WaveScript, type WaveTake } from './helpers/wave_take';

/** The right hand's raw image positions, x and y: what these gestures move. */
const POSITION = Object.keys(FEATURE_BY_ID).filter((id) => id.startsWith('hand.right.') && FEATURE_BY_ID[id].group === 'hand.position.raw');
const TAUGHT = ['wave', 'nod', 'circle', 'push'] as const;
type Taught = (typeof TAUGHT)[number];

/** A take of `gesture`, the script's other fields overridden by `script`. */
const takeOf = (gesture: keyof typeof GESTURE_PATHS, script: Partial<WaveScript> = {}) => waveTake({ path: GESTURE_PATHS[gesture], ...script });

/** The traces of a take, cut as the session cuts them (noise fed only between repetitions). */
function cutTraces(gesture: string, take: WaveTake): { traces: Trace[]; noise: NoiseEstimator } {
  const noise = createNoiseEstimator();
  const seg = createMotionSegmenter({ gesture, cue: `${gesture}-5`, features: POSITION, noise });
  for (const f of take.frames) {
    seg.push(f.v, f.t);
    if (!seg.inRun()) noise.push(f.v, f.t);
  }
  return { traces: seg.traces(), noise };
}

/** Play a take live through `matcher`, feeding the noise estimate as a live caller does. */
function play(take: WaveTake, make: (noise: NoiseEstimator) => WindowMatcher & { inRun(): boolean }) {
  const noise = createNoiseEstimator();
  const matcher = make(noise);
  const fires: GestureFire[] = [];
  for (const f of take.frames) {
    const r = matcher.push(f.v, f.t);
    expect(r.following).toBeNull();
    if (r.fired) fires.push(r.fired);
    if (!matcher.inRun()) noise.push(f.v, f.t);
  }
  return fires;
}

/** The training set: five repetitions of each taught gesture, from seed 1. */
const TRAINING = TAUGHT.flatMap((g) => cutTraces(g, takeOf(g)).traces);
const MODEL = buildGestureModel(TRAINING, { features: POSITION });

/** The live takes: another seed, 40 % bigger, 25 % faster. */
const LIVE: Partial<WaveScript> = { seed: 7, amplitude: WAVE_SCRIPT.amplitude * 1.4, waveMs: WAVE_SCRIPT.waveMs * 0.8 };

describe('dtwDistance', () => {
  const ramp = (n: number) => Array.from({ length: n }, (_, i) => [Math.sin((Math.PI * i) / (n - 1)), (i / (n - 1)) ** 2]);

  it('is zero on itself, symmetric, and Infinity on an empty series', () => {
    const a = ramp(20);
    const b = ramp(20).map(([x, y]) => [x + 0.1, y]);
    expect(dtwDistance(a, a, { band: 0.2 })).toBe(0);
    expect(dtwDistance(a, b, { band: 0.2 })).toBeCloseTo(dtwDistance(b, a, { band: 0.2 }), 12);
    expect(dtwDistance([], a, { band: 0.2 })).toBe(Infinity);
  });

  it('absorbs a change of pacing that a frame-by-frame distance does not', () => {
    const a = ramp(32);
    // The same path, its first half rushed and its second half dragged.
    const warped = a.map((_, i) => {
      const u = i / 31;
      const v = u < 0.5 ? u * 1.4 : 0.7 + (u - 0.5) * 0.6;
      return [Math.sin(Math.PI * v), v ** 2];
    });
    const lockstep = dtwDistance(a, warped, { band: 0 });
    const warpedDistance = dtwDistance(a, warped, { band: 0.2 });
    expect(warpedDistance).toBeLessThan(lockstep / 3);
  });

  it('skips a dimension that is not finite in both rows, and costs Infinity when none is shared', () => {
    const a = [[0, NaN], [1, NaN], [2, NaN]];
    const b = [[0, 5], [1, 6], [2, 7]];
    expect(dtwDistance(a, b, { band: 0.5 })).toBe(0);
    expect(dtwDistance([[NaN], [NaN]], [[1], [2]], { band: 0.5 })).toBe(Infinity);
  });

  it('finds a path between series of different lengths even with no band', () => {
    expect(Number.isFinite(dtwDistance(ramp(10), ramp(30), { band: 0 }))).toBe(true);
  });
});

describe('toSeries', () => {
  const samples = (dx: number, k: number, stamps: number[]): TraceSample[] =>
    stamps.map((t) => ({ t, vector: { x: dx + k * Math.sin(t / 100), y: dx + k * Math.cos(t / 100), other: 99 } }));
  const OPTS = { features: ['x', 'y'], weights: { x: 1, y: 1 }, length: 16, position: true, scale: true };

  it('is the same series wherever and at whatever size the path is made, and reports the size', () => {
    const stamps = Array.from({ length: 30 }, (_, i) => i * 33);
    const a = toSeries(samples(0, 1, stamps), OPTS);
    const b = toSeries(samples(5, 3, stamps), OPTS);
    expect(b.amplitude / a.amplitude).toBeCloseTo(3, 9);
    for (let i = 0; i < 16; i++) for (let k = 0; k < 2; k++) expect(b.rows[i][k]).toBeCloseTo(a.rows[i][k], 9);
    // Without the invariances the two differ.
    const raw = { ...OPTS, position: false, scale: false };
    expect(toSeries(samples(5, 3, stamps), raw).rows[0][0]).not.toBeCloseTo(toSeries(samples(0, 1, stamps), raw).rows[0][0], 3);
  });

  it('resamples at the frames own stamps, so a dropped frame is bridged, not shifted', () => {
    const even = Array.from({ length: 31 }, (_, i) => i * 33);
    const dropped = even.filter((_, i) => i !== 10 && i !== 11);
    const a = toSeries(samples(0, 1, even), OPTS);
    const b = toSeries(samples(0, 1, dropped), OPTS);
    expect(b.durationMs).toBe(a.durationMs);
    for (let i = 0; i < 16; i++) expect(b.rows[i][0]).toBeCloseTo(a.rows[i][0], 1);
  });

  it('leaves out a feature with no weight, and has no rows for fewer than two samples', () => {
    const s = toSeries(samples(0, 1, [0, 33, 66]), { ...OPTS, features: ['x', 'y', 'z'], weights: { x: 1, y: 1 } });
    expect(s.rows[0][2]).toBeNaN();
    expect(toSeries(samples(0, 1, [0]), OPTS).rows).toEqual([]);
  });
});

describe('buildGestureModel', () => {
  it('learns every taught gesture from its five traces, each with a radius', () => {
    expect(TRAINING.length).toBe(20);
    expect(MODEL.gestures.map((g) => g.gesture)).toEqual([...TAUGHT]);
    expect(MODEL.skipped).toEqual([]);
    for (const g of MODEL.gestures) {
      expect(g.templates).toHaveLength(5);
      expect(g.radius).toBeGreaterThanOrEqual(MATCHER_DEFAULTS.minRadius);
      expect(g.durationMs).toBeGreaterThan(WAVE_SCRIPT.waveMs * 0.8);
    }
  });

  it('leaves out a gesture with a single trace: one repetition is no agreement', () => {
    const one = cutTraces('flick', takeOf('push', { waves: 1 })).traces;
    expect(one).toHaveLength(1);
    const model = buildGestureModel([...TRAINING, ...one], { features: POSITION });
    expect(model.skipped).toEqual(['flick']);
    expect(model.gestures.map((g) => g.gesture)).not.toContain('flick');
  });

  it('takes the session noise weights in place of the default spread weights', () => {
    const { noise } = cutTraces('wave', takeOf('wave'));
    const model = buildGestureModel(TRAINING, { features: POSITION, weights: scaleWeights(noise.snapshot()) });
    expect(model.series.weights).not.toBe(MODEL.series.weights);
    const live = cutTraces('wave', takeOf('wave', LIVE)).traces;
    for (const tr of live) expect(matchSegment(model, tr.samples).gesture).toBe('wave');
  });
});

describe('the segmenter for a live stream', () => {
  it('returns each trace from push but keeps none when retain is off, numbering on', () => {
    const take = takeOf('wave');
    const noise = createNoiseEstimator();
    const seg = createMotionSegmenter({ gesture: '', cue: 'live', features: POSITION, noise, retain: false });
    const returned: Trace[] = [];
    for (const f of take.frames) {
      const tr = seg.push(f.v, f.t);
      if (tr) returned.push(tr);
      if (!seg.inRun()) noise.push(f.v, f.t);
    }
    expect(returned.map((t) => t.id)).toEqual(['live#1', 'live#2', 'live#3', 'live#4', 'live#5']);
    expect(seg.traces()).toEqual([]);
  });
});

describe('matchSegment (offline goldens)', () => {
  const liveTraces = (g: keyof typeof GESTURE_PATHS) => cutTraces(g, takeOf(g, LIVE)).traces;

  it.each(TAUGHT)('recognises every live %s, nearer its own templates than any other', (g: Taught) => {
    const traces = liveTraces(g);
    expect(traces).toHaveLength(5);
    for (const tr of traces) {
      const m = matchSegment(MODEL, tr.samples);
      expect(m.gesture).toBe(g);
      expect(m.confidence).toBeGreaterThan(0);
      expect(m.ratio).toBeLessThanOrEqual(MATCHER_DEFAULTS.tolerance);
    }
  });

  it('refuses a gesture never taught (a diagonal swing) instead of calling it the nearest', () => {
    const traces = liveTraces('diagonal');
    expect(traces).toHaveLength(5);
    for (const tr of traces) {
      const m = matchSegment(MODEL, tr.samples);
      expect(m.gesture).toBeNull();
      expect(m.nearest).not.toBeNull();
      expect(m.ratio).toBeGreaterThan(MATCHER_DEFAULTS.tolerance);
    }
  });

  it('reports what the invariances took away: bigger and faster', () => {
    for (const tr of liveTraces('wave')) {
      const { variation } = matchSegment(MODEL, tr.samples);
      expect(variation.scale).toBeGreaterThan(1.2);
      expect(variation.scale).toBeLessThan(1.6);
      expect(variation.speed).toBeGreaterThan(1.1);
      expect(variation.speed).toBeLessThan(1.4);
    }
  });

  it('says nothing for an empty model or a segment too short to compare', () => {
    const empty: GestureModel = buildGestureModel([], { features: POSITION });
    const m = matchSegment(empty, TRAINING[0].samples);
    expect(m.gesture).toBeNull();
    expect(m.nearest).toBeNull();
    expect(matchSegment(MODEL, TRAINING[0].samples.slice(0, 1)).gesture).toBeNull();
  });
});

describe('createDtwMatcher (live goldens)', () => {
  const live = (noise: NoiseEstimator, extra = {}) => createDtwMatcher({ model: MODEL, noise, ...extra });

  it.each(TAUGHT)('fires once per live %s, as that gesture, after each repetition ends', (g: Taught) => {
    const take = takeOf(g, LIVE);
    const fires = play(take, (noise) => live(noise));
    expect(fires.map((f) => f.gesture)).toEqual(Array(5).fill(g));
    fires.forEach((f, i) => {
      expect(f.t).toBeGreaterThan(take.waves[i].endMs);
      expect(f.t).toBeLessThan(take.waves[i].endMs + 600);
    });
  });

  it('fires nothing over stillness, nor over a gesture never taught', () => {
    expect(play(takeOf('wave', { waves: 0, restMs: 12000 }), (noise) => live(noise))).toEqual([]);
    expect(play(takeOf('diagonal', LIVE), (noise) => live(noise))).toEqual([]);
  });

  it('holds off for the refractory period after a fire', () => {
    // Repetitions end every 1.8 s; a 3 s hold-off keeps every other one.
    const fires = play(takeOf('wave', LIVE), (noise) => live(noise, { refractoryMs: 3000 }));
    expect(fires).toHaveLength(3);
    expect(fires[1].t - fires[0].t).toBeGreaterThanOrEqual(3000);
  });

  it('reset forgets an open segment and the hold-off', () => {
    const take = takeOf('wave', LIVE);
    const noise = createNoiseEstimator();
    const matcher = live(noise, { refractoryMs: 60_000 });
    let fired = 0;
    for (const f of take.frames) {
      if (matcher.push(f.v, f.t).fired) fired += 1;
      if (!matcher.inRun()) noise.push(f.v, f.t);
    }
    expect(fired).toBe(1);
    matcher.reset();
    expect(matcher.inRun()).toBe(false);
    // The same take again, on later stamps: the hold-off is gone, so the first wave fires.
    const offset = take.frames[take.frames.length - 1].t + 1000;
    let again = 0;
    for (const f of take.frames) if (matcher.push(f.v, f.t + offset).fired) again += 1;
    expect(again).toBe(1);
  });
});
