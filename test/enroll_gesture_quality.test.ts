/**
 * Dynamic gestures, phase 3 (#753): the categorizer file's additive `gestures` section, the
 * gestures' quality (agreement, the odd trace, separation, thin, overlap with held categories,
 * comparable pairs) and the everyday false-fire check, on scripted gestures of the articulated
 * synthetic hand (`helpers/wave_take.ts`), cut by the motion segmenter as a session cuts them.
 *
 * The measured numbers these pin (seed 1, the hand's 14 raw position features in the take's own
 * noise units, the matcher's defaults): five waves agree at 0.10 series units (relative 0.87 of
 * the median 0.117 of the OTHER three, nod / circle / push), every gesture at least 5.0 radii from
 * its nearest neighbour; one repetition each of five different paths under one name agrees at
 * 0.67, past the absolute loose line (0.2) alone and 6.6 times the waves beside them; a circle
 * among the waves is the odd trace at 5.7 times the others' agreement (the most a real wave
 * reaches is 1.46, the flag is at 2); a second wave made 10 % bigger with
 * another jitter seed sits 0.92 radii from the first (CLOSE below 2); a reach paused 400 ms at its
 * far end dwells 667 ms in that held pose (the bar is 220).
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import {
  buildGestureModel,
  createDtwMatcher,
  createMotionSegmenter,
  gestureEveryday,
  gestureModelFromCategorizer,
  gestureQuality,
  freshGestureId,
  gestureIds,
  gestureSection,
  gestureSpace,
  gestureTraces,
  GESTURE_QUALITY_DEFAULTS,
  MATCHER_DEFAULTS,
  matchSegment,
} from '@thoremin/sdk/enroll/gestures';
import {
  CATEGORIZER_FORMAT,
  CATEGORIZER_VERSION,
  exportCategorizer,
  importCategorizer,
  MAX_GESTURE_FRAMES,
  PersonalCategorizerSchema,
  SUPPORT_DECIMALS,
  type PersonalCategorizer,
} from '@thoremin/sdk/enroll/categorizer';
import { classify, trainModel, trainNeutral } from '@thoremin/sdk/enroll/classify';
import { everydayFlags } from '@thoremin/sdk/enroll/everyday';
import { parseRecord } from '@thoremin/sdk/enroll/record';
import { freshCategoryId } from '@thoremin/sdk/enroll/sorting';
import { createNoiseEstimator, scaleWeights, type NoiseEstimator } from '@thoremin/sdk/enroll/noise';
import type { Trace, TrainedModel } from '@thoremin/sdk/enroll/types';
import { GESTURE_PATHS, waveTake, WAVE_SCRIPT, type WaveScript, type WaveTake } from './helpers/wave_take';

/** The right hand's raw image positions, x and y: what these gestures move. */
const POSITION = Object.keys(FEATURE_BY_ID).filter((id) => id.startsWith('hand.right.') && FEATURE_BY_ID[id].group === 'hand.position.raw');

const takeOf = (path: keyof typeof GESTURE_PATHS, script: Partial<WaveScript> = {}) => waveTake({ path: GESTURE_PATHS[path], ...script });

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

const TAUGHT = ['wave', 'nod', 'circle', 'push'] as const;
const CUTS = Object.fromEntries(TAUGHT.map((g) => [g, cutTraces(g, takeOf(g))])) as Record<(typeof TAUGHT)[number], ReturnType<typeof cutTraces>>;
/** Noise units from the wave take's rest, as the session would weight them. */
const WEIGHTS = scaleWeights(CUTS.wave.noise.snapshot());
const OPTS = { features: POSITION, weights: WEIGHTS };
const ALL = TAUGHT.flatMap((g) => CUTS[g].traces);

/** One circle, cut from its own take, renamed into the waves. */
const ODD_CIRCLE: Trace = { ...cutTraces('wave', takeOf('circle', { seed: 3, waves: 1 })).traces[0], id: 'wave-odd#1' };

const byName = (q: ReturnType<typeof gestureQuality>, g: string) => q.gestures.find((x) => x.gesture === g)!;

