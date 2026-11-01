/**
 * The live vector's stamp is its camera frame's (#858): the camera sources return their cached
 * frame on every tick until inference delivers the next, so on a camera slower than the tick the
 * same frame is re-offered under new ticks. Stamped with the tick, each re-offer reached the
 * trainer's noise estimate as a new frame with zero displacement and deflated it.
 *
 * The acceptance test replays the resting part of the scripted hand take through the tap at
 * half the camera rate (every camera frame offered on two ticks, as at 60 Hz ticks and a 30 fps
 * camera) and feeds the noise estimator exactly what the trainer would: its snapshot must equal
 * the full-rate one. Then the edges: a source that leaves the graph and returns with the same
 * empty-frame object, a vector whose source is not watched, and two sources at different rates.
 */
import { afterEach, describe, it, expect } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { createNoiseEstimator } from '@thoremin/sdk/enroll/noise';
import { LiveVectorTap, readLiveVector, resetLiveVector, SOURCE_FRAME_EDGES } from '@thoremin/sdk-ui/enroll/liveVector';
import { waveTake } from './helpers/wave_take';

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
    const a = {};
    const b = {};
    offer(tap, 1.0, [[HAND_SOURCE, a, 'handVec.vector', { x: 1 }]]);
    offer(tap, 1.016, [[HAND_SOURCE, a, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1000);
    offer(tap, 1.033, [[HAND_SOURCE, b, 'handVec.vector', { x: 2 }]]);
    expect(readLiveVector()!.t).toBe(1033);
  });

  it('a source that missed a tick starts over, even when it returns with the same empty-frame object', () => {
    const tap = new LiveVectorTap();
    const EMPTY = {};
    offer(tap, 1.0, [[HAND_SOURCE, EMPTY, 'handVec.vector', {}]]);
    // The hand branch leaves the graph for a tick (only the face is offered)...
    offer(tap, 1.016, [[FACE_SOURCE, {}, 'faceVec.vector', { f: 1 }]]);
    // ...and returns with the same constant: a fresh stamp, not the one from a second ago.
    offer(tap, 2.0, [[HAND_SOURCE, EMPTY, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(2000);
  });

  it('stamps a vector with the tick when its source was not offered this tick (as before #858)', () => {
    const tap = new LiveVectorTap();
    tap.onValue('handVec.vector', { x: 1 }, ctx(3.0));
    expect(readLiveVector()!.t).toBe(3000);
  });

  it('with two sources, the merged stamp is the newest part, and repeats only when both re-offer', () => {
    const tap = new LiveVectorTap();
    const hand = {};
    const face1 = {};
    const face2 = {};
    offer(tap, 1.0, [[FACE_SOURCE, face1, 'faceVec.vector', { f: 1 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    offer(tap, 1.016, [[FACE_SOURCE, face2, 'faceVec.vector', { f: 2 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()).toEqual({ vector: { f: 2, x: 1 }, t: 1016 });
    offer(tap, 1.033, [[FACE_SOURCE, face2, 'faceVec.vector', { f: 2 }], [HAND_SOURCE, hand, 'handVec.vector', { x: 1 }]]);
    expect(readLiveVector()!.t).toBe(1016);
  });
});
