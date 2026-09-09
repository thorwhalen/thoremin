/**
 * The body feature catalog + `body-feature-vector` (#186): geometry checked on the
 * synthetic skeleton whose pose is known by construction (arms hanging → elbows
 * straight, knees straight, nobody leaning), kinematics checked across frames
 * (a still body has zero motion; a moving wrist has a positive speed), the
 * effort window, the relations, the Lab gate, and the whole path run headlessly
 * from `synthetic-body` through the vector node with every value finite.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext } from '@/dag';
import { runHeadless } from '@/dag';
import { createCoreRegistry, bodyFeatureVectorNode } from '@/nodes';
import { BLM, makeBodyKeypoints, type BodyFrame } from '@/nodes/domain';
import { ALL_FEATURES, BODY_FEATURES, FEATURE_BY_ID, FEATURE_GROUPS, buildBodyCtx, type FeatureVector } from '@/features/catalog';
import { BODY_GROUP_IDS, labWantsBody } from '@/features/labConfig';

const W = 640;
const H = 480;

function frameOf(over: Partial<Parameters<typeof makeBodyKeypoints>[0]> = {}): BodyFrame {
  const { landmarks, world } = makeBodyKeypoints({ width: W, height: H, cx: 0.5, cy: 0.6, torso: 100, leftArm: 0, rightArm: 0, kneeBend: 0, lean: 0, ...over });
  return { width: W, height: H, present: true, landmarks, world, visibility: new Array(33).fill(1) };
}

const bareCtx = (time = 0, resources: Record<string, unknown> = {}): NodeContext => ({ tick: 0, time, dt: 1 / 30, resources });
const allFinite = (v: FeatureVector) => Object.values(v).every((x) => Number.isFinite(x));
const compute = (id: string, frame: BodyFrame) => {
  const f = BODY_FEATURES.find((x) => x.id === id)!;
  return f.compute(buildBodyCtx(frame, { mirrorX: true, dtS: NaN, history: [] }));
};

describe('body catalog — registry', () => {
  it('registers six body groups and every body feature under one of them, ids unique', () => {
    expect(BODY_GROUP_IDS).toEqual(['body.angle', 'body.pos', 'body.kin', 'body.shape', 'body.effort', 'body.rel']);
    expect(FEATURE_GROUPS.filter((g) => g.source === 'body').map((g) => g.id)).toEqual(BODY_GROUP_IDS);
    const ids = BODY_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of BODY_FEATURES) {
      expect(f.id.startsWith('body.')).toBe(true);
      expect(BODY_GROUP_IDS).toContain(f.group);
      expect(f.source).toBe('body');
      expect(FEATURE_BY_ID[f.id]).toBeTruthy();
      expect(f.description).toBeTruthy();
    }
    expect(ALL_FEATURES.filter((f) => f.source === 'body')).toHaveLength(BODY_FEATURES.length);
  });

  it('checking a body group in the Lab is what turns the body model on', () => {
    expect(labWantsBody({ show: true, groups: ['body.angle'] } as never)).toBe(true);
    expect(labWantsBody({ show: true, groups: ['hand.whole'] } as never)).toBe(false);
    expect(labWantsBody({ show: false, groups: ['body.angle'] } as never)).toBe(false);
  });
});

describe('body catalog — geometry on the synthetic skeleton', () => {
  it('arms hanging → straight elbows; knees straight; upright; head level', () => {
    const f = frameOf();
    expect(compute('body.angle.elbow.left', f)).toBeCloseTo(180, 5);
    expect(compute('body.angle.elbow.right', f)).toBeCloseTo(180, 5);
    expect(compute('body.angle.knee.left', f)).toBeCloseTo(180, 5);
    // Shoulders sit wider than the hips, so the torso–thigh angle is a few degrees under straight.
    expect(compute('body.angle.hip.left', f)).toBeGreaterThan(165);
    expect(compute('body.angle.torso.lean', f)).toBeCloseTo(0, 5);
    expect(compute('body.angle.head.tilt', f)).toBeCloseTo(0, 5);
    // Arm down: the hip–shoulder–elbow angle is small (the elbow hangs beside the hip line).
    expect(compute('body.angle.shoulder.left', f)).toBeLessThan(30);
  });

  it('a raised arm and a bent knee read as such', () => {
    const f = frameOf({ leftArm: 1, kneeBend: 0.8 });
    expect(compute('body.angle.shoulder.left', f)).toBeGreaterThan(150);
    expect(compute('body.angle.shoulder.right', f)).toBeLessThan(30);
    expect(compute('body.angle.knee.left', f)).toBeLessThan(140);
    expect(compute('body.rel.kneeBent.left', f)).toBe(1);
    expect(compute('body.rel.handAboveHead.left', f)).toBe(1);
    expect(compute('body.rel.handAboveHead.right', f)).toBe(0);
    expect(compute('body.rel.armsRaised', f)).toBe(0);
    expect(compute('body.pos.wrist.left.rise', f)).toBeGreaterThan(0.5);
    expect(compute('body.pos.wrist.right.rise', f)).toBeLessThan(0);
  });

  it('a lean is signed and flips the leaning relations', () => {
    const left = frameOf({ lean: 0.3 });
    expect(compute('body.angle.torso.lean', left)).toBeGreaterThan(10);
    expect(compute('body.rel.leaningLeft', left)).toBe(1);
    expect(compute('body.rel.leaningRight', left)).toBe(0);
    const right = frameOf({ lean: -0.3 });
    expect(compute('body.rel.leaningRight', right)).toBe(1);
  });

  it('positions are normalised 0..1 and mirrored: the subject\'s left wrist shows at smaller x', () => {
    const f = frameOf();
    const lx = compute('body.pos.wrist.left.x', f);
    const rx = compute('body.pos.wrist.right.x', f);
    expect(lx).toBeGreaterThan(0);
    expect(rx).toBeLessThan(1);
    expect(lx).toBeLessThan(rx);
    expect(compute('body.pos.hip.y', f)).toBeCloseTo(0.6, 5);
  });

  it('shape ratios are scale-free: the same pose at twice the size reads the same', () => {
    const a = frameOf({ torso: 80 });
    const b = frameOf({ torso: 160 });
    for (const id of ['body.shape.extension', 'body.shape.openness', 'body.shape.stance', 'body.shape.height', 'body.angle.elbow.left']) {
      expect(compute(id, a), id).toBeCloseTo(compute(id, b), 6);
    }
    expect(compute('body.rel.feetApart', a)).toBe(0);
  });

  it('a frame with no torso yields NaN, never Infinity', () => {
    const f = frameOf();
    // Collapse the torso: shoulders onto the hips.
    f.landmarks[BLM.left_shoulder] = { ...f.landmarks[BLM.left_hip] };
    f.landmarks[BLM.right_shoulder] = { ...f.landmarks[BLM.right_hip] };
    f.world![BLM.left_shoulder] = { ...f.world![BLM.left_hip] };
    f.world![BLM.right_shoulder] = { ...f.world![BLM.right_hip] };
    const v = compute('body.shape.extension', f);
    expect(Number.isNaN(v)).toBe(true);
    expect(Number.isFinite(compute('body.pos.wrist.left.rise', f))).toBe(false);
  });
});

describe('body-feature-vector (unit)', () => {
  const run = (frames: BodyFrame[], params: unknown = {}, resources: Record<string, unknown> = {}) => {
    const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse(params));
    return frames.map((frame, i) => (h.process({ body: frame }, bareCtx(i / 30, resources)) as { vector: FeatureVector }).vector);
  };

  it('the first frame has geometry but no kinematics; the second has both, all finite', () => {
    const [v0, v1] = run([frameOf(), frameOf({ leftArm: 0.1 })]);
    expect(v0['body.angle.elbow.left']).toBeCloseTo(180, 5);
    expect(v0['body.kin.qom']).toBeUndefined();
    expect(v0['body.kin.speed.wrist.left']).toBeUndefined();
    expect(v1['body.kin.qom']).toBeGreaterThan(0);
    expect(v1['body.kin.speed.wrist.left']).toBeGreaterThan(0);
    expect(v1['body.kin.speed.head']).toBeCloseTo(0, 6);
    expect(allFinite(v0) && allFinite(v1)).toBe(true);
  });

  it('a still body has zero motion and zero effort, and effort appears with the window', () => {
    const still = run(Array.from({ length: 12 }, () => frameOf()));
    const last = still[still.length - 1];
    expect(last['body.kin.qom']).toBeCloseTo(0, 9);
    expect(last['body.effort.weight']).toBeCloseTo(0, 9);
    expect(last['body.effort.time']).toBeCloseTo(0, 9);
    expect(last['body.effort.flow']).toBeCloseTo(0, 9);
    // Space (directness) is undefined for a body that has not moved: NaN → dropped.
    expect(last['body.effort.space']).toBeUndefined();
    // A wrist sweeping in a straight line: directness ≈ 1, weight > 0.
    const moving = run(Array.from({ length: 12 }, (_, i) => frameOf({ leftArm: i / 24, rightArm: i / 24 })));
    const m = moving[moving.length - 1];
    expect(m['body.effort.weight']).toBeGreaterThan(0);
    expect(m['body.effort.space']).toBeGreaterThan(0.99);
    expect(m['body.effort.space']).toBeLessThan(1.2);
    expect(allFinite(m)).toBe(true);
  });

  it('an absent frame empties the vector and the history (no teleport speed on return)', () => {
    const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse({}));
    h.process({ body: frameOf() }, bareCtx(0));
    const gone = (h.process({ body: { width: W, height: H, present: false, landmarks: [], visibility: [] } }, bareCtx(1 / 30)) as { vector: FeatureVector }).vector;
    expect(Object.keys(gone)).toHaveLength(0);
    const back = (h.process({ body: frameOf({ leftArm: 1 }) }, bareCtx(2 / 30)) as { vector: FeatureVector }).vector;
    expect(back['body.kin.speed.wrist.left']).toBeUndefined();
  });

  it('the static groups param and the live Lab config gate what computes', () => {
    const [v] = run([frameOf()], { groups: ['body.angle'] });
    expect(v['body.angle.elbow.left']).toBeDefined();
    expect(v['body.pos.hip.y']).toBeUndefined();
    const hidden = run([frameOf()], {}, { controls: () => ({ featureLab: { show: false, groups: ['body.angle'] } }) });
    expect(Object.keys(hidden[0])).toHaveLength(0);
    const shown = run([frameOf()], {}, { controls: () => ({ featureLab: { show: true, groups: ['body.rel'] } }) });
    expect(shown[0]['body.rel.armsRaised']).toBe(0);
    expect(shown[0]['body.angle.elbow.left']).toBeUndefined();
  });
});

describe('body-feature-vector — the live-camera guards the review asked for', () => {
  const walkFrame = (shift: number, over: Partial<Parameters<typeof makeBodyKeypoints>[0]> = {}) =>
    frameOf({ cx: 0.5 + shift, ...over });

  it('the SAME frame object again is not a new sample: the last vector is re-emitted, history untouched', () => {
    const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse({}));
    const a = frameOf();
    const b = frameOf({ leftArm: 0.2 });
    h.process({ body: a }, bareCtx(0));
    const v1 = (h.process({ body: b }, bareCtx(1 / 30)) as { vector: FeatureVector }).vector;
    // A 60 Hz engine over a 30 fps camera: b arrives again on the next tick.
    const v2 = (h.process({ body: b }, bareCtx(2 / 30)) as { vector: FeatureVector }).vector;
    expect(v2).toBe(v1);
    // The tick after that (a genuinely new frame) measures against b ONCE, over the real
    // gap since b was inferred (two ticks): the same arm move in twice the time is half
    // the speed — not zero, not double, which is what a duplicated sample would give.
    const c = frameOf({ leftArm: 0.4 });
    const v3 = (h.process({ body: c }, bareCtx(3 / 30)) as { vector: FeatureVector }).vector;
    expect(v3['body.kin.speed.wrist.left']).toBeCloseTo(v1['body.kin.speed.wrist.left'] / 2, 6);
  });

  it('a body walking across the frame has motion even though the world set is hip-centred', () => {
    const frames = Array.from({ length: 8 }, (_, i) => walkFrame(i * 0.02));
    const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse({}));
    const vs = frames.map((f, i) => (h.process({ body: f }, bareCtx(i / 30)) as { vector: FeatureVector }).vector);
    const last = vs[vs.length - 1];
    expect(frames[3].world).toBeDefined();
    expect(last['body.kin.qom']).toBeGreaterThan(0.5);
    expect(last['body.kin.speed.head']).toBeGreaterThan(0.5);
    expect(last['body.effort.weight']).toBeGreaterThan(0);
    // Angles still read the world set: the walk changes no joint angle.
    expect(last['body.angle.elbow.left']).toBeCloseTo(vs[0]['body.angle.elbow.left'], 6);
  });

  it('a late frame is measured over its own gap: the deceleration shows in accel, and effort.time is the same wherever the gap sits', () => {
    // A constant sweep sampled at 30 Hz, then one frame arriving a gap late (dt doubles):
    // the wrist covered the same distance in twice the time → a real deceleration.
    const sweep = (n: number) => Array.from({ length: n }, (_, i) => frameOf({ leftArm: 0.02 * i }));
    const run = (times: number[]) => {
      const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse({}));
      const fs = sweep(times.length);
      return times.map((t, i) => (h.process({ body: fs[i] }, bareCtx(t)) as { vector: FeatureVector }).vector);
    };
    const regular = run(Array.from({ length: 10 }, (_, i) => i / 30));
    expect(regular[9]['body.kin.accel.wrist.left']).toBeCloseTo(0, 6);
    const lateLast = run([0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((k) => k / 30));
    expect(lateLast[9]['body.kin.accel.wrist.left']).toBeGreaterThan(1);
    // The same late gap mid-window: the deceleration it caused has the same magnitude
    // at the tick it happened, wherever in the window it sits (one late frame must not
    // rescale the rest of the window).
    const lateMid = run([0, 1, 2, 3, 4, 6, 7, 8, 9, 10].map((k) => k / 30));
    expect(lateMid[5]['body.kin.accel.wrist.left']).toBeCloseTo(lateLast[9]['body.kin.accel.wrist.left'], 6);
    // And the window mean sees that one event plus its recovery — two events of the
    // same size — so it reads about twice the still-open late-last case.
    expect(lateMid[9]['body.effort.time']).toBeGreaterThan(lateLast[9]['body.effort.time']);
  });

  it('a stalled clock (dt = 0) cannot grow the history without bound', () => {
    const h = bodyFeatureVectorNode.make(bodyFeatureVectorNode.params.parse({ windowSeconds: 1 }));
    // 1000 distinct frames all at t = 0: speeds are undefined, but the node must stay bounded.
    let v: FeatureVector = {};
    for (let i = 0; i < 1000; i++) v = (h.process({ body: frameOf({ leftArm: (i % 50) / 50 }) }, bareCtx(0)) as { vector: FeatureVector }).vector;
    expect(allFinite(v)).toBe(true);
    expect(v['body.kin.qom']).toBeUndefined();
    // The cap is 120 samples per second of window + 3 (see the node); the effort features
    // read it, so a bounded window is a bounded per-tick cost.
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) h.process({ body: frameOf({ leftArm: 0.5 }) }, bareCtx(0));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('the body path, headless: synthetic-body → body-feature-vector', () => {
  it('every emitted value is finite over 90 ticks, and the hip bounces at the declared period', async () => {
    const period = 0.4; // 12 ticks at 30 fps, so half a period is a whole tick
    const spec = {
      nodes: [
        { id: 'b', type: 'synthetic-body', params: { bouncePeriod: period } },
        { id: 'v', type: 'body-feature-vector', params: {} },
      ],
      edges: [{ from: { node: 'b', port: 'body' }, to: { node: 'v', port: 'body' } }],
    };
    const { recorder } = await runHeadless(spec, createCoreRegistry(), { ticks: 90, nominalDt: 1 / 30, recordOnly: ['v.vector'] });
    const vectors = recorder.values('v.vector') as FeatureVector[];
    expect(vectors).toHaveLength(90);
    for (const v of vectors) expect(allFinite(v)).toBe(true);
    // From the third tick on, every group has produced something.
    const keys = new Set(Object.keys(vectors[10]));
    for (const g of ['body.angle', 'body.pos', 'body.kin', 'body.shape', 'body.effort', 'body.rel']) {
      expect([...keys].some((k) => k.startsWith(g + '.')), g).toBe(true);
    }
    // hip.y is periodic with the bounce: samples one period apart agree, half a period apart differ.
    const hip = vectors.map((v) => v['body.pos.hip.y']);
    const perTicks = Math.round(period * 30);
    for (let i = 5; i + perTicks < hip.length; i += 7) {
      expect(Math.abs(hip[i] - hip[i + perTicks])).toBeLessThan(1e-6);
    }
    expect(Math.abs(hip[5] - hip[5 + perTicks / 2])).toBeGreaterThan(0.005);
  });
});
