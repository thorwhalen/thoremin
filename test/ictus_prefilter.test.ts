/**
 * The ictus detector's prefilter (#231): the raw samples time the anchor, a spike (a
 * jump faster than a hand can move) is bridged, and nothing spurious comes out of the
 * streams a real camera pipeline produces.
 *
 * Synthetic trains at 30 fps, corrupted three ways: one-frame spikes (a landmark jumping
 * by more than the stroke itself and back), dropouts (frames missing), and the
 * sample-and-hold stream a 30 fps camera polled at 60 Hz gives (every position twice,
 * then a jump: Safari until the pump fix of the timing plan's step 0), where an
 * acceleration rule without the velocity-reversal test would fire on every
 * duplicate-then-jump. In every case spurious anchors are 0 and the beats are still
 * found. The `none` prefilter on the spiked train is the control: it proves the spikes
 * would have fired.
 *
 * The timing claim itself — the shipped detector at or under the unfiltered one's
 * spread on the sub-frame bench, with no stroke missed — is `scripts/subframe/score.ts`'s
 * `parabola` against `parabolaRaw` and `parabolaMedian`; here the sub-frame assertion of
 * `ictus_detector.test.ts` is repeated under the corruptions, and the pre-#231 median
 * prefilter is shown to confirm a sharp stroke one frame later than the shipped one,
 * 5 ms late.
 */
import { describe, it, expect } from 'vitest';
import { createIctusDetector, excursion, type DetectorOptions, type Sample } from '@thoremin/ictus';

const FPS = 30;
const PERIOD = 0.7;
const PHASE = 0.0123;
const AMP = 100;
const SECONDS = 8;
/** The first strokes are left clean so the envelope exists before anything is corrupted. */
const CLEAN_SECONDS = 1.5;
/** An anchor further than this from every true ictus is spurious (seconds). */
const SPURIOUS_WINDOW = 0.05;
/** The sub-frame bound the clean train is pinned to (seconds). */
const CLEAN_TOLERANCE = 0.008;

function stroke(t: number): { x: number; y: number } {
  const u = (2 * Math.PI * (t - PHASE)) / PERIOD;
  return { x: 300 + 20 * Math.sin(u / 2), y: 300 + (AMP * (Math.cos(u) + 1)) / 2 };
}

function train(): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i * (1 / FPS) <= SECONDS; i++) out.push({ t: i / FPS, ...stroke(i / FPS) });
  return out;
}

/** A sharp V at every ictus (a stick on a table): the position is a triangle wave. Its
 *  period is not a whole number of frames, so the bottom's offset from the sample grid
 *  varies from stroke to stroke (at 21 frames exactly every stroke would land alike). */
const SHARP_PERIOD = 20.5 / FPS;
function triangleTrain(): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i * (1 / FPS) <= SECONDS; i++) {
    const t = i / FPS;
    const phase = (((t - PHASE) / SHARP_PERIOD) % 1 + 1) % 1;
    out.push({ t, x: 300, y: 300 + AMP * Math.abs(2 * phase - 1) });
  }
  return out;
}
const trueSharpIctus = (t: number) => PHASE + Math.round((t - PHASE) / SHARP_PERIOD) * SHARP_PERIOD;

/** A small deterministic generator (mulberry32), so the corruptions are the same every run. */
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

/** Every `every`-th sample after the clean lead-in jumps by `size` along the stroke
 *  axis, up or down at random, with a smaller random lateral jump. (A jump that is
 *  mostly lateral and only a little vertical is the one case the newest sample cannot
 *  be deferred on, since a lateral jump is also what the tracker swapping hands for a
 *  frame looks like; that case is left to the amplitude gates.) */
function withSpikes(samples: Sample[], size: number, every: number, seed = 1): Sample[] {
  const next = rng(seed);
  return samples.map((s, i) => {
    if (s.t < CLEAN_SECONDS || i % every !== 0) return s;
    const up = next() < 0.5 ? -1 : 1;
    return { t: s.t, x: s.x + 0.3 * size * (2 * next() - 1), y: s.y + up * size };
  });
}

