/**
 * `body-pulse` (#186 PR F): the dancer's pulse from the body frame, through ictus's
 * octave-free pulse follower. The real dancer (`video_body_que_calor`, 129.2 bpm) is
 * the ground truth that shaped it: the stride repeats once per BAR, and the head and
 * hips once per six beats, so a follower that folds periods by octaves into a beat
 * range reports a level the music does not have. The pure follower is
 * `test/ictus_pulse.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { replayNode, runHeadless, type GraphSpec } from '@thoremin/dag';
import { PULSE_TRUSTED_CONFIDENCE, createPulseSelector, type PulseState } from '@thoremin/ictus';
import { bodyPulseNode, bodyFeatureVectorNode, createCoreRegistry, pulseChannelValue, createYawUnwrapper, AUTO_PULSE_CHANNELS, type BodyFrame } from '@/nodes';
import { defaultGraph, branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { defaultFeatureLab } from '@/features/labConfig';
import type { FeatureVector } from '@thoremin/sdk/features/catalog';
import { PULSE_GATE_CONFIDENCE } from '@thoremin/sdk/features/body_catalog';
import { loadStream } from './helpers/fixtures';
// The open Lab claims its shown groups as a feature demand (#600 S16a): what the derivation reads.
import { labDemandGroups } from '@/app/labDemand';

const BEAT = 60 / 129.2;
const BAR = 4 * BEAT;
const near = (p: number, ref: number, tol = 0.06) => Math.abs(p / ref - 1) < tol;

/** The circular resultant of event times against a grid of period `P` (1 = every event
 *  at the same place in the cycle; about 1/sqrt(n) by chance). */
const resultant = (ts: readonly number[], P: number) => {
  const c = ts.reduce((a, t) => a + Math.cos((2 * Math.PI * t) / P), 0) / ts.length;
  const s = ts.reduce((a, t) => a + Math.sin((2 * Math.PI * t) / P), 0) / ts.length;
  return Math.hypot(c, s);
};

/** The distinct anchors a run of states accepted. */
const anchorsOf = (states: readonly PulseState[]) => {
  const out: number[] = [];
  for (const s of states) if (s.lastAnchorAt !== undefined && out.at(-1) !== s.lastAnchorAt) out.push(s.lastAnchorAt);
  return out;
};

describe('the real dancer (video_body_que_calor, 129.2 bpm)', () => {
  const frames = loadStream('video_body_que_calor', 'camBody.body') as BodyFrame[];
  const replay = async (params: Record<string, unknown> = {}) => {
    const out = await replayNode(bodyPulseNode.make(bodyPulseNode.params.parse(params)), { body: frames }, { dt: 1 / 30 });
    return out.map((o) => o.pulse as PulseState);
  };

  it('the stride (the default) repeats once per BAR: the level, the period and the anchors sit on the bar', async () => {
    const states = await replay();
    // After the first six seconds (a window of three bars), every tick with confidence
    // 0.2 or more (no noise channel reaches it: test/ictus_pulse.test.ts). Measured with
    // the shipped defaults: nearly every late tick is that confident, all with the level
    // within 6 % of the bar and the prior's period there; the anchors' resultant
    // against the bar grid is about 0.9 (chance for n = 9 is 0.33).
    const late = states.slice(6 * 30);
    const confident = late.filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE);
    expect(confident.length / late.length).toBeGreaterThan(0.9);
    expect(confident.every((s) => near(s.level, BAR))).toBe(true);
    expect(confident.filter((s) => near(s.period, BAR)).length / confident.length).toBeGreaterThan(0.9);
    const anchors = anchorsOf(states);
    expect(anchors.length).toBeGreaterThanOrEqual(8);
    expect(resultant(anchors, BAR)).toBeGreaterThan(0.8);
    // A period, not a beat: the tempo is cycles per minute (32), not the song's 129.
    expect(states.at(-1)!.tempo).toBeGreaterThan(29);
    expect(states.at(-1)!.tempo).toBeLessThan(35);
  });

  it('the head and the hips are at the noise floor on this dancer: the follower mostly declines to report a pulse', async () => {
    for (const channel of ['head', 'hip']) {
      const late = (await replay({ channel })).slice(6 * 30);
      expect(late.filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE).length / late.length, channel).toBeLessThan(0.05);
    }
  });

  it('one missed detection does not cost the lock', async () => {
    const holed = frames.map((f, i) => (i === 300 ? { ...f, present: false, landmarks: [], visibility: [] } : f));
    const out = await replayNode(bodyPulseNode.make(bodyPulseNode.params.parse({})), { body: holed }, { dt: 1 / 30 });
    const after = out.slice(301).map((o) => o.pulse as PulseState);
    expect(after.filter((s) => s.confidence >= PULSE_TRUSTED_CONFIDENCE).length / after.length).toBeGreaterThan(0.95);
  });
});