describe('gestureQuality: agreement and separation', () => {
  const q = gestureQuality(ALL, OPTS);

  it('five consistent repetitions of each gesture agree, and every gesture is distinct', () => {
    expect(q.gestures.map((g) => g.gesture)).toEqual([...TAUGHT]);
    for (const g of q.gestures) {
      expect(g.traces).toBe(5);
      expect(g.grade).toBe('distinct');
      expect(g.dots).toBe(3);
      expect(g.loose).toBe(false);
      expect(g.odd!.flagged).toBe(false);
      expect(g.odd!.ratio).toBeLessThan(GESTURE_QUALITY_DEFAULTS.oddRatio);
      expect(g.incomparable).toBe(0);
      // Far from every other gesture, in its own radii.
      expect(g.ratio).toBeGreaterThan(GESTURE_QUALITY_DEFAULTS.okRatio);
    }
    const wave = byName(q, 'wave');
    expect(wave.agreement!).toBeCloseTo(0.101, 2);
    // Against the median of the OTHER three gestures' agreements, never its own.
    const others = q.gestures.filter((g) => g.gesture !== 'wave').map((g) => g.agreement!).sort((a, b) => a - b)[1];
    expect(wave.relativeAgreement!).toBeCloseTo(wave.agreement! / others, 12);
    expect(wave.relativeAgreement!).toBeCloseTo(0.87, 2);
    // Each trace has a mean distance to its four siblings.
    expect(q.traces.filter((t) => t.gesture === 'wave').map((t) => t.comparable)).toEqual([4, 4, 4, 4, 4]);
  });

  it('flags the odd repetition, a circle among waves, as the one to drop', () => {
    const odd = gestureQuality([...CUTS.wave.traces, ODD_CIRCLE, ...CUTS.nod.traces], OPTS);
    const wave = byName(odd, 'wave');
    expect(wave.odd).toMatchObject({ id: 'wave-odd#1', flagged: true });
    expect(wave.odd!.ratio).toBeGreaterThan(2 * GESTURE_QUALITY_DEFAULTS.oddRatio);
    expect(wave.odd!.improvement).toBeGreaterThan(2);
    expect(wave.grade).toBe('ok');
    // Its own mean distance to the waves is several times theirs among themselves.
    const circle = odd.traces.find((t) => t.id === 'wave-odd#1')!;
    const clean = gestureQuality(CUTS.wave.traces, OPTS).traces;
    for (const w of clean) expect(circle.agreement!).toBeGreaterThan(3 * w.agreement!);
  });

  /** "sloppy": one repetition of each of five different paths under one name. */
  const SLOPPY: Trace[] = (['wave', 'nod', 'circle', 'push', 'diagonal'] as const).map((p, i) => ({
    ...cutTraces('sloppy', takeOf(p, { seed: 11 + i, waves: 1 })).traces[0],
    id: `sloppy#${i + 1}`,
    gesture: 'sloppy',
  }));
  /** The absolute line: the matcher's tolerance times its radius floor, in series units. */
  const LOOSE_LINE = GESTURE_QUALITY_DEFAULTS.looseCeiling * MATCHER_DEFAULTS.minRadius;

  it('calls a gesture loose when its repetitions differ far more than the player\'s gestures usually do', () => {
    const loose = gestureQuality([...ALL, ...SLOPPY], OPTS);
    expect(byName(loose, 'sloppy').loose).toBe(true);
    expect(byName(loose, 'sloppy').relativeAgreement!).toBeGreaterThan(GESTURE_QUALITY_DEFAULTS.looseAgreement);
    expect(byName(loose, 'wave').loose).toBe(false);
  });

  it('calls a sloppy gesture loose on its own, or beside one other gesture (the absolute line)', () => {
    expect(LOOSE_LINE).toBeCloseTo(0.2, 12);
    // Alone: there is no other gesture to compare with, so only the absolute line can say it.
    const alone = byName(gestureQuality(SLOPPY, OPTS), 'sloppy');
    expect(alone.relativeAgreement).toBeNull();
    expect(alone.agreement!).toBeGreaterThan(2 * LOOSE_LINE);
    expect(alone).toMatchObject({ loose: true, grade: 'ok' });
    // Five consistent waves alone are not loose: well inside the line.
    const waves = byName(gestureQuality(CUTS.wave.traces, OPTS), 'wave');
    expect(waves.agreement!).toBeLessThan(LOOSE_LINE / 1.5);
    expect(waves).toMatchObject({ loose: false, grade: 'distinct', relativeAgreement: null });
    // Beside the waves: the sloppy one is loose, relative to the waves too; the waves are not.
    const pair = gestureQuality([...CUTS.wave.traces, ...SLOPPY], OPTS);
    expect(byName(pair, 'sloppy').loose).toBe(true);
    expect(byName(pair, 'sloppy').relativeAgreement!).toBeGreaterThan(GESTURE_QUALITY_DEFAULTS.looseAgreement);
    expect(byName(pair, 'wave').loose).toBe(false);
    expect(byName(pair, 'wave').relativeAgreement!).toBeLessThan(1);
  });

  it('reports no agreement, not Infinity, for a pair that shares no feature (minShared 0)', () => {
    const a: Trace = { id: 'd#1', gesture: 'd', cue: 'd', samples: [0, 1, 2].map((i) => ({ t: i * 33, vector: { a: i } })) };
    const b: Trace = { id: 'd#2', gesture: 'd', cue: 'd', samples: [0, 1, 2].map((i) => ({ t: i * 33, vector: { b: i } })) };
    const g = gestureQuality([a, b], { features: ['a', 'b'], weights: { a: 1, b: 1 }, minShared: 0 }).gestures[0];
    expect(g).toMatchObject({ agreement: null, incomparable: 1, grade: 'thin', loose: false });
  });

  it('separates a wave from a circle, and calls two near-identical gestures CLOSE', () => {
    expect(byName(q, 'circle').ratio).toBeGreaterThan(5);
    // A second name for the wave, made 10 % bigger with another jitter seed.
    const wave2 = cutTraces('wave2', takeOf('wave', { seed: 5, amplitude: WAVE_SCRIPT.amplitude * 1.1 })).traces;
    const close = gestureQuality([...CUTS.wave.traces, ...wave2, ...CUTS.circle.traces], OPTS);
    for (const [g, other] of [
      ['wave', 'wave2'],
      ['wave2', 'wave'],
    ]) {
      const x = byName(close, g);
      expect(x.nearest).toBe(other);
      expect(x.ratio).toBeLessThan(GESTURE_QUALITY_DEFAULTS.closeRatio);
      expect(x).toMatchObject({ grade: 'close', closeTo: other, dots: 1 });
    }
    expect(byName(close, 'circle').grade).toBe('distinct');
    // The chip agrees with the matcher, both ways. CLOSE: a matcher taught the wave and the circle
    // but not wave2 accepts EVERY wave2 repetition as the wave (the player would get the other
    // gesture). DISTINCT: a matcher taught the two waves refuses every circle repetition.
    const model = buildGestureModel([...CUTS.wave.traces, ...CUTS.circle.traces], OPTS);
    for (const tr of wave2) expect(matchSegment(model, tr.samples).gesture).toBe('wave');
    const waves = buildGestureModel([...CUTS.wave.traces, ...wave2], OPTS);
    for (const tr of CUTS.circle.traces) expect(matchSegment(waves, tr.samples).gesture).toBeNull();
  });

  it('calls one repetition thin: "needs another repetition"', () => {
    const thin = gestureQuality([...CUTS.wave.traces, CUTS.nod.traces[0]], OPTS);
    expect(byName(thin, 'nod')).toMatchObject({ traces: 1, grade: 'thin', agreement: null, odd: null, dots: 1 });
    // A thin gesture is still a neighbour: the waves are measured against it.
    expect(byName(thin, 'wave').nearest).toBe('nod');
  });
});