/** Every `every`-th sample after the clean lead-in is missing. */
function withDropouts(samples: Sample[], every: number): Sample[] {
  return samples.filter((s, i) => s.t < CLEAN_SECONDS || i % every !== 0);
}

/** The 60 Hz poll of a 30 fps camera: each position reported twice, half a frame apart. */
function sampleAndHold(samples: Sample[]): Sample[] {
  return samples.flatMap((s) => [s, { ...s, t: s.t + 0.5 / FPS }]);
}

function anchors(samples: Sample[], options: DetectorOptions = {}): { t: number; at: number }[] {
  const det = createIctusDetector(options);
  const out: { t: number; at: number }[] = [];
  for (const s of samples) {
    const a = det.push(s);
    if (a) out.push({ t: a.t, at: s.t });
  }
  return out;
}

const trueIctus = (t: number) => PHASE + Math.round((t - PHASE) / PERIOD) * PERIOD;
/** Mean confirmation latency: the confirming sample's time past the TRUE ictus (not past
 *  the anchor's own time, which the median prefilter puts 5 ms late). */
const lag = (xs: { t: number; at: number }[]) => xs.reduce((s, a) => s + (a.at - trueIctus(a.t)), 0) / xs.length;
const expectedBeats = (from: number, to: number) => Math.floor((to - PHASE) / PERIOD) - Math.ceil((from - PHASE) / PERIOD) + 1;

function audit(found: { t: number }[]) {
  const spurious = found.filter((a) => Math.abs(a.t - trueIctus(a.t)) > SPURIOUS_WINDOW).length;
  const beats = new Set(found.map((a) => Math.round((a.t - PHASE) / PERIOD)));
  return { spurious, doubled: found.length - spurious - beats.size, beats: beats.size };
}

