/**
 * Expression from the body (#378, body-movement A6): dynamics and articulation.
 *
 * The acceptance: on scripted bigger-versus-smaller and sharp-versus-smooth strokes of the
 * body conductor, `velocityScale` and `articulation` move monotonically and stay in range,
 * and the orchestra's CC11 follows in a headless run of the composed instrument graph.
 * Also the split role (`conductor.expression`: a hand shapes while the body beats, and the
 * reverse), the per-player normaliser and the blend on their own, and the structural
 * guard that the body is composed when only the expression reads it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Engine, replayNode, type GraphSpec } from '@thoremin/dag';
import { createExpressionBlend, createRangeNormalizer } from '@thoremin/ictus';
import { createBodyExpressionMeter } from '@/nodes/features/conductor_body';
import { BLM, BODY_LANDMARK_COUNT, makeBodyKeypoints } from '@thoremin/sdk/nodes/domain';
import { conductorNode, DEFAULT_CONDUCTOR_DIAL, type BodyFrame, type Hand, type HandsFrame, type OrchestraEngineFactory, type OrchestraSynth } from '@/nodes';
import { CC } from '@/nodes/output/orchestra';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { useControls } from '@/app/store';
import { loadScore } from '@/score/load';
import { conduct, type Gesture } from './helpers/body_conduct';

const FPS = 30;
const BPM = 90;
const P = 60 / BPM;
const BODY = { enabled: true, source: 'body', hand: 'right', mirrorX: false, mirrorHandedness: false } as const;
const START: Gesture[] = [
  { kind: 'rest', s: 1.5 },
  { kind: 'ready', s: 1.2 },
  { kind: 'upbeat', s: P },
];
/** Consecutive pairs. */
const pairs = (xs: number[]): [number, number][] => xs.slice(1).map((x, i) => [xs[i], x]);
type Strokes = Extract<Gesture, { kind: 'beat' }>;
/** Eight strokes of one size and shape. Every channel is read against the player's last
 *  20 s, so a long enough phrase becomes the player's new normal: a segment is a phrase
 *  of eight. */
const strokes = (size: number, shape: 'sharp' | 'smooth' = 'sharp', beats = 8): Strokes => ({ kind: 'beat', bpm: BPM, beats, size, shape });
/** The scripted conductor with a jointed arm (its straightness follows the wrist's reach). */
const script = (gestures: Gesture[]) => conduct(gestures, { fps: FPS, arm: 'jointed' });

type Out = { velocityScale: number; dynamics: number; articulation: number; time: { state: string } };

/** The conductor over a scripted take; the mean of `key` over the second half of each
 *  gesture after the start (a reading settles within a few strokes). */
async function segments(gestures: Gesture[], params: Record<string, unknown> = {}, hands?: HandsFrame[]) {
  const sc = script([...START, ...gestures]);
  const h = conductorNode.make(conductorNode.params.parse({ ...BODY, ...params }));
  const outs = (await replayNode(h, { body: sc.frames, ...(hands ? { hands } : {}) }, { dt: 1 / FPS })) as Out[];
  const mean = (key: 'velocityScale' | 'dynamics' | 'articulation') =>
    sc.starts.slice(START.length).map((a, i, all) => {
      const b = all[i + 1] ?? sc.seconds;
      const sl = outs.slice(Math.round(((a + b) / 2) * FPS), Math.round(b * FPS));
      return sl.reduce((x, o) => x + o[key], 0) / sl.length;
    });
  return { sc, outs, mean };
}