describe('the node', () => {
  const W = 640;
  const H = 480;
  /** A frame with the ankles `step` torso lengths apart (signed), torso 100 px. */
  const frameAt = (step: number): BodyFrame => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 320, y: 240, z: 0 }));
    landmarks[11] = { x: 300, y: 100, z: 0 };
    landmarks[12] = { x: 340, y: 100, z: 0 };
    landmarks[23] = { x: 305, y: 200, z: 0 };
    landmarks[24] = { x: 335, y: 200, z: 0 };
    landmarks[0] = { x: 320, y: 60, z: 0 };
    landmarks[27] = { x: 320 + 50 * step, y: 350, z: 0 };
    landmarks[28] = { x: 320 - 50 * step, y: 350, z: 0 };
    return { width: W, height: H, present: true, landmarks, visibility: new Array(33).fill(1) };
  };
  const ctx = (t: number) => ({ time: t, dt: 1 / 30, tick: Math.round(t * 30), resources: {} }) as never;

  it('the channel is a position in torso lengths, NaN when a landmark it needs is not visible', () => {
    const f = frameAt(0.4);
    expect(pulseChannelValue(f, 'stride')).toBeCloseTo(0.4, 9);
    expect(pulseChannelValue(f, 'head')).toBeCloseTo(0.6, 9);
    expect(pulseChannelValue(f, 'hip')).toBeCloseTo(2, 9);
    const hidden = { ...f, visibility: f.visibility.map((v, i) => (i === 27 ? 0.1 : v)) };
    expect(pulseChannelValue(hidden, 'stride')).toBeNaN();
    expect(pulseChannelValue(hidden, 'head')).toBeCloseTo(0.6, 9);
  });

  it('a body absent for half a window starts the pulse over (no stale tempo when the dancer returns); a repeated frame is not a sample', () => {
    const h = bodyPulseNode.make(bodyPulseNode.params.parse({}));
    let last!: PulseState;
    for (let i = 0; i < 12 * 30; i++) last = (h.process({ body: frameAt(Math.sin((2 * Math.PI * i) / 30 / 1.2)) }, ctx(i / 30)) as { pulse: PulseState }).pulse;
    expect(near(last.period, 1.2, 0.02)).toBe(true);
    expect(last.confidence).toBeGreaterThan(0.3);
    const same = frameAt(0);
    const a = (h.process({ body: same }, ctx(12)) as { pulse: PulseState }).pulse;
    expect((h.process({ body: same }, ctx(12 + 1 / 30)) as { pulse: PulseState }).pulse).toBe(a);
    const absent = { width: W, height: H, present: false, landmarks: [], visibility: [] };
    // A missed frame keeps the lock...
    expect((h.process({ body: absent }, ctx(12.1)) as { pulse: PulseState }).pulse.confidence).toBeGreaterThan(0.3);
    // ...a gap of more than half the window (4 s) does not.
    let gone!: PulseState;
    for (let t = 12.2; t < 16.5; t += 1 / 30) gone = (h.process({ body: { ...absent } }, ctx(t)) as { pulse: PulseState }).pulse;
    expect(gone.confidence).toBe(0);
    const back = (h.process({ body: frameAt(0.3) }, ctx(16.6)) as { pulse: PulseState }).pulse;
    expect(back.level).toBeNaN();
  });

  it("the source's shared empty frame, repeated, still counts as a dropout (the pulse does not freeze trusted)", () => {
    const h = bodyPulseNode.make(bodyPulseNode.params.parse({}));
    for (let i = 0; i < 12 * 30; i++) h.process({ body: frameAt(Math.sin((2 * Math.PI * i) / 30 / 1.2)) }, ctx(i / 30));
    const empty = { width: W, height: H, present: false, landmarks: [], visibility: [] };
    let s!: PulseState;
    for (let t = 12; t < 17; t += 1 / 30) s = (h.process({ body: empty }, ctx(t)) as { pulse: PulseState }).pulse;
    expect(s.confidence).toBe(0);
    expect(s.t).toBeGreaterThan(16.9);
  });

  it('refuses a window too short for its longest period', () => {
    expect(() => bodyPulseNode.params.parse({ windowS: 4, maxPeriodS: 3 })).toThrow();
  });
});