describe('ictus prefilter (#231): the raw samples time, the spikes are bridged', () => {
  it('a sharp stroke is confirmed on the first sample past its bottom, timed to the millisecond; the median prefilter is never earlier and is biased', () => {
    const sharp = triangleTrain();
    const shipped = anchors(sharp);
    const median = anchors(sharp, { prefilter: 'median' });
    expect(shipped.length).toBeGreaterThanOrEqual(10);
    const lagOf = (a: { t: number; at: number }) => a.at - trueSharpIctus(a.t);
    for (const a of shipped) {
      expect(Math.abs(a.t - trueSharpIctus(a.t))).toBeLessThan(CLEAN_TOLERANCE);
      expect(lagOf(a)).toBeGreaterThan(0);
      expect(lagOf(a)).toBeLessThan(2.5 / FPS);
    }
    // Confirmed by the first sample past the bottom whenever that sample has come
    // back by more than the margin, which a V this slow (a frame's travel is a tenth
    // of the stroke) fails only when its bottom falls midway between two samples.
    const firstFrame = shipped.filter((a) => lagOf(a) < 1.5 / FPS).length / shipped.length;
    expect(firstFrame).toBeGreaterThanOrEqual(0.5);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(shipped.map(lagOf))).toBeLessThanOrEqual(mean(median.map(lagOf)) + 1e-9);
    // The median's vertex sits on a neighbour of the bottom sample: biased by several
    // milliseconds either way (the bench's 5 ms; `scripts/subframe/score.ts`).
    const bias = (xs: { t: number }[]) => mean(xs.map((a) => Math.abs(a.t - trueSharpIctus(a.t))));
    expect(bias(median)).toBeGreaterThan(bias(shipped) + 0.003);
  });

  it('a smooth stroke is timed exactly and confirmed never later than the median prefilter', () => {
    // A smooth turn comes back by well under the reversal margin on its first frame
    // whenever its bottom falls just before a sample, so it is confirmed on the
    // second: the frame the median prefilter always costs, paid only when the first
    // sample cannot tell a turn from a wobble.
    const clean = train();
    const shipped = anchors(clean);
    const median = anchors(clean, { prefilter: 'median' });
    expect(shipped.length).toBeGreaterThanOrEqual(10);
    for (const a of shipped) {
      expect(Math.abs(a.t - trueIctus(a.t))).toBeLessThan(CLEAN_TOLERANCE);
      expect(a.at - a.t).toBeGreaterThan(0);
      expect(a.at - a.t).toBeLessThan(2.5 / FPS);
    }
    expect(lag(shipped)).toBeLessThanOrEqual(lag(median) + 1e-9);
  });

  it('the deprecated medianFilter switch still selects the old behaviour', () => {
    const clean = train();
    expect(anchors(clean, { medianFilter: true })).toEqual(anchors(clean, { prefilter: 'median' }));
    expect(anchors(clean, { medianFilter: false })).toEqual(anchors(clean, { prefilter: 'none' }));
  });

  it('excursion: a duplicate-then-jump never reverses, a spike does; a dropped frame is handled', () => {
    const held = excursion({ t: 0, x: 0, y: 0 }, { t: 1 / 60, x: 0, y: 0 }, { t: 1 / 30, x: 0, y: 50 });
    expect(held.reverses).toBe(false);
    const spike = excursion({ t: 0, x: 0, y: 0 }, { t: 1 / 30, x: 0, y: 250 }, { t: 2 / 30, x: 0, y: 5 });
    expect(spike.reverses).toBe(true);
    expect(spike.inSpeed).toBeCloseTo(250 * 30, 6);
    expect(spike.outSpeed).toBeCloseTo(245 * 30, 6);
    // A dropped frame on one side: the two speeds are each over their own gap.
    const gapped = excursion({ t: 0, x: 0, y: 0 }, { t: 2 / 30, x: 0, y: 20 }, { t: 3 / 30, x: 0, y: 30 });
    expect(gapped.inSpeed).toBeCloseTo(gapped.outSpeed, 6);
    expect(gapped.reverses).toBe(false);
  });

  it('one-frame spikes larger than the stroke: no spurious anchor, every beat found; without the rule they fire', () => {
    const spiked = withSpikes(train(), 2.5 * AMP, 7);
    const shipped = audit(anchors(spiked));
    expect(shipped.spurious).toBe(0);
    expect(shipped.doubled).toBe(0);
    expect(shipped.beats).toBeGreaterThanOrEqual(expectedBeats(1 / FPS, SECONDS) - 1);
    // The control: trusting every sample, the same spikes make false bottoms.
    expect(audit(anchors(spiked, { prefilter: 'none' })).spurious).toBeGreaterThan(0);
  });

  it('an absolute ceiling in the caller\'s units works before any envelope exists', () => {
    // Spikes from the first sample on: the relative ceiling has no envelope yet, the
    // absolute one does not need it. The hand here never exceeds AMP * pi / PERIOD.
    const spiked = withSpikes(train(), 2.5 * AMP, 7).map((s, i) => (i % 7 === 0 && s.t < CLEAN_SECONDS ? { ...s, y: s.y + 2.5 * AMP } : s));
    const shipped = audit(anchors(spiked, { maxSpeed: (4 * AMP * Math.PI) / PERIOD }));
    expect(shipped.spurious).toBe(0);
  });

  it('dropouts: no spurious anchor, the beats are still found at their time', () => {
    const found = anchors(withDropouts(train(), 5));
    const a = audit(found);
    expect(a.spurious).toBe(0);
    expect(a.doubled).toBe(0);
    expect(a.beats).toBeGreaterThanOrEqual(expectedBeats(1 / FPS, SECONDS) - 1);
    // A missing neighbour widens the fit's step; the error stays under a frame.
    for (const x of found) expect(Math.abs(x.t - trueIctus(x.t))).toBeLessThan(1 / FPS);
  });

  it('sample-and-hold pairs (the raf-poll regime): no spurious anchor, no beat counted twice', () => {
    const found = anchors(sampleAndHold(train()));
    const a = audit(found);
    expect(a.spurious).toBe(0);
    expect(a.doubled).toBe(0);
    expect(a.beats).toBeGreaterThanOrEqual(expectedBeats(1 / FPS, SECONDS) - 1);
    // The held copy of the bottom sample bounds the error to half a camera frame.
    for (const x of found) expect(Math.abs(x.t - trueIctus(x.t))).toBeLessThan(1 / FPS);
    // (A spike held twice is a two-sample plateau, which no three-sample rule can
    // tell from a real position; the pump fix of the timing plan's step 0 is what
    // removes the regime, and this test is its regression guard.)
  });
});