describe('gestureQuality: comparable pairs', () => {
  /** The odd circle with only four of the hand's fourteen features left (a hand half out of
   *  frame): the x of the wrist, palm, thumb tip and index tip, the axis a wave also moves on. */
  const keep = POSITION.filter((f) => f.endsWith('.x')).slice(0, 4);
  const crippled: Trace = {
    ...ODD_CIRCLE,
    id: 'wave-crippled#1',
    samples: ODD_CIRCLE.samples.map((s) => ({ t: s.t, vector: Object.fromEntries(keep.map((k) => [k, s.vector[k]])) })),
  };

  it('does not compare a pair sharing under half of the gesture\'s features', () => {
    expect(keep.length / POSITION.length).toBeLessThan(GESTURE_QUALITY_DEFAULTS.minShared);
    const q = gestureQuality([...CUTS.wave.traces, crippled], OPTS);
    expect(q.traces.find((t) => t.id === 'wave-crippled#1')).toMatchObject({ agreement: null, comparable: 0 });
    const wave = byName(q, 'wave');
    expect(wave.incomparable).toBe(5);
    // The five real waves are judged as if it were absent.
    const alone = byName(gestureQuality(CUTS.wave.traces, OPTS), 'wave');
    expect(wave.agreement).toBeCloseTo(alone.agreement!, 12);
    expect(wave.odd!.id).not.toBe('wave-crippled#1');
  });

  it('without the bar, what is left of a repetition looks closer than the whole of it', () => {
    const lenient = gestureQuality([...CUTS.wave.traces, crippled], { ...OPTS, minShared: 0 });
    const full = gestureQuality([...CUTS.wave.traces, ODD_CIRCLE], OPTS);
    const left = lenient.traces.find((t) => t.id === 'wave-crippled#1')!;
    const whole = full.traces.find((t) => t.id === 'wave-odd#1')!;
    expect(left.comparable).toBe(5);
    expect(left.agreement!).toBeLessThan(whole.agreement! / 2);
  });

  it('judges the share over the gesture\'s OWN features (featuresOf)', () => {
    // Declared to be matched on those four only, the crippled circle is comparable again.
    const own = gestureQuality([...CUTS.wave.traces, crippled], { ...OPTS, featuresOf: { wave: keep } });
    expect(own.traces.find((t) => t.id === 'wave-crippled#1')!.comparable).toBe(5);
  });
});

