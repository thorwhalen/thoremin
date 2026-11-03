/**
 * The live vector's stamp is its camera frame's (#858): the camera sources return their cached
 * frame on every tick until inference delivers the next, so on a camera slower than the tick the
 * same frame is re-offered under new ticks. Stamped with the tick, each re-offer reached the
 * trainer's noise estimate as a new frame with zero displacement and deflated it.
 *
 * The acceptance test replays the resting part of the scripted hand take through the tap at
 * half the camera rate (every camera frame offered on two ticks, as at 60 Hz ticks and a 30 fps
 * camera) and feeds the noise estimator exactly what the trainer would: its snapshot must equal
 * the full-rate one; once by hand, once through a real engine with the real `replay-hands` source
 * playing a 30 fps recording under 60 Hz ticks. Then the edges: the placeholder a source repeats
 * while it has nothing (never a frozen stamp: the smoke probe and the trainer's clock read it),
 * a source that leaves the graph and returns, a vector whose source is not watched, two sources
 * at different rates, and a stamp that never goes back.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createRegistry, Engine, type GraphSpec, type NodeContext } from '@thoremin/dag';
import { handFeatureVectorNode } from '@/nodes/features/hand_feature_vector';
import { HAND_REPLAY_RESOURCE_KEY, replayHandsNode, type HandReplay } from '@/nodes/sources/replay_hands';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import { createNoiseEstimator } from '@thoremin/sdk/enroll/noise';
import { createFreshReader, LiveVectorTap, readLiveVector, resetLiveVector, SOURCE_FRAME_EDGES } from '@thoremin/sdk-ui/enroll/liveVector';
import { waveTake } from './helpers/wave_take';
import { pollLiveVector } from '@/slices/trainer/app/trainerController';
import { makeDebugHandle } from '@/app/engine/debugHandle';

const ctx = (time: number): NodeContext => ({ tick: 0, time, dt: 1 / 60, resources: {} }) as NodeContext;
const HAND_SOURCE = SOURCE_FRAME_EDGES['handVec.vector'];
const FACE_SOURCE = SOURCE_FRAME_EDGES['faceVec.vector'];

afterEach(() => resetLiveVector());

/** Offer one tick: each `[sourceKey, frameObject, vectorKey, vector]` in topological order. */
function offer(tap: LiveVectorTap, time: number, parts: [string, unknown, string, Record<string, number>][]) {
  for (const [sk, frame] of parts) tap.onValue(sk, frame, ctx(time));
  for (const [, , vk, v] of parts) tap.onValue(vk, v, ctx(time));
}

/** Feed `ticks` through a fresh tap and estimator, the trainer's way: only a new stamp is a sample. */
function estimate(ticks: { time: number; frame: object; v: Record<string, number> }[]) {
  resetLiveVector();
  const tap = new LiveVectorTap();
  const noise = createNoiseEstimator();
  let last = -Infinity;
  let samples = 0;
  for (const k of ticks) {
    offer(tap, k.time, [[HAND_SOURCE, k.frame, 'handVec.vector', k.v]]);
    const live = readLiveVector()!;
    noise.push(live.vector, live.t);
    if (live.t > last) samples += 1;
    last = live.t;
  }
  return { snapshot: noise.snapshot(), samples };
}

