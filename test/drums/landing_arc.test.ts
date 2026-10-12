/**
 * The landing point of a wide-arc stroke (#261), and a stick carried to a lower pad.
 *
 * What is pinned, on the pads demo take (`test/air/synthetic_drums.ts`, a stick swung
 * about the hand on a 0.6 to 0.7 rad arc, through the PRODUCTION graph): every scripted
 * stroke sounds its own pad with no false hit (13 of 13, 0 false; before: 10 on, 1 off, 2
 * missed, 1 false), with landmark noise as well as without, the centre strokes read near
 * the centre and the rim strokes near the rim, and the stroke after the arm's move to a
 * lower pad is still heard. Then the pieces: on an arc the fall's shape (x over depth)
 * lands within the pad where a line in time lands wide; a landing on no pad is read
 * along the path to the first pad it enters, at that pad's depth; a carried stick has no
 * swing and a wrist stroke is all swing.
 */
import { describe, it, expect } from 'vitest';
import { runHeadless } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { defaultGraph } from '@/app/graph';
import { fitLine } from '@thoremin/ictus';
import { fallingSegment, isCarried, landingAt, swingShare, type DrumHit, type TrackSample } from '@thoremin/ext-air/nodes/air_drum';
import { DEFAULT_AIR_DRUM } from '@thoremin/ext-air/dials';
import { DEFAULT_PADS_SET, hitPad, type FallPath, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { TRUE_STICK_LENGTH } from '../../scripts/air/lib_synthetic_grip';
import { DRUM_TAKE_FPS, DRUM_TAKE_HEIGHT, DRUM_TAKE_WIDTH, drumTake, scoreTake, starterKitPads, type DrumTakeOptions } from '../air/synthetic_drums';
import { AIR } from '../helpers/extensions';

const voice = { root: 4, type: 'minorPentatonic', octaves: 2, baseOctave: 2, sound: 'sine' } as const;

/** The demo take through the production graph, as `scripts/demos/instrument_take.ts` runs it. */
async function playTake(pads: Pads, options: DrumTakeOptions = {}) {
  const take = drumTake(pads, options);
  const registry = createAppRegistry();
  const g = defaultGraph({ source: 'replay-hands' }, registry);
  g.nodes.find((n) => n.id === 'cam')!.params = { frames: take.frames };
  const { recorder } = await runHeadless(g, registry, {
    ticks: take.frames.length,
    nominalDt: 1 / DRUM_TAKE_FPS,
    resources: {
      controls: () => ({ right: voice, left: voice, airDrum: { ...DEFAULT_AIR_DRUM, enabled: true, hand: 'right', pads, stickLength: TRUE_STICK_LENGTH } }),
      createDrumSink: () => ({ play: () => {}, close: () => {} }),
      createPluckSink: () => ({ play: () => {}, close: () => {} }),
    },
    recordOnly: ['airDrum.hits'],
  });
  const hits = (recorder.values('airDrum.hits') as DrumHit[][]).flat();
  return { ...take, hits, score: scoreTake(hits, take.script) };
}

describe.runIf(AIR)('the pads demo take (#261): every stroke on its pad, no false hit', () => {
  it('puts 13 of 13 strokes on their pads with 0 false hits, centre and rim read apart', async () => {
    const pads = starterKitPads();
    const { hits, overlay, score } = await playTake(pads);
    expect({ on: score.on, off: score.off, missed: score.missed, false: score.false }).toEqual({ on: 13, off: 0, missed: 0, false: 0 });
    for (const { stroke, hit } of score.perStroke) {
      const tip = overlay[Math.round(stroke.tLand * DRUM_TAKE_FPS)].tip;
      // The hit is read at the pad's depth, across the stroke where the tip really went.
      expect(Math.abs(hit!.x! - (1 - tip.x / DRUM_TAKE_WIDTH)), `${stroke.pad} ${stroke.where} ${stroke.force}`).toBeLessThan(0.01);
      expect(hit!.y).toBeCloseTo(pads[stroke.pad].y, 9);
      if (stroke.where === 'centre') expect(hit!.radial, `${stroke.pad} centre`).toBeLessThan(0.1);
      else expect(hit!.radial, `${stroke.pad} rim`).toBeGreaterThan(0.7);
    }
    // The arm's move from the crash (high) down to the snare, stick raised, used to sound
    // a false hit AND swallow the snare stroke after it; now the stroke is heard.
    expect(score.perStroke[score.perStroke.length - 1].hit).not.toBeNull();
    expect(hits).toHaveLength(13);
  });

  it('holds under landmark noise', async () => {
    const pads = starterKitPads();
    const { score } = await playTake(pads, { noise: 0.02, seed: 3 });
    expect({ on: score.on, off: score.off, missed: score.missed, false: score.false }).toEqual({ on: 13, off: 0, missed: 0, false: 0 });
  });
});

/** A stick tip on an arc about a fixed pivot, falling with a cosine ease (fastest
 *  mid-way, still at the bottom) from `lift` radians above the landing angle, sampled at
 *  `fps`, with the departure sample at the top. */
function arcFall(o: { lift: number; fall: number; fps: number; stick?: number; landAngle?: number }): { samples: TrackSample[]; bottom: { t: number; x: number; y: number } } {
  const { lift, fall, fps, stick = 170 / DRUM_TAKE_HEIGHT, landAngle = Math.PI - 0.1 } = o;
  const pivot = { x: 0.5 + stick, y: 0.6 };
  const at = (angle: number) => ({ x: pivot.x + stick * Math.cos(angle), y: pivot.y + stick * Math.sin(angle) });
  const n = Math.round(fall * fps);
  const samples: TrackSample[] = [];
  const hold = 3;
  for (let i = -hold; i <= n; i++) {
    const u = Math.max(0, i / n);
    const angle = landAngle + lift - (lift * (1 - Math.cos(Math.PI * u))) / 2;
    samples.push({ t: (i + hold) / fps, ...at(angle), grip: pivot });
  }
  const b = samples[samples.length - 1];
  return { samples, bottom: { t: b.t, x: b.x, y: b.y } };
}

describe('the landing point on a wide arc (#261)', () => {
  it('reads x off the fall\'s shape, within the pad where a line in time lands wide', () => {
    const { samples, bottom } = arcFall({ lift: 0.7, fall: 0.09, fps: 30 });
    // Committed one sample before the bottom, the predicted impact at the bottom's time.
    const seen = samples.slice(0, -1);
    const eps = 0.005;
    const land = landingAt(seen, bottom.t, eps, { floor: bottom.y });
    expect(land.y).toBeCloseTo(bottom.y, 9);
    expect(Math.abs(land.x - bottom.x)).toBeLessThan(0.002);
    expect(Math.abs(land.path.xAt(bottom.y) - bottom.x)).toBeLessThan(0.002);
    // The line in time over the same fall (what #245 shipped) is off by several times that.
    const seg = fallingSegment(seen, bottom.t, eps);
    const last = seg[seg.length - 1];
    const line = fitLine(seg.map((s) => s.t), seg.map((s) => s.x), last.t)!;
    expect(Math.abs(line.a + line.b * (bottom.t - last.t) - bottom.x)).toBeGreaterThan(0.015);
    // The path runs from the latest sample down to the depth the fit reaches, and its
    // shape passes through the samples it was fitted on.
    expect(land.path.yFrom).toBeCloseTo(last.y, 9);
    expect(land.path.yTo).toBeGreaterThanOrEqual(last.y);
    expect(land.path.xAt(last.y)).toBeCloseTo(last.x, 3);
  });

  it('a point with no lever keeps the line in time: a straight fall with a sideways drift lands where it goes', () => {
    // y = 0.2 + 3 (t - 0.2)^2 from t = 0.2, drifting right at 0.5 widths / s (the #245 case).
    const fall = (t: number) => (t < 0.2 ? { t, x: 0.3, y: 0.2 } : { t, x: 0.3 + 0.5 * (t - 0.2), y: 0.2 + 3 * (t - 0.2) ** 2 });
    const samples = Array.from({ length: 13 }, (_, i) => fall(i / 30));
    const land = landingAt(samples, 0.45, 0.005);
    expect(land.y).toBeCloseTo(fall(0.45).y, 3);
    expect(land.x).toBeCloseTo(fall(0.45).x, 3);
    // And the path reads the same curve by depth.
    expect(land.path.xAt(fall(0.4).y)).toBeCloseTo(fall(0.4).x, 3);
  });
});

describe('a pad along the path (#261)', () => {
  const pad = (over: Partial<Pads['p1']>) => ({ ...DEFAULT_PADS_SET.p1, on: true, shape: 'circle' as const, w: 0.2, h: 0.2, ...over });
  const pads: Pads = { ...DEFAULT_PADS_SET, p1: pad({ x: 0.5, y: 0.3, sound: 'crash' }), p2: pad({ x: 0.5, y: 0.7, sound: 'snare' }) };
  /** A vertical path at x = 0.5 from depth `from` down to `to`. */
  const straight = (from: number, to: number): FallPath => ({ yFrom: from, yTo: to, xAt: () => 0.5 });

  it('a landing on no pad is read to the first pad the path enters, at that pad\'s depth', () => {
    // The fit says the stroke goes on to 0.5 (a floor learned on the snare); the path
    // from the latest sample at 0.15 enters the crash on its way.
    const hit = hitPad(pads, { x: 0.5, y: 0.5 }, 'hand', straight(0.15, 0.5));
    expect(hit?.id).toBe('p1');
    expect(hit?.at).toEqual({ x: 0.5, y: 0.3 });
    expect(hit?.radial).toBeCloseTo(0, 9);
    // Without the path, the same point is on no pad.
    expect(hitPad(pads, { x: 0.5, y: 0.5 }, 'hand')).toBeNull();
  });

  it('a landing on a pad keeps that pad, read across the stroke at the pad\'s depth', () => {
    const arc: FallPath = { yFrom: 0.6, yTo: 0.78, xAt: (y) => 0.5 + 0.5 * (0.7 - y) };
    const hit = hitPad(pads, { x: 0.46, y: 0.78 }, 'hand', arc);
    expect(hit?.id).toBe('p2');
    expect(hit?.at).toEqual({ x: 0.5, y: 0.7 });
    // A path that misses every pad changes nothing: offPad still decides.
    expect(hitPad(pads, { x: 0.9, y: 0.9 }, 'hand', { yFrom: 0.8, yTo: 0.9, xAt: () => 0.9 })).toBeNull();
    expect(hitPad(pads, { x: 0.9, y: 0.9 }, 'nearest', { yFrom: 0.8, yTo: 0.9, xAt: () => 0.9 })?.id).toBe('p2');
  });
});

describe('a carried stick is not a stroke (#261)', () => {
  it('has no swing; a wrist stroke is all swing; a point with no grip says nothing', () => {
    const carried: TrackSample[] = [0, 1, 2, 3].map((i) => ({ t: i / 30, x: 0.5, y: 0.3 + 0.05 * i, grip: { x: 0.8, y: 0.1 + 0.05 * i } }));
    expect(swingShare(carried)).toBeCloseTo(0, 9);
    expect(isCarried(carried)).toBe(true);
    const { samples } = arcFall({ lift: 0.7, fall: 0.09, fps: 30 });
    expect(swingShare(fallingSegment(samples, samples[samples.length - 1].t, 0.005))).toBeCloseTo(1, 9);
    expect(isCarried(samples)).toBe(false);
    const wrist: TrackSample[] = carried.map(({ t, x, y }) => ({ t, x, y }));
    expect(swingShare(wrist)).toBeNaN();
    expect(isCarried(wrist)).toBe(false);
  });
});
