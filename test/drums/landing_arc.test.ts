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
import { DEFAULT_PADS_SET, hitPad, type FallPath, type PadId, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { replayNode } from '@thoremin/dag';
import { airDrumNode } from '@thoremin/ext-air/nodes/air_drum';
import { TRUE_STICK_LENGTH, gripFrames, parseStickClip } from '../../scripts/air/lib_synthetic_grip';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES } from '../helpers/fixtures';
import { DRUM_TAKE_FPS, DRUM_TAKE_HEIGHT, DRUM_TAKE_WIDTH, drumTake, scoreTake, starterKitPads, type DrumStroke, type DrumTakeOptions } from '../air/synthetic_drums';
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
      // The hit's x is where the tip really went (the arc); its depth is the fit's, within
      // the pad (the real landing point is kept, so where-in-the-pad still has a depth).
      expect(Math.abs(hit!.x! - (1 - tip.x / DRUM_TAKE_WIDTH)), `${stroke.pad} ${stroke.where} ${stroke.force}`).toBeLessThan(0.01);
      expect(Math.abs(hit!.y! - tip.y / DRUM_TAKE_HEIGHT), `${stroke.pad} ${stroke.where} ${stroke.force} depth`).toBeLessThan(0.08);
    }
    // Every rim stroke reads further out than every centre stroke.
    const radial = (where: 'centre' | 'rim') => score.perStroke.filter((p) => p.stroke.where === where).map((p) => p.hit!.radial!);
    expect(Math.max(...radial('centre'))).toBeLessThan(Math.min(...radial('rim')));
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

  it('overlapping pads: the pad under the landing point wins, the later slot on top (kick over snare, floor tom over tom)', async () => {
    // p6 (kick) overlaps p1 (snare) and p7 (floor tom) overlaps p3 (tom): a stroke into
    // the later slot must not be read as the earlier one just because its path crossed
    // that one's top edge first. Each pad is struck four times. Since #353 each pad has
    // its own floor, so a change of pad is predicted against the new pad's depth at once;
    // the one stroke left off its pad is the first ever on the kick, read against the
    // snare learned above it (before #353: four off; why #530 leaves it, `pad_floors.ts`).
    const pads = kitWithLowPads();
    const order = ['p1', 'p6', 'p1', 'p7', 'p3', 'p6', 'p7', 'p5'] as PadId[];
    const script: DrumStroke[] = order.flatMap((pad) => [hard(pad), hard(pad), hard(pad), hard(pad)]);
    const { score } = await playTake(pads, { script });
    expect(offPadAfterFirst(score)).toEqual([]);
    expect(score.off).toBeLessThanOrEqual(1);
    expect(score.false).toBe(0);
    expect(score.missed).toBe(0);
  });
});

/** The starter kit with the kick (p6, stacked under the snare) and the floor tom (p7,
 *  overlapping the tom) switched on. */
function kitWithLowPads(): Pads {
  const pads = starterKitPads();
  for (const id of ['p6', 'p7'] as PadId[]) pads[id] = { ...pads[id], on: true };
  return pads;
}
const hard = (pad: PadId): DrumStroke => ({ pad, where: 'centre', force: 'hard' });
/** The strokes off their pad, other than the first stroke on a pad never struck before
 *  (no floor describes it yet), as `index:pad->hit`. */
function offPadAfterFirst(score: ReturnType<typeof scoreTake>): string[] {
  const struck = new Set<PadId>();
  const off: string[] = [];
  score.perStroke.forEach(({ stroke, hit }, k) => {
    if (hit?.pad !== stroke.pad && struck.has(stroke.pad)) off.push(`${k}:${stroke.pad}->${hit?.pad ?? 'none'}`);
    struck.add(stroke.pad);
  });
  return off;
}