describe('the synthetic body steps: the whole body path, with no camera', () => {
  it('synthetic-body → body-pulse → body-feature-vector: the stride period, and body.rhythm.* in the vector', async () => {
    const spec: GraphSpec = {
      nodes: [
        { id: 'b', type: 'synthetic-body', params: { stepPeriod: 1.2 } },
        { id: 'p', type: 'body-pulse', params: {} },
        { id: 'v', type: 'body-feature-vector', params: {} },
      ],
      edges: [
        { from: { node: 'b', port: 'body' }, to: { node: 'p', port: 'body' } },
        { from: { node: 'b', port: 'body' }, to: { node: 'v', port: 'body' } },
        { from: { node: 'p', port: 'pulse' }, to: { node: 'v', port: 'pulse' } },
      ],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 12 * 30, nominalDt: 1 / 30, recordOnly: ['p.pulse', 'v.vector'] });
    const pulses = recorder.values('p.pulse') as PulseState[];
    const last = pulses.at(-1)!;
    expect(near(last.period, 1.2, 0.02)).toBe(true);
    expect(last.confidence).toBeGreaterThan(0.3);
    const v = (recorder.values('v.vector') as FeatureVector[]).at(-1)!;
    expect(v['body.rhythm.period']).toBeCloseTo(last.period, 9);
    expect(v['body.rhythm.tempo']).toBeCloseTo(60 / last.period, 6);
    expect(v['body.rhythm.confidence']).toBeCloseTo(last.confidence, 9);
    expect(v['body.rhythm.phase']).toBeGreaterThanOrEqual(0);
    expect(v['body.rhythm.phase']).toBeLessThan(1);
    expect([0, 1]).toContain(v['body.rhythm.gate']);
    // Before anything is known the rhythm features are absent, not zero.
    expect((recorder.values('v.vector') as FeatureVector[])[0]['body.rhythm.period']).toBeUndefined();
    // The gate opens for about 15 % of the ticks once locked.
    const gates = (recorder.values('v.vector') as FeatureVector[]).slice(8 * 30).map((x) => x['body.rhythm.gate']);
    const open = gates.filter((g) => g === 1).length / gates.length;
    expect(open).toBeGreaterThan(0.08);
    expect(open).toBeLessThan(0.25);
  });

  it('bodyFeatureVectorNode without a pulse input drops body.rhythm (absent, not NaN)', async () => {
    const out = await replayNode(bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse({})), { body: loadStream('video_body_que_calor', 'camBody.body').slice(0, 5) as BodyFrame[] }, { dt: 1 / 30 });
    expect(Object.keys(out[4].vector as FeatureVector).some((k) => k.startsWith('body.rhythm.'))).toBe(false);
  });
});

describe('wiring: the pulse rides the body branch', () => {
  it('camBody → bodyPulse → bodyVec, in the full graph', () => {
    const { edges } = defaultGraph();
    const has = (a: string, ap: string, b: string, bp: string) => edges.some((e) => e.from.node === a && e.from.port === ap && e.to.node === b && e.to.port === bp);
    expect(has('camBody', 'body', 'bodyPulse', 'body')).toBe(true);
    expect(has('bodyPulse', 'pulse', 'bodyVec', 'pulse')).toBe(true);
    // The pulse is the bodyVec's only pulse source (the engine rejects fan-in anyway).
    expect(edges.filter((e) => e.to.node === 'bodyVec' && e.to.port === 'pulse')).toHaveLength(1);
  });

  it('a Lab claim on the Body pulse group composes the body branch, with the pulse in it', () => {
    const base = settingsFromLayer(SEED_INSTRUMENTS[0].layer);
    expect(branchIdsFor(base)).not.toContain('body-source');
    const ids = branchIdsFor(base, { demanded: new Set(labDemandGroups({ ...defaultFeatureLab(), show: true, groups: ['body.rhythm'] })) });
    expect(ids).toContain('body-source');
    const { spec } = composeInstrumentGraph(ids);
    expect(spec.nodes.some((n) => n.id === 'bodyPulse' && n.type === 'body-pulse')).toBe(true);
  });
});

