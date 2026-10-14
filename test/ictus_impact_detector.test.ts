/**
 * The anchor-detector seam and the body's impact detector (#374, body-movement A2), on
 * synthetic bodies whose beats are known exactly (`helpers/body_bounce.ts`): the
 * beating wrist strokes, its elbow follows, the trunk bounces with a sharp bottom.
 *
 * - The SEAM: `createIctus` takes a detector instance the way it takes a prior, and the
 *   stroke detector behind the seam is the stroke detector, bit for bit (the conducting
 *   fixtures' own scores are pinned unchanged in `ictus_detector.test.ts`).
 * - The DETECTOR: the follower locks within three beats, follows an accelerando, keeps
 *   the beat when the joint it follows is lost, is blind to the camera's distance, and
 *   fills the anchor as the stroke detector does.
 */
import { describe, it, expect } from 'vitest';
import {
  createIctus,
  createIctusDetector,
  createImpactDetector,
  createRhythmPrior,
  createStrokeDetector,
  fMeasure,
  parabolicOffset,
  parabolicVertex,
  quadraticCurvature,
  sampleFrame,
  type Anchor,
  type AnchorDetector,
  type ChannelFrame,
  type ImpactDetector,
  type Sample,
} from '@thoremin/ictus';
import { bounce } from './helpers/body_bounce';
import { loadStream } from './helpers/fixtures';
import type { HandsFrame } from '@/nodes';

const F_WINDOW = 0.07;

function run(frames: readonly ChannelFrame[], detector: AnchorDetector) {
  const ictus = createIctus({ detector });
  const anchors: Anchor[] = [];
  const states = frames.map((f) => {
    const s = ictus.feedFrame(f);
    if (s.anchor) anchors.push(s.anchor);
    return s;
  });
  return { anchors, times: anchors.map((a) => a.t), states, ictus };
}

const nearest = (beats: readonly number[], t: number) => beats.reduce((m, b) => Math.min(m, Math.abs(b - t)), Infinity);

describe('the AnchorDetector seam', () => {
  it('createIctus takes a detector instance, as it takes a prior', () => {
    const det = createImpactDetector();
    expect(createIctus({ detector: det }).detector).toBe(det);
  });

  it('the default stroke detector behind the seam is the stroke detector, bit for bit, on a conducting fixture', () => {
    const frames = loadStream('conducting_44', 'src.hands') as HandsFrame[];
    const samples: Sample[] = [];
    frames.forEach((f, i) => {
      const hand = f.hands.find((h) => h.handedness === 'Right') ?? f.hands[0];
      if (hand) samples.push({ t: i / 30, x: hand.keypoints[0].x / f.height, y: hand.keypoints[0].y / f.height });
    });
    const direct = createIctusDetector();
    const want = samples.map((s) => direct.push(s)).filter((a): a is Anchor => a !== null);
    const named = createStrokeDetector({ channel: 'wrist' });
    const viaChannel = samples.map((s) => named.push(sampleFrame(s, 'wrist'))).filter((a): a is Anchor => a !== null);
    expect(want.length).toBeGreaterThan(10);
    expect(viaChannel).toEqual(want);
    // The facade as it was before the seam: the detector, the prior, the period fed back.
    const det = createIctusDetector();
    const prior = createRhythmPrior();
    const before: Anchor[] = [];
    for (const s of samples) {
      const a = det.push(s);
      if (!a) continue;
      before.push(a);
      prior.update(a);
      det.setPeriod(prior.state().period);
    }
    const ictus = createIctus();
    const viaFacade = samples.map((s) => ictus.feed(s).anchor).filter((a): a is Anchor => a !== null);
    expect(viaFacade).toEqual(before);
  });

  it('a stroke detector on a named channel skips frames without it, or with it unseen', () => {
    const det = createStrokeDetector({ channel: 'wrist' });
    const b = bounce({ seconds: 6 });
    let fired = 0;
    for (const f of b.frames) {
      expect(det.push({ t: f.t, channels: { elbow: f.channels.elbow } })).toBeNull();
      expect(det.push({ t: f.t, channels: { wrist: { ...f.channels.wrist!, visibility: 0.1 } } })).toBeNull();
    }
    det.reset();
    for (const f of b.frames) if (det.push(f)) fired++;
    expect(fired).toBeGreaterThan(5);
  });
});