describe.runIf(AIR)('a change of pad is read against the new pad\'s floor (#353)', () => {
  // Sixteen strokes each, through the production graph. Before #353 (one floor per hand,
  // following the last pad at half a stroke per stroke): the kick/snare alternation put 7
  // of 16 off their pad (every snare after a kick read as the kick), 8 with landmark noise
  // and 8 with soft and hard strokes mixed; tom/floor tom 8. Now the only stroke off its
  // pad is the first on the kick. Since #533 the start is read by the hand as well as the
  // top, so a snare swung lower than the kick is still the snare's (main: 7 of 16 off),
  // and soft snare strokes against hard kicks are heard (main: 7 of 16 silent).
  const alternate = (a: PadId, b: PadId, force: (k: number) => DrumStroke['force'] = () => 'hard', lift: (k: number) => number | undefined = () => undefined): DrumStroke[] =>
    Array.from({ length: 16 }, (_, k) => ({ pad: k % 2 ? b : a, where: 'centre', force: force(k), ...(lift(k) !== undefined ? { lift: lift(k) } : {}) }));
  /** The kick moved down so that it no longer overlaps the snare (0.82 to 0.94; the snare
   *  ends at 0.84 only at its centre's x): a prediction at the kick's floor is read on the
   *  kick, not on the snare its path crosses first (the #353 review). */
  const kickBelow = (pads: Pads): Pads => ({ ...pads, p6: { ...pads.p6, y: 0.88 } });
  const cases: [string, DrumStroke[], DrumTakeOptions, ((p: Pads) => Pads)?][] = [
    ['kick and snare (stacked) alternating', alternate('p1', 'p6'), {}],
    ['kick and snare alternating, the kick below the snare', alternate('p1', 'p6'), {}, kickBelow],
    ['kick and snare alternating under landmark noise', alternate('p1', 'p6'), { noise: 0.02, seed: 3 }],
    ['kick and snare, soft and hard strokes mixed', alternate('p1', 'p6', (k) => (k % 4 < 2 ? 'soft' : 'hard')), {}],
    ['tom and floor tom (overlapping) alternating', alternate('p3', 'p7'), {}],
    // #533: the snare raised lower than the kick, so its strokes start where the kick's
    // do (by the top, 7 of 16 off; by the hand, none); and soft snare strokes against
    // hard kicks, which main named the kick's floor and so never sounded (7 missed).
    ['the snare raised 0.45 rad, the kick 0.7 (#533)', alternate('p1', 'p6', () => 'hard', (k) => (k % 2 ? 0.7 : 0.45)), {}],
    ['soft snare strokes raised 0.5 rad against hard kicks (#533)', alternate('p1', 'p6', (k) => (k % 2 ? 'hard' : 'soft'), (k) => (k % 2 ? undefined : 0.5)), {}],
  ];
  for (const [name, script, options, layout = (p: Pads) => p] of cases) {
    it(name, async () => {
      const { score } = await playTake(layout(kitWithLowPads()), { ...options, script });
      expect(offPadAfterFirst(score)).toEqual([]);
      expect(score.off).toBeLessThanOrEqual(1);
      expect({ missed: score.missed, false: score.false }).toEqual({ missed: 0, false: 0 });
      // Predicted ahead of the frame that shows the impact, not sounded late on confirmation.
      expect(score.perStroke.filter((p) => p.hit?.predicted).length).toBeGreaterThanOrEqual(14);
    });
  }
});

describe.runIf(AIR)('the pad a stroke heads for, against the #530 reviews\' takes', () => {
  // A never-struck pad must not take the played pad's strokes, and a lower pad reached by
  // tilting the stick (the hand where it was) is still told apart under landmark noise.
  // Main: 16 and 15; versions of #530/#533 that let a never-struck stacked pad compete,
  // or read the hand alone: 13 and 11.
  it('the snare struck with the hand raised 0 to 0.09 in turn, the kick on and never struck', async () => {
    const script: DrumStroke[] = Array.from({ length: 16 }, (_, k) => ({ ...hard('p1'), hand: -[0, 0.03, 0.06, 0.09][k % 4] }));
    const { score } = await playTake(kitWithLowPads(), { script });
    expect({ on: score.on, missed: score.missed, false: score.false }).toEqual({ on: 16, missed: 0, false: 0 });
  });
  it('the kick reached by a 0.23 rad tilt, alternating with the snare, landmark noise 0.03', async () => {
    const script: DrumStroke[] = Array.from({ length: 16 }, (_, k) => (k % 2 ? { ...hard('p6'), tilt: 0.232 } : hard('p1')));
    const { score } = await playTake(kitWithLowPads(), { script, noise: 0.03, seed: 7 });
    expect(score.on).toBeGreaterThanOrEqual(15);
    expect({ missed: score.missed, false: score.false }).toEqual({ missed: 0, false: 0 });
  });
});