describe('the per-player range (ictus createRangeNormalizer)', () => {
  it('reads 0.5 before its warm-up and for a player who never varies', () => {
    const n = createRangeNormalizer();
    expect(n.push(0, 3)).toBe(0.5);
    let last = 0;
    for (let t = 0; t < 10; t += 1 / 30) last = n.push(t, 3);
    expect(last).toBeCloseTo(0.5, 6);
  });

  it('places a value in the recent range, clamped to 0..1, and forgets after the window', () => {
    const n = createRangeNormalizer({ windowS: 20 });
    let t = 0;
    for (; t < 10; t += 1 / 30) n.push(t, 1 + Math.sin(2 * Math.PI * t));
    expect(n.normalize(1)).toBeCloseTo(0.5, 1);
    expect(n.normalize(1.8)).toBeGreaterThan(0.85);
    expect(n.normalize(100)).toBe(1);
    expect(n.normalize(-100)).toBe(0);
    // Thirty seconds at a new level: that level is now the middle.
    for (; t < 40; t += 1 / 30) n.push(t, 5);
    expect(n.normalize(5)).toBeCloseTo(0.5, 6);
  });
});

describe('the blend (ictus createExpressionBlend)', () => {
  it('a channel never seen drops out instead of reading as zero', () => {
    const b = createExpressionBlend();
    for (let t = 0; t < 5; t += 1 / 30) {
      b.push({ t, motion: 1 });
      if (Math.abs(t / 0.6 - Math.round(t / 0.6)) < 1e-6) b.pushStroke({ t, sharpness: NaN });
    }
    expect(b.read({ dynamics: 0.9, articulation: 0.3 })).toEqual({ dynamics: (0.5 * 0.9 + 0.25 * 0.5) / 0.75, articulation: 0.3 });
    expect(b.read(null).dynamics).toBeCloseTo(0.5, 6);
  });

  it('flow reads the jerk against its own range; sharpness the strokes against theirs', () => {
    const b = createExpressionBlend({ articulation: 'flow' });
    for (let i = 0; i < 20; i++) {
      for (let t = i * 0.6; t < (i + 1) * 0.6; t += 1 / 30) b.push({ t, jerk: i % 2 ? 15 : 5 });
      b.pushStroke({ t: (i + 1) * 0.6, sharpness: NaN });
    }
    for (let t = 12; t < 12.6; t += 1 / 30) b.push({ t, jerk: 40 });
    b.pushStroke({ t: 12.6, sharpness: NaN });
    expect(b.read(null).articulation).toBeGreaterThan(0.9);
    b.setArticulation('sharpness');
    for (let i = 0; i < 20; i++) b.pushStroke({ t: 13 + i * 0.6, sharpness: 4 });
    b.pushStroke({ t: 25.1, sharpness: NaN });
    expect(b.read(null).articulation).toBeCloseTo(0.5, 6);
    b.pushStroke({ t: 25.7, sharpness: 16 });
    expect(b.read(null).articulation).toBe(1);
  });
});