describe('createImpactDetector (synthetic multi-joint bounces)', () => {
  it('the follower locks within three beats', () => {
    const b = bounce({ seconds: 8 });
    const { states } = run(b.frames, createImpactDetector());
    // Just after the third beat, the follower runs and predicts the fourth.
    const at = b.frames.findIndex((f) => f.t > b.beats[2] + 0.1);
    const s = states[at];
    expect(s.state).toBe('running');
    expect(Math.abs(s.nextBeatAt - b.beats[3])).toBeLessThan(0.04);
    expect(s.tempo).toBeGreaterThan(95);
    expect(s.tempo).toBeLessThan(105);
  });

  it('marks every beat at a steady tempo, within a few milliseconds, with the anchor filled', () => {
    const b = bounce();
    const { anchors, times } = run(b.frames, createImpactDetector());
    expect(fMeasure(times, b.beats, F_WINDOW)).toBeGreaterThan(0.97);
    const errs = times.map((t) => nearest(b.beats, t)).sort((x, y) => x - y);
    expect(errs[errs.length >> 1]).toBeLessThan(0.015);
    const steady = anchors.slice(4);
    for (const a of steady) {
      expect(a.strength).toBeGreaterThan(0.7);
      expect(a.strength).toBeLessThan(1.3);
      expect(a.confidence).toBeGreaterThan(0.5);
      expect(Number.isFinite(a.sharpness) && a.sharpness > 0).toBe(true);
    }
  });

  it('follows an accelerando (90 to 120 bpm over 15 s)', () => {
    const b = bounce({ seconds: 20, bpm: (t) => 90 + 30 * Math.min(1, t / 15) });
    const { times, states } = run(b.frames, createImpactDetector());
    expect(fMeasure(times, b.beats, F_WINDOW)).toBeGreaterThan(0.95);
    expect(Math.abs(states[states.length - 1].tempo - 120)).toBeLessThan(3);
  });

  it('keeps the beat when the joint it follows is lost, and returns to it', () => {
    const lost = (c: string, t: number) => (c === 'wrist' && t > 6 && t < 11 ? 0 : 0.99);
    const b = bounce({ seconds: 18, visibility: lost });
    const det = createImpactDetector();
    const ictus = createIctus({ detector: det });
    const times: number[] = [];
    const followed = new Set<string>();
    let running = true;
    for (const f of b.frames) {
      const s = ictus.feedFrame(f);
      if (s.anchor) times.push(s.anchor.t);
      if (f.t > 6.5 && f.t < 11) {
        followed.add(det.selected()!);
        running &&= s.state === 'running';
      }
    }
    expect(followed.has('wrist')).toBe(false);
    expect(running).toBe(true);
    const inGap = (x: number) => x > 6.2 && x < 11;
    expect(fMeasure(times.filter(inGap), b.beats.filter(inGap), F_WINDOW)).toBeGreaterThan(0.9);
    expect(fMeasure(times, b.beats, F_WINDOW)).toBeGreaterThan(0.95);
    expect(det.selected()).toBe('wrist');
  });

  it('is blind to the camera distance: positions are in body units, peaks in noise units', () => {
    const near = run(bounce({ zoom: 3 }).frames, createImpactDetector()).times;
    const far = run(bounce().frames, createImpactDetector()).times;
    expect(near.length).toBe(far.length);
    near.forEach((t, i) => expect(t).toBeCloseTo(far[i], 9));
  });

  it('weights a periodic joint over a wandering one', () => {
    const b = bounce({ seconds: 10, trunkPx: 30 });
    // The elbow wanders: its height is replaced by a slow random walk.
    let walk = 330;
    let seed = 7;
    const wander: ChannelFrame[] = b.frames.map((f) => {
      seed = (seed * 16807) % 2147483647;
      walk += ((seed / 2147483647) - 0.5) * 6;
      return { ...f, channels: { ...f.channels, elbow: { x: 380, y: walk, visibility: 0.99 } } };
    });
    const det = createImpactDetector() as ImpactDetector;
    run(wander, det);
    const p = det.periodicity();
    expect(p.wrist).toBeGreaterThan(0.6);
    expect(p.trunk).toBeGreaterThan(0.4);
    expect(p.elbow).toBeLessThan(0.2);
  });

  it('the weighted envelope (design 3.3) also marks the beat', () => {
    const b = bounce();
    const { times } = run(b.frames, createImpactDetector({ combine: 'weighted' }));
    expect(fMeasure(times, b.beats, F_WINDOW)).toBeGreaterThan(0.9);
  });

  it('the bounce option: the trunk alone, directional impact at the bottom', () => {
    const b = bounce({ trunkPx: 30, noisePx: 0.2 });
    const { times } = run(b.frames, createImpactDetector({ joints: ['trunk'], event: 'impact' }));
    expect(fMeasure(times, b.beats, F_WINDOW)).toBeGreaterThan(0.9);
    // The same bounce read at its top is half a beat away from every beat.
    const top = run(b.frames, createImpactDetector({ joints: ['trunk'], polarity: 'top' })).times;
    expect(fMeasure(top, b.beats, F_WINDOW)).toBeLessThan(0.1);
  });

  it('a small, noisy bounce: the impact event fits a parabola, not a second difference (#425)', () => {
    const b = bounce({ trunkPx: 10, noisePx: 1, seconds: 30 });
    const fit = run(b.frames, createImpactDetector({ joints: ['trunk'], event: 'impact' })).times;
    const diff = run(b.frames, createImpactDetector({ joints: ['trunk'], event: 'impact', impactSpan: 0 })).times;
    expect(fMeasure(fit, b.beats, F_WINDOW)).toBeGreaterThan(0.9);
    expect(fMeasure(diff, b.beats, F_WINDOW)).toBeLessThan(0.7);
    // Slow, too: the window grows with the follower's period.
    const slow = bounce({ trunkPx: 10, noisePx: 1, seconds: 30, bpm: () => 70 });
    expect(fMeasure(run(slow.frames, createImpactDetector({ joints: ['trunk'], event: 'impact' })).times, slow.beats, F_WINDOW)).toBeGreaterThan(0.85);
  });

  it('quadraticCurvature is exact on a parabola at uneven spacing', () => {
    const ts = [0, 0.03, 0.07, 0.1, 0.13, 0.2];
    expect(quadraticCurvature(ts.map((t) => ({ t, y: 4 + 3 * t - 5 * t * t })))).toBeCloseTo(-10, 9);
    expect(quadraticCurvature(ts.slice(0, 2).map((t) => ({ t, y: t })))).toBeNaN();
  });

  it('a joint that stops moving loses the beat after a period of stillness, not three (#425)', () => {
    const b = bounce({ seconds: 14 });
    // The wrist freezes at 8 s (visible, jittering by the tracker's noise only).
    const frozen = b.frames.map((f) => (f.t < 8 ? f : { ...f, channels: { ...f.channels, wrist: { ...f.channels.wrist, x: 400, y: 330 + 0.5 * Math.sin(97 * f.t) } } }));
    const switchTime = (stillIntervals?: number) => {
      const d = createImpactDetector(stillIntervals === undefined ? {} : { stillIntervals });
      const ictus = createIctus({ detector: d });
      let switchedAt = NaN;
      for (const f of frozen) {
        ictus.feedFrame(f);
        if (f.t > 8 && Number.isNaN(switchedAt) && d.selected() !== 'wrist') switchedAt = f.t;
      }
      return switchedAt;
    };
    const quick = switchTime();
    const slow = switchTime(99);
    expect(quick).toBeLessThan(slow - 0.4);
    expect(quick).toBeLessThan(9.3);
  });

  it('the weighted mode never steps its picker back when a joint misses a frame (#425)', () => {
    const b = bounce({ seconds: 20 });
    const missed = (c: string, t: number) => (c === 'wrist' && Math.round(t * 30) % 4 === 0 ? 0 : 0.99);
    const gappy = bounce({ seconds: 20, visibility: missed });
    const { times } = run(gappy.frames, createImpactDetector({ combine: 'weighted' }));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(fMeasure(times, b.beats, F_WINDOW)).toBeGreaterThan(0.5);
  });

  it('lateral is the followed joint’s horizontal travel, mirrored on request', () => {
    const b = bounce();
    const plain = run(b.frames, createImpactDetector({ joints: ['wrist'] })).anchors.slice(2);
    const mirrored = run(b.frames, createImpactDetector({ joints: ['wrist'], mirrorX: true })).anchors.slice(2);
    // The synthetic wrist sways one way on one beat and back on the next.
    expect(plain.some((a) => a.lateral > 0.1) && plain.some((a) => a.lateral < -0.1)).toBe(true);
    plain.forEach((a, i) => expect(mirrored[i].lateral).toBeCloseTo(-a.lateral, 9));
  });

  it('times the beat below the frame, off the frame grid and across dropped frames', () => {
    // 97 bpm from 0.417 s: no beat falls on a frame.
    const b = bounce({ bpm: () => 97, firstBeat: 0.417, noisePx: 0 });
    const median = (xs: number[]) => xs.sort((x, y) => x - y)[xs.length >> 1];
    const err = (frames: readonly ChannelFrame[], subframe: boolean) => median(run(frames, createImpactDetector({ joints: ['wrist'], subframe })).times.slice(2).map((t) => nearest(b.beats, t)));
    expect(err(b.frames, true)).toBeLessThan(0.002);
    expect(err(b.frames, false)).toBeGreaterThan(0.004);
    const dropped = b.frames.filter((_, i) => i % 3 !== 2);
    expect(err(dropped, true)).toBeLessThan(0.003);
  });

  it('parabolicVertex is parabolicOffset at equal spacing, and exact at any spacing', () => {
    const pts = [{ t: 1, v: 2 }, { t: 1.1, v: 3 }, { t: 1.2, v: 2.5 }] as const;
    expect(parabolicVertex(pts[0], pts[1], pts[2])).toBeCloseTo(1.1 + 0.1 * parabolicOffset(2, 3, 2.5), 12);
    const f = (t: number) => -4 * (t - 0.537) ** 2;
    const at = (t: number) => ({ t, v: f(t) });
    expect(parabolicVertex(at(0.5), at(0.54), at(0.6))).toBeCloseTo(0.537, 12);
  });

  it('a single dropped frame of the followed joint keeps it followed, and the strength steady', () => {
    const flicker = (c: string, t: number) => (c === 'wrist' && Math.round(t * 30) % 13 === 0 ? 0 : 0.99);
    const b = bounce({ visibility: flicker });
    const det = createImpactDetector();
    const ictus = createIctus({ detector: det });
    const followed = new Set<string>();
    const strengths: number[] = [];
    for (const f of b.frames) {
      const s = ictus.feedFrame(f);
      if (f.t > 3) followed.add(det.selected()!);
      if (s.anchor && f.t > 3) strengths.push(s.anchor.strength);
    }
    expect([...followed]).toEqual(['wrist']);
    expect(Math.min(...strengths)).toBeGreaterThan(0.7);
  });

  it('the strength is the followed joint’s own: a hand-over is not a diminuendo', () => {
    const lost = (c: string, t: number) => (c === 'wrist' && t > 6 && t < 11 ? 0 : 0.99);
    const b = bounce({ seconds: 16, visibility: lost, trunkPx: 30 });
    const { anchors } = run(b.frames, createImpactDetector());
    const late = anchors.filter((a) => a.t > 3);
    for (const a of late) {
      expect(a.strength).toBeGreaterThan(0.6);
      expect(a.strength).toBeLessThan(1.5);
    }
  });

  it('a preferred joint takes the beat back from the trunk once its rhythm is as good', () => {
    const lost = (c: string, t: number) => (c !== 'trunk' && t > 6 && t < 10 ? 0 : 0.99);
    const b = bounce({ seconds: 20, trunkPx: 20, visibility: lost });
    const det = createImpactDetector();
    const followed: string[] = [];
    const ictus = createIctus({ detector: det });
    for (const f of b.frames) {
      ictus.feedFrame(f);
      if (f.t > 7 && f.t < 9.5) followed.push(det.selected()!);
    }
    expect(new Set(followed)).toEqual(new Set(['trunk']));
    expect(det.selected()).toBe('wrist');
  });

  it('a scale first seen late starts the joints over in the new unit', () => {
    const b = bounce();
    const late = b.frames.map((f) => (f.t < 4 ? { ...f, scale: undefined } : f));
    const after = (x: number) => x > 4.5;
    const times = run(late, createImpactDetector()).times;
    expect(fMeasure(times.filter(after), b.beats.filter(after), F_WINDOW)).toBeGreaterThan(0.95);
  });

  it('a frame without a scale keeps the last body unit', () => {
    const b = bounce();
    const gap = b.frames.map((f) => (f.t > 8 && f.t < 10 ? { ...f, scale: undefined } : f));
    const inGap = (x: number) => x > 8 && x < 10.5;
    const times = run(gap, createImpactDetector()).times;
    expect(fMeasure(times.filter(inGap), b.beats.filter(inGap), F_WINDOW)).toBeGreaterThan(0.95);
  });

  it('reset() starts over', () => {
    const b = bounce({ seconds: 6 });
    const det = createImpactDetector();
    const first = run(b.frames, det).times;
    det.reset();
    expect(run(b.frames, det).times).toEqual(first);
  });
});