describe('the body gate trusts the pulse where ictus does (#392)', () => {
  it('PULSE_GATE_CONFIDENCE (sdk, restated) equals PULSE_TRUSTED_CONFIDENCE (ictus)', () => {
    // The SDK does not depend on the inference package, so the threshold is stated twice.
    expect(PULSE_GATE_CONFIDENCE).toBe(PULSE_TRUSTED_CONFIDENCE);
  });
});

describe('channel: auto (#416)', () => {
  const trusted = (outs: Array<Record<string, unknown>>) => outs.filter((o) => (o.pulse as PulseState).confidence >= PULSE_TRUSTED_CONFIDENCE);
  const run = async (clip: string, mask?: (f: BodyFrame) => BodyFrame, params: Record<string, unknown> = { channel: 'auto' }) => {
    const raw = loadStream(clip, 'camBody.body') as BodyFrame[];
    const frames = mask ? raw.map(mask) : raw;
    const out = await replayNode(bodyPulseNode.make(bodyPulseNode.params.parse(params)), { body: frames }, { dt: 1 / 30 });
    return out.slice(6 * 30) as Array<Record<string, unknown>>;
  };
  /** The feet out of frame: the tracker's ankle visibility drops. */
  const noFeet = (f: BodyFrame): BodyFrame => ({ ...f, visibility: f.visibility.map((v, i) => (i >= 27 ? 0.05 : v)) });

  it('on the real dancer it follows the stride, as the stride channel alone does', async () => {
    // Measured (shipped defaults): stride trusted in 98 % of late ticks at strength 0.76;
    // the other three never overtake it by the margin for 3 s, so `auto` is the stride.
    const auto = await run('video_body_que_calor');
    const stride = await run('video_body_que_calor', undefined, { channel: 'stride' });
    expect(new Set(trusted(auto).map((o) => o.channel))).toEqual(new Set(['stride']));
    expect(trusted(auto).length).toBe(trusted(stride).length);
    const last = auto.at(-1)!.pulse as PulseState;
    expect(near(last.level, BAR)).toBe(true);
  });

  it('with the feet out of frame it never names a feet channel, and does not invent a pulse where there is none (Que Calor, then Budots)', async () => {
    // Measured: with the ankles hidden the trunk and the sway (over the feet) are
    // untrusted and the yaw is trusted in 14 % of Que Calor's late ticks; Budots'
    // ankles are mostly out of frame already and nothing is trusted in more than a few
    // percent of ticks (the trunk's ACF reaches 0.26 at its bar of 1.66 s: under the floor).
    for (const [clip, mask] of [['video_body_que_calor', noFeet], ['video_body_budots', undefined]] as const) {
      const out = await run(clip, mask);
      const names = new Set(trusted(out).map((o) => o.channel));
      expect(names.has('stride'), clip).toBe(false);
      expect(names.has('sway'), clip).toBe(false);
      expect(trusted(out).length / out.length, clip).toBeLessThan(0.2);
    }
  });

  it('switches to a channel that carries the pulse when the stride does not (a synthetic dancer who bounces in place)', () => {
    const base = (dy: number): BodyFrame => {
      const landmarks = Array.from({ length: 33 }, () => ({ x: 320, y: 240, z: 0 }));
      landmarks[11] = { x: 300, y: 100 + dy, z: 0 };
      landmarks[12] = { x: 340, y: 100 + dy, z: 0 };
      landmarks[23] = { x: 305, y: 200 + dy, z: 0 };
      landmarks[24] = { x: 335, y: 200 + dy, z: 0 };
      landmarks[27] = { x: 270, y: 350, z: 0 };
      landmarks[28] = { x: 370, y: 350, z: 0 };
      return { width: 640, height: 480, present: true, landmarks, visibility: new Array(33).fill(1) };
    };
    const h = bodyPulseNode.make(bodyPulseNode.params.parse({ channel: 'auto' }));
    let o!: { pulse: PulseState; channel: string };
    for (let i = 0; i < 14 * 30; i++) o = h.process({ body: base(8 * Math.sin((2 * Math.PI * i) / 30 / 0.9)) }, { time: i / 30, dt: 1 / 30, tick: i, resources: {} } as never) as typeof o;
    expect(o.channel).toBe('trunk');
    expect(near(o.pulse.level, 0.9, 0.04)).toBe(true);
    expect(o.pulse.confidence).toBeGreaterThan(PULSE_TRUSTED_CONFIDENCE);
  });

  it('the stride stays the default channel, and the auto set leaves out the head and the hips', () => {
    expect(bodyPulseNode.params.parse({}).channel).toBe('stride');
    expect([...AUTO_PULSE_CHANNELS]).toEqual(['stride', 'sway', 'yaw', 'trunk']);
  });

  it('the new channels: sway over the feet, trunk centroid height, shoulder yaw (unwrapped by the node)', () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 320, y: 240, z: 0 }));
    landmarks[11] = { x: 300, y: 100, z: 0 };
    landmarks[12] = { x: 340, y: 100, z: 0 };
    landmarks[23] = { x: 300, y: 200, z: 0 };
    landmarks[24] = { x: 340, y: 200, z: 0 };
    landmarks[27] = { x: 290, y: 350, z: 0 };
    landmarks[28] = { x: 310, y: 350, z: 0 };
    const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
    world[11] = { x: -0.2, y: 0, z: 0 };
    world[12] = { x: 0.2, y: 0, z: 0.2 };
    const f: BodyFrame = { width: 640, height: 480, present: true, landmarks, world, visibility: new Array(33).fill(1) };
    expect(pulseChannelValue(f, 'sway')).toBeCloseTo(0.2, 9); // trunk x 320, ankles' mid 300, torso 100
    expect(pulseChannelValue(f, 'trunk')).toBeCloseTo(1.5, 9);
    expect(pulseChannelValue(f, 'yaw')).toBeCloseTo((Math.atan2(0.2, 0.4) * 180) / Math.PI, 9);
    expect(pulseChannelValue({ ...f, world: undefined }, 'yaw')).toBeNaN();
    const u = createYawUnwrapper();
    expect([170, -170, -150, NaN, -130].map(u)).toEqual([170, 190, 210, NaN, 230]);
  });
});