describe('the body expression meter (createBodyExpressionMeter)', () => {
  /** A still standing body whose right arm is placed: the shoulder, then the elbow and the
   *  wrist at the given offsets (torso lengths, image y down). */
  const armAt = (t: number, elbow: [number, number], wrist: [number, number]): BodyFrame => {
    const torso = 150;
    const { landmarks } = makeBodyKeypoints({ width: 640, height: 480, cx: 0.5, cy: 0.7, torso, leftArm: 0, rightArm: 0, kneeBend: 0, lean: 0 });
    const sh = landmarks[BLM.right_shoulder];
    landmarks[BLM.right_elbow] = { x: sh.x + elbow[0] * torso, y: sh.y + elbow[1] * torso };
    landmarks[BLM.right_wrist] = { x: sh.x + wrist[0] * torso, y: sh.y + wrist[1] * torso };
    return { t, width: 640, height: 480, present: true, landmarks, visibility: new Array(BODY_LANDMARK_COUNT).fill(0.99) };
  };

  it('extension: a straight arm reads 1, a folded one less, an unseen wrist nothing', () => {
    const m = createBodyExpressionMeter();
    expect(m.push(armAt(0, [-0.6, 0], [-1.2, 0]), 0, 'right').extension).toBeCloseTo(1, 6);
    expect(m.push(armAt(0.1, [-0.6, 0], [-0.6, 0.6]), 0.1, 'right').extension).toBeCloseTo(Math.SQRT2 / 2, 6);
    const hidden = armAt(0.2, [-0.6, 0], [-0.6, 0.6]);
    hidden.visibility[BLM.right_wrist] = 0.1;
    expect(m.push(hidden, 0.2, 'right').extension).toBeUndefined();
  });

  it('jerk: none for a wrist moving steadily, however irregular the frames', () => {
    const m = createBodyExpressionMeter();
    const times = [0, 1 / 30, 3 / 30, 4 / 30, 5 / 30, 8 / 30, 9 / 30];
    const jerks = times.map((t) => m.push(armAt(t, [-0.6, 0], [-0.6 - 0.5 * t, 0.3 + 2 * t]), t, 'right').jerk);
    for (const j of jerks.slice(3)) expect(j).toBeCloseTo(0, 6);
    // A jolt reads as one.
    const k = createBodyExpressionMeter();
    const jolt = [0, 1, 2, 3].map((i) => k.push(armAt(i / 30, [-0.6, 0], [-0.6, i === 3 ? 0.5 : 0.3]), i / 30, 'right').jerk);
    expect(jolt[3]).toBeGreaterThan(100);
  });
});

describe('the body conductor: dynamics (#378 acceptance)', () => {
  it('bigger strokes play louder, smaller softer, in both orders, velocityScale always in range', async () => {
    // Every channel is read against the player's own range over the last 20 s, so the take
    // first shows that range (a few soft strokes, a few loud ones), as any playing does;
    // then a staircase of phrases inside the same 20 s.
    const range: Gesture[] = [strokes(0.5, 'sharp', 4), strokes(1.5, 'sharp', 4)];
    const up = await segments([...range, strokes(0.5, 'sharp', 6), strokes(1, 'sharp', 6), strokes(1.5, 'sharp', 6)]);
    const down = await segments([...range, strokes(1.5, 'sharp', 6), strokes(1, 'sharp', 6), strokes(0.5, 'sharp', 6)]);
    const stair = (r: typeof up) => r.mean('velocityScale').slice(range.length);
    for (const [a, b] of pairs(stair(up))) expect(b - a).toBeGreaterThan(0.03);
    for (const [a, b] of pairs(stair(down))) expect(b - a).toBeLessThan(-0.03);
    const { dynMin, dynMax } = DEFAULT_CONDUCTOR_DIAL;
    for (const o of [...up.outs, ...down.outs]) {
      expect(o.velocityScale).toBeGreaterThanOrEqual(0);
      expect(o.velocityScale).toBeLessThanOrEqual(dynMax);
      if (o.time.state === 'running') expect(o.velocityScale).toBeGreaterThanOrEqual(dynMin);
      expect(o.articulation).toBeGreaterThanOrEqual(0);
      expect(o.articulation).toBeLessThanOrEqual(1);
    }
    // The size does not leak into articulation: no phrase moves it past a quarter.
    for (const a of up.mean('articulation').slice(range.length)) expect(Math.abs(a - 0.5)).toBeLessThan(0.25);
  });

  it('a held fermata keeps its loudness: the body still in a hold is not a diminuendo', async () => {
    const { sc, outs } = await segments([strokes(1), { kind: 'hold', s: 4 }]);
    const holdAt = sc.starts[START.length + 1];
    // From just after the last stroke (a stroke ending in a stop is confirmed late, #377) to
    // the end, through the hold's detection and the hold itself, the dynamics do not move.
    const after = outs.slice(Math.round((holdAt + 0.6) * FPS)).map((o) => o.dynamics);
    expect(outs.slice(-30).some((o) => o.time.state === 'hold')).toBe(true);
    expect(Math.max(...after) - Math.min(...after)).toBeLessThan(1e-9);
  });
});