describe('gestureQuality: overlap with the held categories', () => {
  /** The reach pauses at its far end for a fifth of the repetition; at 2 s a repetition that
   *  flat hold is 400 ms, clearly past the sampler's 220 ms dwell on its own (no credit from the
   *  eased edges). Cut by the script's own windows: the motion segmenter would close a run at a
   *  quiet that long (its `quietMs` IS the dwell: held for one is not moving for the other). */
  const REACH_MS = 2000;
  const HOLD_FROM = 0.4 * REACH_MS;
  const HOLD_MS = 0.2 * REACH_MS;
  const reachTake = takeOf('reach', { waveMs: REACH_MS });
  const reach: Trace[] = reachTake.waves.map((w, i) => ({
    id: `reach#${i + 1}`,
    gesture: 'reach',
    cue: 'reach-5',
    samples: reachTake.frames.filter((f) => f.t >= w.startMs - 200 && f.t <= w.endMs + 200).map((f) => ({ vector: f.v, t: f.t })),
  }));
  /** Two held categories over the same features: the opening rest ("home") and the reach's far
   *  end ("aside"), the middle of its flat hold. */
  const home = reachTake.frames.filter((f) => f.t < WAVE_SCRIPT.restMs - 200).map((f) => f.v);
  const aside = reachTake.frames
    .filter((f) => reachTake.waves.some((w) => f.t > w.startMs + HOLD_FROM + 100 && f.t < w.startMs + HOLD_FROM + HOLD_MS - 100))
    .map((f) => f.v);
  const holds = trainModel(
    [...home, ...aside],
    [home.map((_, i) => i), aside.map((_, i) => home.length + i)],
    POSITION,
    WEIGHTS,
    { restVectors: home },
  );
  const ASIDE = holds.categories[1].id;

  it('flags a gesture that dwells on a held pose mid-way, and not one that passes through it', () => {
    expect(HOLD_MS).toBeGreaterThan(1.5 * GESTURE_QUALITY_DEFAULTS.dwellMs);
    const q = gestureQuality([...CUTS.wave.traces, ...reach], { ...OPTS, holds });
    const r = byName(q, 'reach');
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps![0]).toMatchObject({ category: ASIDE, traces: 5 });
    expect(r.overlaps![0].longestMs).toBeGreaterThan(1.5 * GESTURE_QUALITY_DEFAULTS.dwellMs);
    expect(r).toMatchObject({ grade: 'close', closeTo: ASIDE });
    // The wave starts and ends on "home" and swings through "aside" without dwelling.
    expect(byName(q, 'wave').overlaps).toEqual([]);
    expect(byName(q, 'wave').grade).not.toBe('close');
  });

  it('a gesture that starts and ends resting on a held pose is fine: only an interior dwell counts', () => {
    // Each wave with 400 ms of the resting "home" before and after it (the segmenter keeps one
    // window), so both ends dwell on a held pose for longer than the sampler's dwell.
    const take = takeOf('wave');
    const padded: Trace[] = take.waves.map((w, i) => ({
      id: `wave-padded#${i + 1}`,
      gesture: 'wave',
      cue: 'wave-5',
      samples: take.frames.filter((f) => f.t >= w.startMs - 400 && f.t <= w.endMs + 400).map((f) => ({ vector: f.v, t: f.t })),
    }));
    const q = gestureQuality(padded, { ...OPTS, holds });
    expect(byName(q, 'wave').overlaps).toEqual([]);
  });

  describe('on a two-feature model, frame by frame', () => {
    const F = ['a', 'b'];
    const WT = { a: 1, b: 1 };
    const DT = 33;
    const jitter = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.05;
    const cloud = (x: number, y: number, n: number, seed: number) => Array.from({ length: n }, (_, i) => ({ a: x + jitter(i + seed), b: y + jitter(i + seed + 99) }));
    const HOME = cloud(0, 0, 20, 0);
    const ASIDE_CLOUD = cloud(10, 0, 20, 50);
    const NEUTRAL_CLOUD = cloud(0, 10, 20, 200);
    const base = trainModel([...HOME, ...ASIDE_CLOUD], [HOME.map((_, i) => i), ASIDE_CLOUD.map((_, i) => 20 + i)], F, WT, { restVectors: HOME });
    type P = [number, number];
    const hold = (p: P, n: number): P[] => Array.from({ length: n }, () => p);
    const line = (from: P, to: P, n: number): P[] => Array.from({ length: n }, (_, i) => [from[0] + ((to[0] - from[0]) * (i + 1)) / n, from[1] + ((to[1] - from[1]) * (i + 1)) / n]);
    /** Two identical traces of `pts` (two, so the gesture has an agreement). */
    const twice = (pts: P[]): Trace[] =>
      [1, 2].map((n) => ({ id: `x#${n}`, gesture: 'x', cue: 'x', samples: pts.map(([a, b], i) => ({ vector: { a, b }, t: i * DT })) }));
    const overlapsOf = (pts: P[], model: TrainedModel) =>
      gestureQuality(twice(pts), { features: F, weights: WT, holds: model, scale: false, position: false }).gestures[0].overlaps;

    it('holds a dwell through a single rejected frame (a flicker the tracker holds through)', () => {
      const FLICKER: P = [5, 0];
      expect(classify(base, { a: 5, b: 0 })).toMatchObject({ categoryId: null, rejected: true });
      // home, out to aside (the line's last frame is on it), 6 frames there, one rejected frame, 6
      // more, back home: each half of the dwell (198 ms) is under the 220 ms bar, the whole
      // (429 ms) is well over it.
      const pts = [...hold([0, 0], 2), ...line([0, 0], [10, 0], 6), ...hold([10, 0], 6), FLICKER, ...hold([10, 0], 6), ...line([10, 0], [0, 0], 6), ...hold([0, 0], 2)];
      const solid = pts.map((p) => (p === FLICKER ? ([10, 0] as P) : p));
      const ASIDE_ID = base.categories[1].id;
      expect(overlapsOf(pts, base)).toEqual([{ category: ASIDE_ID, traces: 2, longestMs: 13 * DT }]);
      expect(overlapsOf(pts, base)).toEqual(overlapsOf(solid, base));
      // Two rejected frames are the hand moving away: the halves stay apart, neither dwells.
      const away = pts.flatMap((p) => (p === FLICKER ? [FLICKER, FLICKER] : [p]));
      expect(overlapsOf(away, base)).toEqual([]);
    });

    it('a return to the starting pose mid-way, after a taught Neutral, is a fresh entry and counts', () => {
      const neutral = trainNeutral([...HOME, ...ASIDE_CLOUD, ...NEUTRAL_CLOUD], NEUTRAL_CLOUD.map((_, i) => 40 + i), F, WT, base.categories);
      const model: TrainedModel = { ...base, neutral };
      expect(classify(model, { a: 0, b: 10 })).toMatchObject({ categoryId: null, neutral: true });
      // home, Neutral for about 330 ms, home again for 429 ms, then Neutral to the end.
      const pts = [...hold([0, 0], 2), ...line([0, 0], [0, 10], 5), ...hold([0, 10], 10), ...line([0, 10], [0, 0], 5), ...hold([0, 0], 13), ...line([0, 0], [0, 10], 5), ...hold([0, 10], 3)];
      const HOME_ID = base.categories[0].id;
      expect(overlapsOf(pts, model)).toEqual([{ category: HOME_ID, traces: 2, longestMs: 13 * DT }]);
      // The leading home run (the pose it starts from) alone is exempt: cut the return, nothing.
      const noReturn = [...hold([0, 0], 2), ...line([0, 0], [0, 10], 5), ...hold([0, 10], 10)];
      expect(overlapsOf(noReturn, model)).toEqual([]);
    });
  });

  it('a longer dwell bar lets the reach through; no held model measures nothing', () => {
    const q = gestureQuality(reach, { ...OPTS, holds, dwellMs: 1000 });
    expect(byName(q, 'reach').overlaps).toEqual([]);
    expect(byName(gestureQuality(reach, OPTS), 'reach').overlaps).toBeNull();
    // A held model on features the traces do not carry cannot be read: not measured.
    const elsewhere = { ...holds, features: ['face.mouth.open'], weights: { 'face.mouth.open': 1 } };
    expect(byName(gestureQuality(reach, { ...OPTS, holds: elsewhere }), 'reach').overlaps).toBeNull();
  });
});