describe('createPulseSelector (the persistence behind auto)', () => {
  it('takes the first trusted channel at once, keeps the leader against a challenger shorter than the persistence, and switches after it', () => {
    const sel = createPulseSelector<'a' | 'b'>({ switchAfterS: 3, margin: 0.05 });
    expect(sel.update(0, { a: 0, b: 0 })).toBeNull();
    expect(sel.update(0.1, { a: 0.5, b: 0 })).toBe('a');
    // b leads by more than the margin, but for 2.9 s only, then a is back on top: no switch.
    for (let t = 1; t <= 3.9; t += 0.1) expect(sel.update(t, { a: 0.5, b: 0.7 })).toBe('a');
    expect(sel.update(4, { a: 0.7, b: 0.7 })).toBe('a');
    // the clock restarts: 3 s of leading is needed again.
    expect(sel.update(5, { a: 0.5, b: 0.7 })).toBe('a');
    expect(sel.update(7.9, { a: 0.5, b: 0.7 })).toBe('a');
    expect(sel.update(8.1, { a: 0.5, b: 0.7 })).toBe('b');
  });

  it('a leader that stops being trusted is replaced by a trusted challenger only after the persistence; a lead inside the margin never counts', () => {
    const sel = createPulseSelector<'a' | 'b'>({ switchAfterS: 3, margin: 0.05 });
    sel.update(0, { a: 0.6, b: 0 });
    expect(sel.update(1, { a: 0, b: 0 })).toBe('a');
    expect(sel.update(2, { a: 0, b: 0.5 })).toBe('a');
    expect(sel.update(5.1, { a: 0, b: 0.5 })).toBe('b');
    const sel2 = createPulseSelector<'a' | 'b'>();
    sel2.update(0, { a: 0.6, b: 0 });
    for (let t = 0.5; t < 20; t += 0.5) expect(sel2.update(t, { a: 0.6, b: 0.64 })).toBe('a');
  });
});