describe('the body conductor: articulation (#378 acceptance)', () => {
  for (const articulationFrom of ['sharpness', 'flow'] as const) {
    it(`${articulationFrom}: sharp strokes read more staccato than smooth ones, in both orders`, async () => {
      const a = await segments([strokes(1, 'smooth'), strokes(1, 'sharp'), strokes(1, 'smooth')], { articulationFrom });
      const b = await segments([strokes(1, 'sharp'), strokes(1, 'smooth'), strokes(1, 'sharp')], { articulationFrom });
      const [s1, h1, s2] = a.mean('articulation');
      const [h2, s3, h3] = b.mean('articulation');
      // Margins the strokes' own estimate (dynamics.ts, re-centred within five strokes) misses.
      expect(h1 - Math.max(s1, s2)).toBeGreaterThan(0.15);
      expect(Math.min(h2, h3) - s3).toBeGreaterThan(0.15);
      for (const o of [...a.outs, ...b.outs]) expect(o.articulation >= 0 && o.articulation <= 1).toBe(true);
      // The shape barely moves the dynamics (the same excursion; a sharp turn moves a little
      // more in total).
      const [d1, d2, d3] = a.mean('dynamics');
      expect(Math.abs(d2 - (d1 + d3) / 2)).toBeLessThan(0.2);
    });
  }

  it('flow: dropped frames are not staccato (the jerk at the frames own times)', async () => {
    const sc = script([...START, strokes(1, 'smooth'), strokes(1, 'sharp'), strokes(1, 'smooth')]);
    // Every sixth frame lost (a loaded tracker): the replay repeats the last one, as a live
    // camera's pump does.
    const body = sc.frames.map((f, i) => (i % 6 === 5 ? sc.frames[i - 1] : f));
    const h = conductorNode.make(conductorNode.params.parse({ ...BODY, articulationFrom: 'flow' }));
    const outs = (await replayNode(h, { body }, { dt: 1 / FPS })) as Out[];
    const [, h1, s2] = sc.starts.slice(START.length).map((a, i, all) => {
      const b = all[i + 1] ?? sc.seconds;
      const sl = outs.slice(Math.round(((a + b) / 2) * FPS), Math.round(b * FPS));
      return sl.reduce((x, o) => x + o.articulation, 0) / sl.length;
    });
    // The first phrase is the per-player range's warm-up; after it, the smooth phrase reads
    // legato and well below the sharp one.
    expect(s2).toBeLessThan(0.5);
    expect(h1 - s2).toBeGreaterThan(0.3);
  });
});

/** A right hand whose wrist strokes at `bpm` with `amp` pixels, a sharp bottom, one per
 *  body frame (the hands and the pose share the camera). */
function strokingHand(times: number[], amp: (t: number) => number, bpm = BPM, handedness: Hand['handedness'] = 'Right', x = 900): HandsFrame[] {
  return times.map((t) => {
    const y = 500 - amp(t) * Math.abs(Math.sin((Math.PI * t * bpm) / 60));
    const keypoints = Array.from({ length: 21 }, () => ({ x, y }));
    const hand: Hand = { handedness, keypoints, score: 1 } as Hand;
    return { t, width: 1280, height: 720, hands: [hand] };
  });
}