describe('the live vector tap stamps a vector with its camera frame (#858)', () => {
  const rest = waveTake().frames.filter((f) => f.t < 1900);
  const camera = rest.map((f) => ({ frame: { t: f.t }, v: f.v, t: f.t / 1000 }));

  it('a take at half the camera rate leaves the noise estimate where the full-rate take put it', () => {
    const full = estimate(camera.map((c) => ({ time: c.t, frame: c.frame, v: c.v })));
    // Two ticks per camera frame, the second re-offering the same object (a NEW vector object
    // from the vector node, with the same values).
    const half = estimate(camera.flatMap((c) => [{ time: c.t, frame: c.frame, v: c.v }, { time: c.t + 1 / 60, frame: c.frame, v: { ...c.v } }]));
    expect(half.samples).toBe(full.samples);
    expect(full.samples).toBe(camera.length);
    const id = 'hand.right.wrist.x';
    expect(full.snapshot.sigma[id]).toBeGreaterThan(0);
    expect(half.snapshot.sigma[id]).toBeCloseTo(full.snapshot.sigma[id], 12);
    expect(half.snapshot).toEqual(full.snapshot);
  });

  it('a re-offered frame keeps the stamp of its first offer; a new frame takes its own tick', () => {
    const tap = new LiveVectorTap();
    const a = { t: 1 };
    const b = { t: 2 };
    offer(tap, 1.0, [[HAND_SOURCE, a, 'handVec.vector', { x: 1 }]]);
    offer(tap, 1.016, [[HAND_SOURCE, a, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1000);
    offer(tap, 1.033, [[HAND_SOURCE, b, 'handVec.vector', { x: 2 }]]);
    expect(readLiveVector()!.t).toBe(1033);
  });

  it('a placeholder frame (no stamp of its own) never freezes the stamp, and tickT is the tick', () => {
    const tap = new LiveVectorTap();
    const EMPTY = { width: 640, height: 480, hands: [] };
    for (const time of [1.0, 1.016, 1.033]) {
      offer(tap, time, [[HAND_SOURCE, EMPTY, 'handVec.vector', {}]]);
      expect(readLiveVector()).toMatchObject({ t: time * 1000, tickT: time * 1000 });
    }
  });

  it('a source that missed a tick starts over, even when it returns with the same frame object', () => {
    const tap = new LiveVectorTap();
    const frame = { t: 1 };
    offer(tap, 1.0, [[HAND_SOURCE, frame, 'handVec.vector', { x: 1 }]]);
    // The hand branch leaves the graph for a tick (only the face is offered)...
    offer(tap, 1.016, [[FACE_SOURCE, { t: 1.01 }, 'faceVec.vector', { f: 1 }]]);
    // ...and returns with the same object: a fresh stamp, not the one from a second ago.
    offer(tap, 2.0, [[HAND_SOURCE, frame, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(2000);
  });

  it('the stamp never goes back when the newest part leaves the graph; tickT moves on', () => {
    const tap = new LiveVectorTap();
    const hand = { t: 1 };
    offer(tap, 1.0, [[HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    offer(tap, 1.016, [[FACE_SOURCE, { t: 1.01 }, 'faceVec.vector', { f: 1 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1016);
    // The face branch leaves: only the re-offered hand frame (first offered at 1.0) remains.
    offer(tap, 1.033, [[HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()).toMatchObject({ t: 1016, tickT: 1033 });
  });

  it('a frame recorded on every tick (one object per line, the same t and tOrigin) is a re-offer too', () => {
    const tap = new LiveVectorTap();
    offer(tap, 1.0, [[HAND_SOURCE, { t: 0.99, tOrigin: 5 }, 'handVec.vector', { x: 1 }]]);
    offer(tap, 1.016, [[HAND_SOURCE, { t: 0.99, tOrigin: 5 }, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1000);
    // Another session's frame with the same t is another frame.
    offer(tap, 1.033, [[HAND_SOURCE, { t: 0.99, tOrigin: 6 }, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1033);
  });

  it('a clock that restarts lower (a new engine, no reset) starts over instead of holding the old stamp', () => {
    const tap = new LiveVectorTap();
    offer(tap, 100, [[HAND_SOURCE, { t: 99 }, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(100000);
    offer(tap, 0.5, [[HAND_SOURCE, { t: 0.4 }, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()).toMatchObject({ t: 500, tickT: 500 });
  });

  it('stamps a vector with the tick when its source was not offered this tick (as before #858)', () => {
    const tap = new LiveVectorTap();
    tap.onValue('handVec.vector', { x: 1 }, ctx(3.0));
    expect(readLiveVector()!.t).toBe(3000);
  });

  it('with two sources, the merged stamp is the newest part, and repeats only when both re-offer', () => {
    const tap = new LiveVectorTap();
    const hand = { t: 0.99 };
    const face1 = { t: 0.98 };
    const face2 = { t: 1.0 };
    offer(tap, 1.0, [[FACE_SOURCE, face1, 'faceVec.vector', { f: 1 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    offer(tap, 1.016, [[FACE_SOURCE, face2, 'faceVec.vector', { f: 2 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()).toMatchObject({ vector: { f: 2, x: 1 }, t: 1016 });
    offer(tap, 1.033, [[FACE_SOURCE, face2, 'faceVec.vector', { f: 2 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1016);
  });
});

describe('who reads the clock and who reads the frame stamp (#858)', () => {
  it('the trainer samples a new stamp only, and otherwise ticks on the tick time', () => {
    const calls: string[] = [];
    const trainer = { sample: (_v: unknown, t: number) => calls.push(`sample ${t}`), tick: (t: number) => calls.push(`tick ${t}`) };
    let last = -Infinity;
    last = pollLiveVector(last, { vector: { x: 1 }, t: 1000, tickT: 1000 }, trainer);
    last = pollLiveVector(last, { vector: { x: 1 }, t: 1000, tickT: 1016 }, trainer);
    last = pollLiveVector(last, { vector: { x: 2 }, t: 1033, tickT: 1033 }, trainer);
    last = pollLiveVector(last, null, trainer, () => 2000);
    expect(calls).toEqual(['sample 1000', 'tick 1016', 'sample 1033', 'tick 2000']);
    expect(last).toBe(1033);
  });

  it('the smoke probe reads the tick: it rises while a camera frame is re-offered', () => {
    const handle = makeDebugHandle({ getOutput: () => undefined } as never, {});
    const tap = new LiveVectorTap();
    const frame = { t: 0.9 };
    offer(tap, 1.0, [[HAND_SOURCE, frame, 'handVec.vector', { x: 1 }]]);
    const before = handle.liveVectorTime();
    offer(tap, 1.016, [[HAND_SOURCE, frame, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1000);
    expect(handle.liveVectorTime()).toBeGreaterThan(before);
  });
});

describe('through a real engine: replay-hands playing a 30 fps recording under 60 Hz ticks (#858)', () => {
  /** The take's resting frames as a recording: the real hand frames, each with its capture stamp. */
  const take = waveTake().frames.filter((f) => f.t < 1900);
  const replay: HandReplay = {
    id: 1,
    frames: take.map((f, i) => ({ width: 640, height: 480, hands: [{ handedness: 'Right', keypoints: [], score: 1 }], t: f.t / 1000, i }) as unknown as HandsFrame),
    times: take.map((f) => f.t / 1000),
    loop: false,
  };

  /** Run the engine at `hz` and feed the estimator the trainer's way; returns the samples taken and
   *  whether the stamp ever stood still while the tick moved. */
  function run(hz: number, source: HandReplay = replay) {
    resetLiveVector();
    const spec: GraphSpec = {
      nodes: [
        { id: 'cam', type: 'replay-hands', params: {} },
        { id: 'handVec', type: 'hand-feature-vector', params: {} },
      ],
      edges: [{ from: { node: 'cam', port: 'hands' }, to: { node: 'handVec', port: 'hands' } }],
    };
    const engine = new Engine(spec, createRegistry([replayHandsNode, handFeatureVectorNode] as never), {
      taps: [new LiveVectorTap()],
      resources: { [HAND_REPLAY_RESOURCE_KEY]: () => source },
    });
    const stamps = new Set<number>();
    let held = 0;
    const span = source.times[source.times.length - 1];
    for (let i = 0; i / hz <= span; i++) {
      engine.tick(i / hz);
      const live = readLiveVector();
      if (!live) continue;
      if (stamps.has(live.t)) held += 1;
      stamps.add(live.t);
    }
    return { samples: stamps.size, held };
  }

  it('a recording written on every tick (each camera frame on two lines, two objects) is one sample per camera frame', () => {
    // As the Record tool writes a 30 fps camera under 60 Hz ticks: every frame twice, parsed apart.
    const lines: HandReplay = {
      id: 2,
      frames: replay.frames.flatMap((f) => [JSON.parse(JSON.stringify(f)), JSON.parse(JSON.stringify(f))]),
      times: replay.times.flatMap((t) => [t, t + 1 / 60]),
      loop: false,
    };
    expect(run(60, lines).samples).toBe(replay.frames.length);
  });

  it('each recorded frame is one sample at 60 Hz as at 30 Hz: the re-offers keep their stamp', () => {
    const at30 = run(30);
    const at60 = run(60);
    expect(at30.samples).toBe(replay.frames.length);
    expect(at60.samples).toBe(at30.samples);
    // Half the 60 Hz ticks re-offer a frame, and were held.
    expect(at60.held).toBeGreaterThan(replay.frames.length * 0.8);
  });
});

describe('a stamp per part, and a fresh reader per consumer (#916)', () => {
  const rest = waveTake().frames.filter((f) => f.t < 1900);
  const HAND_KEYS = Object.keys(rest[0].v);
  const handOnly = (snap: ReturnType<ReturnType<typeof createNoiseEstimator>['snapshot']>) =>
    Object.fromEntries(Object.entries(snap.sigma).filter(([k]) => HAND_KEYS.includes(k)));

  /** Face frames new on every 60 Hz tick, each hand frame offered on two ticks (the hands on their
   *  worker at half the face's rate); the estimator fed `fresh` (#916) or, as before, the merged vector. */
  function faceAndHands(feed: 'fresh' | 'merged') {
    resetLiveVector();
    const tap = new LiveVectorTap();
    const read = createFreshReader();
    const noise = createNoiseEstimator();
    rest.forEach((f, k) => {
      for (const half of [0, 1]) {
        const i = 2 * k + half;
        const time = f.t / 1000 + half / 60;
        const face = { t: time };
        offer(tap, time, [
          [FACE_SOURCE, face, 'faceVec.vector', { 'face.jitter': Math.sin(i * 1.7) * 0.01 }],
          [HAND_SOURCE, rest[k], 'handVec.vector', { ...f.v }],
        ]);
        const live = read()!;
        noise.push(feed === 'fresh' ? live.fresh : live.vector, live.t);
      }
    });
    return noise.snapshot();
  }

  it('the hand features\' noise estimate equals the hand-only one at the hand\'s own rate', () => {
    // The hand alone, one tick per camera frame, at its frames' own times.
    const alone = createNoiseEstimator();
    for (const f of rest) alone.push(f.v, f.t);
    const fresh = handOnly(faceAndHands('fresh'));
    expect(fresh['hand.right.wrist.x']).toBeGreaterThan(0);
    const expected = handOnly(alone.snapshot());
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(expected).sort());
    for (const k of Object.keys(expected)) expect(fresh[k]).toBeCloseTo(expected[k], 12);
    // The merged vector at the face's stamp repeats the hand under a new stamp: deflated (#916).
    expect(handOnly(faceAndHands('merged'))['hand.right.wrist.x']).toBeLessThan(0.8 * fresh['hand.right.wrist.x']);
  });

  it('each reader sees each part once, whatever the other readers took', () => {
    const tap = new LiveVectorTap();
    const a = createFreshReader();
    const b = createFreshReader();
    offer(tap, 1.0, [[FACE_SOURCE, { t: 1 }, 'faceVec.vector', { f: 1 }], [HAND_SOURCE, { t: 1 }, 'handVec.vector', { h: 1 }]]);
    expect(a()!.fresh).toEqual({ f: 1, h: 1 });
    offer(tap, 1.016, [[FACE_SOURCE, { t: 2 }, 'faceVec.vector', { f: 2 }], [HAND_SOURCE, { t: 1 }, 'handVec.vector', { h: 1 }]]);
    expect(a()!.fresh).toEqual({ f: 2 });
    // b never read before: both parts are new to it.
    expect(b()!.fresh).toEqual({ f: 2, h: 1 });
    expect(a()!.fresh).toEqual({});
    expect(readLiveVector()!.parts.map((p) => [p.edge, p.t])).toEqual([['faceVec.vector', 1016], ['handVec.vector', 1000]]);
  });

  it('a clock that restarts lower (a new engine) starts a reader over', () => {
    const tap = new LiveVectorTap();
    const r = createFreshReader();
    offer(tap, 5.0, [[HAND_SOURCE, { t: 5 }, 'handVec.vector', { h: 5 }]]);
    expect(r()!.fresh).toEqual({ h: 5 });
    offer(tap, 0.5, [[HAND_SOURCE, { t: 0.5 }, 'handVec.vector', { h: 0 }]]);
    expect(r()!.fresh).toEqual({ h: 0 });
  });

  it('the trainer\'s poll samples only the fresh parts', () => {
    const sampled: Record<string, number>[] = [];
    const trainer = { sample: (v: Record<string, number>) => void sampled.push(v), tick() {} };
    pollLiveVector(-Infinity, { vector: { f: 1, h: 1 }, t: 1, tickT: 1, fresh: { f: 1 } }, trainer);
    pollLiveVector(-Infinity, { vector: { f: 1, h: 1 }, t: 1, tickT: 1 }, trainer);
    expect(sampled).toEqual([{ f: 1 }, { f: 1, h: 1 }]);
  });
});