describe.runIf(AIR)('a full swing with the arm on top of it is a stroke (#261 review)', () => {
  it('hears every stroke of the synthetic grip when the arm carries up to three times the swing', async () => {
    const dir = join(FIXTURES, 'subframe_stick_air_30');
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as { spec: { fps: number }; events: unknown[] };
    const poses = parseStickClip(readFileSync(join(dir, 'keypoints.ndjson'), 'utf8'));
    for (const arm of [1, 2, 3]) {
      const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, point: 'stickTip', minLead: 0.03 }));
      const outs = await replayNode(h, { hands: gripFrames(poses, { arm }) }, { dt: 1 / truth.spec.fps });
      expect(outs.flatMap((o) => o.hits as unknown[]), `arm ${arm}`).toHaveLength(truth.events.length);
    }
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

  it('a landing on a pad keeps that pad and its real landing point, the later slot on top, whatever the path crossed first', () => {
    const arc: FallPath = { yFrom: 0.6, yTo: 0.78, xAt: (y) => 0.5 + 0.5 * (0.7 - y) };
    const hit = hitPad(pads, { x: 0.46, y: 0.78 }, 'hand', arc);
    expect(hit?.id).toBe('p2');
    expect(hit?.at).toEqual({ x: 0.46, y: 0.78 });
    // A small pad nested in a big one: the path enters the big one first, but a landing
    // point inside the small one (the later slot) is the small one's.
    const nested: Pads = { ...pads, p3: pad({ x: 0.5, y: 0.75, w: 0.06, h: 0.06, sound: 'kick' }) };
    expect(hitPad(nested, { x: 0.5, y: 0.75 }, 'hand', straight(0.55, 1))?.id).toBe('p3');
    expect(hitPad(nested, { x: 0.5, y: 0.65 }, 'hand', straight(0.55, 1))?.id).toBe('p2');
    // A path that misses every pad changes nothing: offPad still decides.
    expect(hitPad(pads, { x: 0.9, y: 0.9 }, 'hand', { yFrom: 0.8, yTo: 0.9, xAt: () => 0.9 })).toBeNull();
    expect(hitPad(pads, { x: 0.9, y: 0.9 }, 'nearest', { yFrom: 0.8, yTo: 0.9, xAt: () => 0.9 })?.id).toBe('p2');
  });

  it('a stroke that turned in the air above a pad does not reach it; a predicted one still runs on to the pad below (#355, #261)', () => {
    const snareOnly: Pads = { ...DEFAULT_PADS_SET, p2: pad({ x: 0.5, y: 0.7, sound: 'snare' }) };
    /** A straight fall at x = 0.5 from `top` at t = 0, `dy` per 20 ms frame, for `n` frames. */
    const fall = (top: number, dy: number, n: number): TrackSample[] => Array.from({ length: n }, (_, i) => ({ t: 0.02 * i, x: 0.5, y: top + dy * i }));
    // A stroke that stopped at 0.36, in empty air above the snare (0.6 to 0.8): confirmed
    // there, its path ends where it stopped.
    const air = fall(0.3, 0.02, 4);
    const stopped = landingAt(air, air[air.length - 1].t, 0.005, { turned: true });
    expect(stopped.path.yTo).toBeCloseTo(air[air.length - 1].y, 9);
    expect(hitPad(snareOnly, stopped, 'silent', stopped.path)).toBeNull();
    // Committed 60 ms before it reaches a floor learned on a high pad (0.3), still above
    // it: the snare below is on its way.
    const big = fall(0.05, 0.04, 5);
    const toLow = landingAt(big, big[big.length - 1].t + 0.06, 0.005, { floor: 0.3 });
    expect(big[big.length - 1].y).toBeLessThan(0.3);
    expect(toLow.path.yTo).toBe(1);
    expect(hitPad(snareOnly, toLow, 'silent', toLow.path)?.id).toBe('p2');
  });
});

describe('a carried stick is not a stroke (#261)', () => {
  const gate = { amplitude: 0.3, minSwing: 0.15 };
  it('has no swing; a wrist stroke is all swing; a point with no grip says nothing', () => {
    const carried: TrackSample[] = [0, 1, 2, 3].map((i) => ({ t: i / 30, x: 0.5, y: 0.3 + 0.05 * i, grip: { x: 0.8, y: 0.1 + 0.05 * i } }));
    expect(swingShare(carried)).toBeCloseTo(0, 9);
    expect(isCarried(carried, gate)).toBe(true);
    const { samples } = arcFall({ lift: 0.7, fall: 0.09, fps: 30 });
    expect(swingShare(fallingSegment(samples, samples[samples.length - 1].t, 0.005))).toBeCloseTo(1, 9);
    expect(isCarried(samples, gate)).toBe(false);
    const wrist: TrackSample[] = carried.map(({ t, x, y }) => ({ t, x, y }));
    expect(swingShare(wrist)).toBeNaN();
    expect(isCarried(wrist, gate)).toBe(false);
  });

  it('is the swing against the stroke gate, not a share: a full swing plus a big arm is a stroke, a small swing plus a big arm a carry', () => {
    // The stick swings `swing` while the hand carries it `carry` further down.
    const fall = (swing: number, carry: number): TrackSample[] => [0, 1, 2, 3].map((i) => ({ t: i / 30, x: 0.5, y: 0.2 + ((swing + carry) * i) / 3, grip: { x: 0.8, y: 0.1 + (carry * i) / 3 } }));
    // A quarter of the descent is swing, but the swing is a full stroke.
    expect(isCarried(fall(0.3, 0.9), { amplitude: 1.2, minSwing: 0.15 })).toBe(false);
    // The same share, but the swing is under the smallest stroke.
    expect(isCarried(fall(0.05, 0.15), { amplitude: 0.2, minSwing: 0.15 })).toBe(true);
    // At a prediction the whole fall is deeper than what has been seen: the swing scales.
    expect(isCarried(fall(0.05, 0.05), { amplitude: 0.4, minSwing: 0.15 })).toBe(false);
  });
});