describe('the split role: conductor.expression', () => {
  it('hands: the body beats (a bounce) and a hand shapes the dynamics', async () => {
    // The body bounces at a steady size for the whole take; the hand's strokes shrink (the
    // hand's dynamics are `dynamics.ts`'s, unchanged: a stroke against the recent envelope,
    // so a smaller stroke after bigger ones reads softer).
    const bounce: Gesture[] = [{ kind: 'bounce', bpm: BPM, beats: 12 }, { kind: 'bounce', bpm: BPM, beats: 12 }];
    const sc = script(bounce);
    const t1 = 12 * P;
    const hands = strokingHand(
      sc.frames.map((f) => f.t ?? 0),
      (t) => (t < t1 ? 80 : 20),
    );
    const run = async (expression: string) => {
      const h = conductorNode.make(conductorNode.params.parse({ ...BODY, bodyPoint: 'com', expression }));
      const outs = (await replayNode(h, { body: sc.frames, hands }, { dt: 1 / FPS })) as Out[];
      const at = (a: number, b: number) => outs.slice(Math.round(a * FPS), Math.round(b * FPS)).reduce((x, o) => x + o.dynamics, 0) / Math.round((b - a) * FPS);
      return { outs, big: at(t1 - 3, t1), small: at(t1 + 1, t1 + 4) };
    };
    const shaped = await run('hands');
    expect(shaped.outs.some((o) => o.time.state === 'running')).toBe(true);
    expect(shaped.big - shaped.small).toBeGreaterThan(0.2);
    // The same take shaped by the body (the bounce never changes) does not follow the hand.
    const same = await run('same');
    expect(Math.abs(same.big - same.small)).toBeLessThan(shaped.big - shaped.small);
  });

  it('hands, while an arm beats on a named side: the OTHER hand shapes', async () => {
    const sc = script([...START, strokes(1, 'sharp', 12), strokes(1, 'sharp', 12)]);
    const times = sc.frames.map((f) => f.t ?? 0);
    const t1 = sc.starts[START.length + 1];
    // The right hand (the beating arm's) strokes steadily; the left one shrinks at t1.
    const right = strokingHand(times, () => 60, BPM, 'Right', 900);
    const left = strokingHand(times, (t) => (t < t1 ? 80 : 20), BPM, 'Left', 300);
    const hands = right.map((f, i) => ({ ...f, hands: [...f.hands, ...left[i].hands] }));
    const h = conductorNode.make(conductorNode.params.parse({ ...BODY, expression: 'hands' }));
    const outs = (await replayNode(h, { body: sc.frames, hands }, { dt: 1 / FPS })) as Out[];
    const at = (a: number, b: number) => outs.slice(Math.round(a * FPS), Math.round(b * FPS)).reduce((x, o) => x + o.dynamics, 0) / Math.round((b - a) * FPS);
    expect(at(t1 - 3, t1) - at(t1 + 1, t1 + 4)).toBeGreaterThan(0.2);
  });

  it('body: a hand beats and the body shapes the dynamics', async () => {
    const sc = script([...START, strokes(0.5), strokes(1.5)]);
    const times = sc.frames.map((f) => f.t ?? 0);
    const hands = strokingHand(times, () => 60);
    const h = conductorNode.make(conductorNode.params.parse({ ...BODY, source: 'hands', expression: 'body' }));
    const outs = (await replayNode(h, { body: sc.frames, hands }, { dt: 1 / FPS })) as Out[];
    const [, , , s1, s2] = sc.starts;
    const mean = (a: number, b: number) => outs.slice(Math.round(a * FPS), Math.round(b * FPS)).reduce((x, o) => x + o.dynamics, 0) / Math.round((b - a) * FPS);
    expect(mean((s2 + sc.seconds) / 2, sc.seconds) - mean((s1 + s2) / 2, s2)).toBeGreaterThan(0.2);
  });
});

describe('the body is composed when only the expression reads it', () => {
  const registry = createAppRegistry();
  const bodyEdge = (spec: GraphSpec) => spec.edges.some((e) => e.from.node === 'camBody' && e.from.port === 'body' && e.to.node === 'conductor' && e.to.port === 'body');
  it('a hand beats, the body shapes: the pose camera runs and reaches the conductor', () => {
    const ids = branchIdsFor({ conductor: { enabled: true, source: 'hands', expression: 'body' } });
    expect(ids).toContain('body-source');
    expect(bodyEdge(composeInstrumentGraph(ids, {}, registry).spec)).toBe(true);
  });
  it('the hand conductor shaping with the hand does not start the pose camera', () => {
    expect(branchIdsFor({ conductor: { enabled: true, source: 'hands', expression: 'hands' } })).not.toContain('body-source');
  });
});