describe('the categorizer file: the gestures section', () => {
  /** A minimal version-3 categorizer of two held categories, as a build before #753 wrote it. */
  const OLD: PersonalCategorizer = PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'hands',
    modality: 'hand',
    features: ['a', 'b'],
    weights: { a: 1, b: 1 },
    strangers: 'nearest',
    samples: [
      { id: 't:0', vector: { a: 0, b: 0 }, t: 0, cue: 'c' },
      { id: 't:1', vector: { a: 1, b: 1 }, t: 1, cue: 'c' },
    ],
    categories: [
      { id: 'cat-1', label: 'open', members: ['t:0'] },
      { id: 'cat-2', label: 'fist', members: ['t:1'] },
    ],
    neutral: [],
  });
  const TRACES = [...CUTS.wave.traces, ...CUTS.circle.traces];
  const section = gestureSection(TRACES, OPTS);
  const withGestures: PersonalCategorizer = { ...OLD, gestures: section };

  it('an old file without the section still parses, and has no gestures', () => {
    const r = importCategorizer(exportCategorizer(OLD));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.categorizer.gestures).toBeUndefined();
    expect(gestureTraces(OLD)).toEqual([]);
  });

  it('projects each trace onto the gesture\'s features, rounded, with ids, labels and one weights map', () => {
    expect(section.items.map((g) => [g.id, g.label, g.traces.length])).toEqual([
      ['gesture-1', 'wave', 5],
      ['gesture-2', 'circle', 5],
    ]);
    const g = section.items[0];
    expect(g.features).toEqual(POSITION);
    // One map for the section: the session's weight of every feature a gesture lists, no others.
    expect(Object.keys(section.weights).sort()).toEqual([...POSITION].sort());
    for (const f of POSITION) expect(section.weights[f]).toBe(WEIGHTS[f]);
    const src = CUTS.wave.traces[0];
    const stored = g.traces[0];
    expect(stored.id).toBe(src.id);
    expect(stored.rows).toHaveLength(src.samples.length);
    // Each row is one value per feature: the full vector (hundreds of ids) is not kept.
    expect(Object.keys(src.samples[0].vector).length).toBeGreaterThan(3 * POSITION.length);
    for (const row of stored.rows) expect(row).toHaveLength(POSITION.length);
    const x = src.samples[3].vector[POSITION[0]];
    expect(stored.rows[3][0]).toBe(Number(x.toFixed(SUPPORT_DECIMALS)));
    expect(stored.t0 + stored.t[3]).toBeCloseTo(src.samples[3].t, 1);
    // Per gesture features, and an existing id kept.
    const own = gestureSection(TRACES, { ...OPTS, features: (name) => (name === 'wave' ? POSITION.slice(0, 2) : POSITION), ids: new Map([['wave', 'g-wave']]) });
    expect(own.items[0]).toMatchObject({ id: 'g-wave', features: POSITION.slice(0, 2) });
    expect(own.items[0].traces[0].rows[0]).toHaveLength(2);
    expect(own.items[1].id).toBe('gesture-1');
  });

  it('a gesture keeps its id when another is deleted and the categorizer re-saved', () => {
    // Delete the wave (gesture-1), re-save with the ids the file had: the circle stays gesture-2.
    const resaved = gestureSection(CUTS.circle.traces, { ...OPTS, ids: gestureIds(withGestures) });
    expect(resaved.items.map((g) => [g.id, g.label])).toEqual([['gesture-2', 'circle']]);
    // A new gesture then takes the smallest free id, never a kept one or a category's.
    const added = gestureSection([...CUTS.circle.traces, ...CUTS.nod.traces], { ...OPTS, ids: gestureIds({ gestures: resaved }), taken: ['gesture-1'] });
    expect(added.items.map((g) => g.id)).toEqual(['gesture-2', 'gesture-3']);
    expect(freshGestureId(new Set(['gesture-1', 'gesture-3']))).toBe('gesture-2');
    // And a new held category never takes a gesture's id.
    const withCustomIds: PersonalCategorizer = { ...OLD, gestures: gestureSection(TRACES, { ...OPTS, ids: new Map([['wave', 'cat-3']]) }) };
    expect(freshCategoryId(withCustomIds)).toBe('cat-4');
  });

  it('refuses at save a feature with no weight, or a gesture whose features all weigh 0', () => {
    const { [POSITION[0]]: _dropped, ...partial } = WEIGHTS;
    expect(() => gestureSection(TRACES, { ...OPTS, weights: partial })).toThrow(`feature "${POSITION[0]}" of gesture "wave" has no weight`);
    const zero = Object.fromEntries(POSITION.map((f) => [f, 0]));
    expect(() => gestureSection(TRACES, { ...OPTS, weights: zero })).toThrow('gesture "wave" has no feature with a weight above 0');
    // The schema says the same of a file, rather than letting the gesture vanish from the model.
    expect(importCategorizer({ ...withGestures, gestures: { ...section, weights: partial } })).toMatchObject({ ok: false });
    const dead = importCategorizer({ ...withGestures, gestures: { ...section, weights: { ...section.weights, ...zero } } });
    expect(dead.ok).toBe(false);
    if (!dead.ok) expect(dead.error).toContain('no feature with a weight above 0');
  });

  it('bounds the trace frames at the import door, never in the schema (a saved record still loads)', () => {
    const frames = (c: PersonalCategorizer) => c.gestures!.items.reduce((n, g) => n + g.traces.reduce((m, tr) => m + tr.rows.length, 0), 0);
    const tr = section.items[0].traces[0];
    const copies = Math.ceil(MAX_GESTURE_FRAMES / tr.rows.length) + 1;
    const huge: PersonalCategorizer = {
      ...withGestures,
      gestures: { ...section, items: [{ ...section.items[0], traces: Array.from({ length: copies }, (_, i) => ({ ...tr, id: `big#${i}` })) }] },
    };
    expect(frames(huge)).toBeGreaterThan(MAX_GESTURE_FRAMES);
    const r = importCategorizer(huge);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('too many trace frames');
    // The same document as a SAVED record (the schema, no door): it loads, bindings and all.
    expect(PersonalCategorizerSchema.safeParse(huge).success).toBe(true);
    const record = { id: 'hand:x', name: 'x', createdAt: 0, model: { categorizer: huge, bindings: { 'gesture-1': { command: 'chord.next' } } } };
    expect(parseRecord(record)?.model).toMatchObject({ bindings: { 'gesture-1': { command: 'chord.next' } } });
  });

  it('round-trips through export and import, version unchanged, and derives the same matcher', () => {
    const text = exportCategorizer(withGestures);
    const r = importCategorizer(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.migratedFrom).toBeNull();
    expect(r.categorizer.version).toBe(CATEGORIZER_VERSION);
    expect(r.categorizer.gestures).toEqual(section);
    // Read back: traces named by the gesture's id, on its features.
    const back = gestureTraces(r.categorizer);
    expect(back.map((t) => t.id)).toEqual(TRACES.map((t) => t.id));
    expect(back[0].gesture).toBe('gesture-1');
    expect(gestureSpace(r.categorizer).featuresOf['gesture-2']).toEqual(POSITION);
    // The model is derived from the stored traces: a fresh circle is matched as the circle's id.
    const model = gestureModelFromCategorizer(r.categorizer);
    expect(model.gestures.map((g) => g.gesture)).toEqual(['gesture-1', 'gesture-2']);
    const fresh = cutTraces('circle', takeOf('circle', { seed: 7 })).traces[0];
    expect(matchSegment(model, fresh.samples).gesture).toBe('gesture-2');
    // The same radii as the model from the unrounded session traces, to the rounding.
    const live = buildGestureModel(TRACES, OPTS);
    model.gestures.forEach((g, i) => expect(g.radius).toBeCloseTo(live.gestures[i].radius, 3));
  });

  it('an older build drops the section on read (it is additive)', () => {
    // An older build's schema does not declare `gestures`, and the schema strips what it does not
    // declare (as this one does a section from a newer build): the file still loads there.
    const future = PersonalCategorizerSchema.parse({ ...JSON.parse(exportCategorizer(withGestures)), sectionFromTheFuture: [1, 2] });
    expect('sectionFromTheFuture' in future).toBe(false);
    expect(future.gestures).toEqual(section);
  });

  it('refuses a gesture id a category already has, a row of the wrong width, and time going back', () => {
    const bad = (items: unknown) => importCategorizer({ ...withGestures, gestures: { ...section, items } });
    const [g1, g2] = section.items;
    expect(bad([{ ...g1, id: 'cat-1' }]).ok).toBe(false);
    expect(bad([{ ...g1, id: 'neutral' }]).ok).toBe(false);
    expect(bad([g1, { ...g2, id: g1.id }]).ok).toBe(false);
    const tr = g1.traces[0];
    expect(bad([{ ...g1, traces: [{ ...tr, rows: tr.rows.map((r) => r.slice(1)) }] }]).ok).toBe(false);
    expect(bad([{ ...g1, traces: [{ ...tr, t: [...tr.t].reverse() }] }]).ok).toBe(false);
    expect(bad([g1, { ...g2, traces: [g1.traces[0]] }]).ok).toBe(false);
    expect(bad(section.items).ok).toBe(true);
  });
});

