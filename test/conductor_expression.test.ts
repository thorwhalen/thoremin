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
/** Twelve strokes of one size and shape. */
const strokes = (size: number, shape: 'sharp' | 'smooth' = 'sharp'): Gesture => ({ kind: 'beat', bpm: BPM, beats: 12, size, shape });

type Out = { velocityScale: number; dynamics: number; articulation: number; time: { state: string } };

/** The conductor over a scripted take; the mean of `key` over the second half of each
 *  gesture after the start (a reading settles within a few strokes). */
async function segments(gestures: Gesture[], params: Record<string, unknown> = {}, hands?: HandsFrame[]) {
  const sc = conduct([...START, ...gestures], { fps: FPS });
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

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
const decreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x < xs[i - 1]);

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
    for (let t = 0; t < 5; t += 1 / 30) b.push({ t, motion: 1 });
    expect(b.read({ dynamics: 0.9, articulation: 0.3 })).toEqual({ dynamics: (0.5 * 0.9 + 0.25 * 0.5) / 0.75, articulation: 0.3 });
    expect(b.read(null).dynamics).toBeCloseTo(0.5, 6);
  });

  it('flow reads the jerk against its own range; sharpness the strokes against theirs', () => {
    const b = createExpressionBlend({ articulation: 'flow' });
    for (let t = 0; t < 10; t += 1 / 30) b.push({ t, jerk: 10 + 5 * Math.sin(3 * t) });
    for (let t = 10; t < 12; t += 1 / 30) b.push({ t, jerk: 40 });
    expect(b.read(null).articulation).toBeGreaterThan(0.9);
    b.setArticulation('sharpness');
    for (let i = 0; i < 20; i++) b.pushStroke({ t: i * 0.6, sharpness: 4 });
    b.pushStroke({ t: 12, sharpness: NaN });
    expect(b.read(null).articulation).toBeCloseTo(0.5, 6);
    b.pushStroke({ t: 12.6, sharpness: 16 });
    expect(b.read(null).articulation).toBe(1);
  });
});

describe('the body conductor: dynamics (#378 acceptance)', () => {
  it('bigger strokes play louder, smaller softer, in both orders, velocityScale always in range', async () => {
    const up = await segments([strokes(0.5), strokes(1), strokes(1.5)]);
    const down = await segments([strokes(1.5), strokes(1), strokes(0.5)]);
    expect(increasing(up.mean('velocityScale'))).toBe(true);
    expect(decreasing(down.mean('velocityScale'))).toBe(true);
    const { dynMin, dynMax } = DEFAULT_CONDUCTOR_DIAL;
    for (const o of [...up.outs, ...down.outs]) {
      expect(o.velocityScale).toBeGreaterThanOrEqual(0);
      expect(o.velocityScale).toBeLessThanOrEqual(dynMax);
      if (o.time.state === 'running') expect(o.velocityScale).toBeGreaterThanOrEqual(dynMin);
      expect(o.articulation).toBeGreaterThanOrEqual(0);
      expect(o.articulation).toBeLessThanOrEqual(1);
    }
    // The size does not leak into articulation: no segment moves it past a quarter.
    for (const a of up.mean('articulation')) expect(Math.abs(a - 0.5)).toBeLessThan(0.25);
  });

  it('more than the strokes: the reach and the motion lift the dynamics over the strokes alone', async () => {
    const blended = await segments([strokes(0.5), strokes(1.5)]);
    const strokesOnly = await segments([strokes(0.5), strokes(1.5)], { expression: 'hands' }, []);
    // With no hand in frame the hand's follower has nothing: its dynamics stay at the middle.
    expect(strokesOnly.mean('dynamics').every((d) => Math.abs(d - 0.5) < 1e-9)).toBe(true);
    const [soft, loud] = blended.mean('dynamics');
    expect(loud - soft).toBeGreaterThan(0.25);
  });
});

describe('the body conductor: articulation (#378 acceptance)', () => {
  for (const articulationFrom of ['sharpness', 'flow'] as const) {
    it(`${articulationFrom}: sharp strokes read more staccato than smooth ones, in both orders`, async () => {
      const a = await segments([strokes(1, 'smooth'), strokes(1, 'sharp'), strokes(1, 'smooth')], { articulationFrom });
      const b = await segments([strokes(1, 'sharp'), strokes(1, 'smooth'), strokes(1, 'sharp')], { articulationFrom });
      const [s1, h1, s2] = a.mean('articulation');
      const [h2, s3, h3] = b.mean('articulation');
      expect(h1).toBeGreaterThan(s1);
      expect(h1).toBeGreaterThan(s2);
      expect(s3).toBeLessThan(h2);
      expect(s3).toBeLessThan(h3);
      for (const o of [...a.outs, ...b.outs]) expect(o.articulation >= 0 && o.articulation <= 1).toBe(true);
      // The shape does not leak into the dynamics.
      const [d1, d2, d3] = a.mean('dynamics');
      expect(Math.abs(d2 - (d1 + d3) / 2)).toBeLessThan(0.1);
    });
  }
});

/** A right hand whose wrist strokes at `bpm` with `amp` pixels, a sharp bottom, one per
 *  body frame (the hands and the pose share the camera). */
function strokingHand(times: number[], amp: (t: number) => number, bpm = BPM): HandsFrame[] {
  return times.map((t) => {
    const y = 500 - amp(t) * Math.abs(Math.sin((Math.PI * t * bpm) / 60));
    const keypoints = Array.from({ length: 21 }, () => ({ x: 900, y }));
    const hand: Hand = { handedness: 'Right', keypoints, score: 1 } as Hand;
    return { t, width: 1280, height: 720, hands: [hand] };
  });
}

describe('the split role: conductor.expression', () => {
  it('hands: the body beats (a bounce) and a hand shapes the dynamics', async () => {
    // The body bounces at a steady size for the whole take; the hand's strokes shrink (the
    // hand's dynamics are `dynamics.ts`'s, unchanged: a stroke against the recent envelope,
    // so a smaller stroke after bigger ones reads softer).
    const bounce: Gesture[] = [{ kind: 'bounce', bpm: BPM, beats: 12 }, { kind: 'bounce', bpm: BPM, beats: 12 }];
    const sc = conduct(bounce, { fps: FPS });
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

  it('body: a hand beats and the body shapes the dynamics', async () => {
    const sc = conduct([...START, strokes(0.5), strokes(1.5)], { fps: FPS });
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
    const sc = conduct([...START, strokes(0.5), strokes(1.5), strokes(0.5)], { fps: FPS });
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
    const mean = (a: number, b: number) => {
      const sl = expr.filter((c) => c.time - 100 >= a && c.time - 100 < b);
      expect(sl.length).toBeGreaterThan(0);
      return sl.reduce((x, c) => x + c.value, 0) / sl.length;
    };
    const soft = mean((s1 + s2) / 2, s2);
    const loud = mean((s2 + s3) / 2, s3);
    const softAgain = mean((s3 + sc.seconds) / 2, sc.seconds);
    expect(loud).toBeGreaterThan(soft + 10);
    expect(softAgain).toBeLessThan(loud - 10);
    for (const c of expr) expect(c.value >= 0 && c.value <= 127).toBe(true);
  });
});