describe("the orchestra's CC11 follows the body (headless, the composed graph)", () => {
  it('bigger strokes raise the expression controller, smaller lower it', async () => {
    const sc = script([...START, strokes(0.5), strokes(1.5), strokes(0.5)]);
    const calls: { cc: number; value: number; time: number }[] = [];
    const synth: OrchestraSynth = {
      noteOn() {},
      noteOff() {},
      controllerChange(_channel, cc, value, time) {
        calls.push({ cc, value, time });
      },
      programChange() {},
      allNotesOff() {},
      close() {},
    };
    const factory: OrchestraEngineFactory = async () => ({ resource: synth });
    // The context the orchestra reads its clock from; every other audio call (the field
    // synth's bus) lands on a stub that accepts anything.
    const sink: unknown = new Proxy(function () {}, { get: (_o, k) => (k === 'then' ? undefined : k === 'value' ? 0 : sink), apply: () => sink, construct: () => sink as object });
    const clock = { currentTime: 100, state: 'running', sampleRate: 48000 };
    const ac = new Proxy(clock, { get: (o, k) => (k in o ? o[k as keyof typeof o] : sink) });
    const doc = await loadScore(new Uint8Array(readFileSync('public/scores/beethoven-symphony-5-1.mid')), 'beethoven-symphony-5-1.mid');
    const conductor = { ...useControls.getState().conductor, ...DEFAULT_CONDUCTOR_DIAL, ...BODY, orchestra: { ...useControls.getState().conductor.orchestra, enabled: true } };
    const controls = { ...useControls.getState(), conductor, scoreDoc: doc };
    const ids = branchIdsFor({ handMap: { maxGain: 0 }, conductor });
    expect(ids).toContain('body-source');
    const { spec } = composeInstrumentGraph(ids, { body: 'replay-body', source: 'synthetic-hands' }, createAppRegistry());
    const graph: GraphSpec = { ...spec, nodes: spec.nodes.map((n) => (n.id === 'camBody' ? { ...n, params: { frames: sc.frames as BodyFrame[] } } : n)) };
    const engine = new Engine(graph, createAppRegistry(), {
      nominalDt: 1 / FPS,
      resources: { controls: () => controls, createOrchestraEngine: factory, audioContext: ac, masterGain: {} },
    });
    await engine.init();
    for (let i = 0; i < sc.frames.length; i++) {
      clock.currentTime = 100 + i / FPS;
      engine.tick();
      // The orchestra's engine loads asynchronously: let it settle on the first ticks.
      if (i < 3) await new Promise((r) => setTimeout(r, 0));
    }
    const expr = calls.filter((c) => c.cc === CC.expression);
    expect(expr.length).toBeGreaterThan(10);
    const [, , , s1, s2, s3] = sc.starts;
    // The controller is diffed (sent only when it changes): read the value in force.
    const inForce = (t: number) => {
      let v = NaN;
      for (const c of expr) if (c.time - 100 <= t) v = c.value;
      return v;
    };
    const mean = (a: number, b: number) => {
      const ts = Array.from({ length: Math.round((b - a) * FPS) }, (_, i) => a + i / FPS);
      return ts.reduce((x, t) => x + inForce(t), 0) / ts.length;
    };
    const soft = mean((s1 + s2) / 2, s2);
    const loud = mean((s2 + s3) / 2, s3);
    const softAgain = mean((s3 + sc.seconds) / 2, sc.seconds);
    expect(loud).toBeGreaterThan(soft + 10);
    expect(softAgain).toBeLessThan(loud - 10);
    for (const c of expr) expect(c.value >= 0 && c.value <= 127).toBe(true);
  });
});