describe('gestureEveryday: false fires over ordinary movement', () => {
  const model = buildGestureModel([...CUTS.wave.traces, ...CUTS.push.traces], OPTS);
  /** A minute-long stream: six movements 10 s apart, of whatever path, a little bigger. */
  const stream = (path: keyof typeof GESTURE_PATHS) => takeOf(path, { seed: 9, waves: 6, pauseMs: 9000, amplitude: 0.3 }).frames;
  const run = (path: keyof typeof GESTURE_PATHS) => {
    const noise = createNoiseEstimator();
    return gestureEveryday(stream(path), { matcher: createDtwMatcher({ model, noise }), noise, at: '2026-11-02T00:00:00Z', labels: new Map([['push', 'push']]) });
  };

  it('counts every accidental fire, and flags at the held categories\' rate', () => {
    // Reaching for things six times a minute: each reach is a push.
    const r = run('push');
    expect(r.fires).toEqual({ push: 6 });
    expect(r.durationMs).toBeGreaterThan(50_000);
    const flags = everydayFlags(r);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ categoryId: 'push', label: 'push', fires: 6 });
    expect(flags[0].perMinute).toBeCloseTo(6 / (r.durationMs / 60_000), 9);
  });

  it('counts nothing over movement that looks like no taught gesture', () => {
    const r = run('diagonal');
    expect(r.fires).toEqual({});
    expect(everydayFlags(r)).toEqual([]);
  });

  it('stops at the check\'s duration', () => {
    const noise = createNoiseEstimator();
    const r = gestureEveryday(stream('push'), { matcher: createDtwMatcher({ model, noise }), noise, at: 'x', durationMs: 20_000 });
    // The first two pushes start at 2 s and 12 s and fire at their ends; the third at 22 s is past.
    expect(r.fires).toEqual({ push: 2 });
    expect(r.durationMs).toBeLessThanOrEqual(20_000);
  });
});
