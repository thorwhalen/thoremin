/**
 * The shaping hand's gesture (#457): while the hand that shapes the dynamics makes no
 * stroke, its height (on the torso) and its palm (up to rise, down to hush) say the
 * loudness, continuously, against the player's own recent range.
 *
 * The palm's sign per handedness label is pinned on real landmarks (the ASL letter B, a
 * palm toward the camera: `test/fixtures/hand_palm_forward/`), turned rigidly so the palm
 * faces up or down; the conductor's tests script a body beating with the right arm and a
 * left hand built from those landmarks.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { replayNode } from '@thoremin/dag';
import { createHandGesture } from '@thoremin/ictus';
import { BLM, type BodyFrame, type Hand, type HandsFrame, type Keypoint } from '@thoremin/sdk/nodes/domain';
import { conductorNode } from '@/slices/conductor/nodes/conductor';
import { conductorReadsTwoHands } from '@/slices/conductor/nodes/conductor';
import { deriveHandCount } from '@/instruments/hands';
import { handGestureFrame, palmUp } from '@/slices/conductor/nodes/conductor_gesture';
import { conduct, type Gesture } from '../helpers/body_conduct';
import { CONDUCTOR } from '../helpers/extensions';

type FixtureHand = Hand & { id: string; width: number; height: number };
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/hand_palm_forward/hands.json', import.meta.url), 'utf8')) as FixtureHand[];

/** Turn a hand rigidly about the image's x axis by `deg` (positive tips the fingers away
 *  from the camera: the palm, facing the camera at 0, faces up at +90 and down at -90),
 *  about its wrist; image keypoints in isotropic pixels (the model's z is in image widths). */
function tilt(h: FixtureHand, deg: number): FixtureHand {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const turn = (kp: Keypoint[], zScale: number): Keypoint[] => {
    const w = kp[0];
    return kp.map((p) => {
      const y = p.y - w.y;
      const z = ((p.z ?? 0) - (w.z ?? 0)) * zScale;
      // y down, z away from the camera: the palm's normal (0, 0, -1) goes to (0, -sin, -cos).
      return { x: p.x, y: w.y + y * c + z * s, z: (w.z ?? 0) + (-y * s + z * c) / zScale };
    });
  };
  return { ...h, keypoints: turn(h.keypoints, h.width), worldKeypoints: h.worldKeypoints && turn(h.worldKeypoints, 1) };
}

describe.runIf(CONDUCTOR)('the palm faces up or down (real landmarks, both labels)', () => {
  it('a palm toward the camera reads level; turned up reads up, turned down reads down', () => {
    expect(FIXTURE.map((h) => h.handedness).sort()).toEqual(['Left', 'Left', 'Left', 'Right', 'Right', 'Right']);
    for (const h of FIXTURE) {
      for (const world of [true, false]) {
        const hand = world ? h : { ...h, worldKeypoints: undefined };
        expect(Math.abs(palmUp(hand, h)!), `${h.id} forward`).toBeLessThan(0.5);
        expect(palmUp(tilt(hand, 90), h)!, `${h.id} up`).toBeGreaterThan(0.7);
        expect(palmUp(tilt(hand, -90), h)!, `${h.id} down`).toBeLessThan(-0.7);
      }
    }
  });
});

describe.runIf(CONDUCTOR)('a source without depth has no palm (#514)', () => {
  it('reads undefined, not a level palm, when the keypoints carry no z', () => {
    const h = FIXTURE[0];
    const flat = { ...h, worldKeypoints: undefined, keypoints: h.keypoints.map(({ x, y }) => ({ x, y })) };
    expect(palmUp(flat, h)).toBeUndefined();
    expect(handGestureFrame(flat, { ...h, hands: [flat] } as HandsFrame, undefined, 1).palmUp).toBeUndefined();
    expect(palmUp({ ...h, worldKeypoints: undefined }, h)).toBeDefined();
  });
});

describe.runIf(CONDUCTOR)('ictus createHandGesture', () => {
  /** A hand moving between 0.2 and 0.6 torso for `s` seconds from `t0` (it teaches the range). */
  const wander = (g: ReturnType<typeof createHandGesture>, t0: number, s: number): number => {
    let t = t0;
    for (; t < t0 + s; t += 1 / 30) g.push({ t, height: 0.4 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t), heightOn: 'torso' });
    return t;
  };

  it('a hand that has never moved says nothing; one that moved reads its middle, a raised hand higher', () => {
    const g = createHandGesture();
    let t = 0;
    for (; t < 5; t += 1 / 30) g.push({ t, height: 0.4 + 0.005 * Math.sin(37 * t), heightOn: 'torso', palmUp: 0.01 * Math.cos(29 * t) });
    expect(g.read(t)).toBeNaN();
    t = wander(g, t, 12);
    expect(g.read(t)).toBeGreaterThan(0.3);
    expect(g.read(t)).toBeLessThan(0.7);
    for (const end = t + 1.5; t < end; t += 1 / 30) g.push({ t, height: 1.1, heightOn: 'torso' });
    expect(g.read(t)).toBeGreaterThan(0.9);
    // Not seen for longer than `holdS`: nothing.
    expect(g.read(t + 2)).toBeNaN();
  });

  it('a hand raised and HELD keeps its reading (a held posture is not the new middle)', () => {
    const g = createHandGesture();
    let t = wander(g, 0, 20);
    for (const end = t + 2; t < end; t += 1 / 30) g.push({ t, height: 0.4 + 0.7 * ((t - (end - 2)) / 2), heightOn: 'torso' });
    const raised = g.read(t);
    expect(raised).toBeGreaterThan(0.8);
    let low = 1;
    for (const end = t + 25; t < end; t += 1 / 30) {
      g.push({ t, height: 1.1 + 0.003 * Math.sin(41 * t), heightOn: 'torso' });
      low = Math.min(low, g.read(t));
    }
    expect(low).toBeGreaterThan(raised - 0.05);
  });

  it('a palm that never turns drops out instead of capping the height at its middle', () => {
    const g = createHandGesture();
    let t = 0;
    for (; t < 20; t += 1 / 30) g.push({ t, height: 0.4 + 0.2 * Math.sin(2 * Math.PI * 0.25 * t), heightOn: 'torso', palmUp: 0 });
    for (const end = t + 1.5; t < end; t += 1 / 30) g.push({ t, height: 1.2, heightOn: 'torso', palmUp: 0 });
    expect(g.read(t)).toBeGreaterThan(0.95);
  });
});

describe.runIf(CONDUCTOR)('the hand height is read on the torso when the body is seen', () => {
  it('the same height on the torso reads the same, however near the player stands', () => {
    const read = (torso: number) => {
      const f = conduct([{ kind: 'rest', s: 0.2 }], { fps: 30, torso, noisePx: 0 }).frames[0];
      const { hipY, torso: len } = torsoOf(f);
      const hand: Hand = { handedness: 'Left', keypoints: Array.from({ length: 21 }, () => ({ x: 300, y: hipY - 0.6 * len })), score: 1 };
      return handGestureFrame(hand, { t: 0, width: f.width, height: f.height, hands: [hand] }, f, 0);
    };
    const near = read(200);
    const far = read(120);
    expect(near.heightOn).toBe('torso');
    expect(near.height).toBeCloseTo(0.6, 6);
    expect(far.height).toBeCloseTo(0.6, 6);
  });
});

const FPS = 30;
const BPM = 90;
const P = 60 / BPM;
const BODY = { enabled: true, source: 'body', hand: 'right', mirrorX: false, mirrorHandedness: false, expression: 'hands' } as const;
const START: Gesture[] = [
  { kind: 'rest', s: 1.5 },
  { kind: 'ready', s: 1.2 },
  { kind: 'upbeat', s: P },
];
const LEFT = FIXTURE.find((h) => h.handedness === 'Left')!;

/** The torso's hips and length in a body frame (pixels). */
function torsoOf(f: BodyFrame): { hipY: number; torso: number; x: number } {
  const L = f.landmarks;
  const hipY = (L[BLM.left_hip].y + L[BLM.right_hip].y) / 2;
  const shY = (L[BLM.left_shoulder].y + L[BLM.right_shoulder].y) / 2;
  return { hipY, torso: hipY - shY, x: L[BLM.left_shoulder].x + 40 };
}

/** The player's left hand (the real landmarks, scaled to a 640 x 480 frame) with its wrist
 *  `rise(t)` torso lengths above the hips and its palm tilted `tiltDeg(t)`; no stroke. */
function leftHand(frames: BodyFrame[], rise: (t: number) => number, tiltDeg: (t: number) => number = () => 0): HandsFrame[] {
  const k = 0.25;
  return frames.map((f) => {
    const t = f.t ?? 0;
    const { hipY, torso, x } = torsoOf(f);
    const h = tilt(LEFT, tiltDeg(t));
    const w = h.keypoints[0];
    const wy = hipY - rise(t) * torso;
    const keypoints = h.keypoints.map((p) => ({ x: x + (p.x - w.x) * k, y: wy + (p.y - w.y) * k, z: ((p.z ?? 0) * LEFT.width * k) / f.width }));
    const hand: Hand = { handedness: 'Left', keypoints, worldKeypoints: h.worldKeypoints, score: 1 };
    return { t, width: f.width, height: f.height, hands: [hand] };
  });
}

/** A smooth ramp from `a` to `b` over [t0, t1]. */
const ramp = (t: number, t0: number, t1: number, a: number, b: number): number => {
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  return a + (b - a) * u * u * (3 - 2 * u);
};

type Out = { velocityScale: number; dynamics: number; time: { state: string } };

async function run(gestures: Gesture[], hands: (frames: BodyFrame[]) => HandsFrame[], params: Record<string, unknown> = {}) {
  const sc = conduct([...START, ...gestures], { fps: FPS });
  const h = conductorNode.make(conductorNode.params.parse({ ...BODY, ...params }));
  const outs = (await replayNode(h, { body: sc.frames, hands: hands(sc.frames) }, { dt: 1 / FPS })) as Out[];
  const at = (t: number) => outs[Math.round(t * FPS)];
  return { sc, outs, at };
}

/** Samples of `velocityScale` every half second over [a, b]. */
const samples = (at: (t: number) => Out, a: number, b: number): number[] => {
  const xs: number[] = [];
  for (let t = a; t <= b + 1e-9; t += 0.5) xs.push(at(t).velocityScale);
  return xs;
};
const steps = (xs: number[]): number[] => xs.slice(1).map((x, i) => x - xs[i]);

/** velocityScale spans `dynMin`..`dynMax` (0.35..1). The scripted hands move one cue at a
 *  time, and a cue that never moves drops out, so the one that moves is the whole reading:
 *  from the middle of its range (0.5) to the top moves velocityScale by 0.5 x 0.65. */
const SPAN = 0.5 * 0.65;
/** The scripted hands teach their range first (they move through it), then the gesture
 *  under test starts this long after the rest before it (the movement test's window). */
const TAUGHT = 0.5;

describe.runIf(CONDUCTOR)('the split role: a left hand that does not stroke shapes by its height and palm (#457)', () => {
  const beats: Gesture[] = [{ kind: 'beat', bpm: BPM, beats: 36 }];
  // The left hand moves through the player's range (4 to 9 s), rests low, then rises
  // slowly, is held up, and falls slowly: never a stroke.
  const RISE = { t0: 10, t1: 16, top: 18, t2: 24 };
  const rise = (t: number) =>
    t < 4 ? 0.1 : t < 9 ? 0.55 - 0.45 * Math.cos((2 * Math.PI * (t - 4)) / 5) : t < RISE.top ? ramp(Math.max(t, RISE.t0), RISE.t0, RISE.t1, 0.1, 1) : ramp(t, RISE.top, RISE.t2, 1, 0.1);

  it('the acceptance: rising and falling with no strokes moves velocityScale monotonically while the body beats', async () => {
    const { at, outs } = await run(beats, (f) => leftHand(f, rise));
    expect(outs.some((o) => o.time.state === 'running')).toBe(true);
    const up = samples(at, RISE.t0 + TAUGHT, RISE.t1);
    const down = samples(at, RISE.top + 0.5, RISE.t2);
    expect(Math.min(...steps(up))).toBeGreaterThanOrEqual(-0.01);
    expect(up[up.length - 1] - up[0]).toBeGreaterThan(0.6 * SPAN);
    expect(Math.max(...steps(down))).toBeLessThanOrEqual(0.01);
    expect(down[0] - down[down.length - 1]).toBeGreaterThan(0.6 * SPAN);
  });

  it('the palm turned from down to up at a still height raises the dynamics', async () => {
    // The palm turns down and up for 10 s (the player's range), is held down, then turns
    // slowly up and is held there.
    const tiltDeg = (t: number) => (t < 14 ? 80 * Math.sin((2 * Math.PI * (t - 4)) / 4 - Math.PI / 2) * (t < 4 ? 0 : 1) : t < 16 ? -80 : ramp(t, 16, 21, -80, 80));
    const { at } = await run(beats, (f) => leftHand(f, () => 0.5, tiltDeg));
    const xs = samples(at, 16.5, 21);
    expect(Math.min(...steps(xs))).toBeGreaterThanOrEqual(-0.01);
    const down = samples(at, 14.5, 16);
    const up = samples(at, 21.5, 23);
    expect(Math.min(...up) - Math.max(...down)).toBeGreaterThan(SPAN);
  });

  it('one turn is not a beat: a hand lowered to hush and stopping keeps shaping by its gesture', async () => {
    // The range taught (4 to 9 s), the hand held high, then dropped in 0.6 s and held low.
    const drop = (t: number) => (t < 9 ? rise(t) : t < 10 ? ramp(t, 9, 10, 0.1, 1) : t < 12 ? 1 : ramp(t, 12, 12.6, 1, 0.1));
    const { at } = await run(beats, (f) => leftHand(f, drop));
    const high = at(11.5).velocityScale;
    const after = samples(at, 13, 15.5);
    expect(high - Math.max(...after)).toBeGreaterThan(SPAN);
  });

  it('the shares are dials: with the height at 0 only the palm counts', async () => {
    const { at } = await run(beats, (f) => leftHand(f, rise), { handGesture: { height: 0, palm: 1 } });
    const up = samples(at, RISE.t0 + TAUGHT, RISE.t1);
    expect(Math.abs(up[up.length - 1] - up[0])).toBeLessThan(0.05);
  });

  it('with the expression from the beat (same), the left hand changes nothing', async () => {
    const { at } = await run(beats, (f) => leftHand(f, rise), { expression: 'same' });
    const up = samples(at, RISE.t0 + TAUGHT, RISE.t1);
    expect(Math.abs(up[up.length - 1] - up[0])).toBeLessThan(0.1);
  });

  it('the hands alone: the right hand beats, the named left hand shapes', async () => {
    // A right hand stroking steadily at 90 bpm (the hand conductor), the left rising.
    const strokes = (frames: BodyFrame[]): HandsFrame[] =>
      leftHand(frames, rise).map((f) => {
        const t = f.t ?? 0;
        const y = 300 - 60 * Math.abs(Math.sin((Math.PI * t * BPM) / 60));
        const right: Hand = { handedness: 'Right', keypoints: Array.from({ length: 21 }, () => ({ x: 200, y })), score: 1 };
        return { ...f, hands: [right, ...f.hands] };
      });
    const named = await run(beats, strokes, { source: 'hands', expressionHand: 'left' });
    expect(named.outs.some((o) => o.time.state === 'running')).toBe(true);
    const up = samples(named.at, RISE.t0 + TAUGHT, RISE.t1);
    expect(Math.min(...steps(up))).toBeGreaterThanOrEqual(-0.01);
    expect(up[up.length - 1] - up[0]).toBeGreaterThan(0.6 * SPAN);
    // Not named, the beating hand shapes: the left changes nothing.
    const auto = await run(beats, strokes, { source: 'hands', expressionHand: 'auto' });
    const flat = samples(auto.at, RISE.t0 + TAUGHT, RISE.t1);
    expect(Math.abs(flat[flat.length - 1] - flat[0])).toBeLessThan(0.1);
  });
});

describe.runIf(CONDUCTOR)('the split with the hands alone reads two hands (the hand count, #325)', () => {
  it('a hand conductor naming the other hand to shape asks the model for both hands, whatever the policy', () => {
    expect(conductorReadsTwoHands({ enabled: true, source: 'hands', hand: 'right', expressionHand: 'left' })).toBe(true);
    expect(conductorReadsTwoHands({ enabled: true, source: 'hands', hand: 'auto', expressionHand: 'left' })).toBe(true);
    expect(conductorReadsTwoHands({ enabled: true, source: 'hands', hand: 'right', expressionHand: 'right' })).toBe(false);
    expect(conductorReadsTwoHands({ enabled: true, source: 'hands', expressionHand: 'auto' })).toBe(false);
    expect(conductorReadsTwoHands({ enabled: true, source: 'hands', expressionHand: 'left', expression: 'body' })).toBe(false);
    expect(conductorReadsTwoHands({ enabled: true, source: 'body', expressionHand: 'left' })).toBe(false);
    expect(conductorReadsTwoHands({ enabled: false, source: 'hands', expressionHand: 'left' })).toBe(false);
    const oneHand = { oneHandReaders: 1, skeletonSeesAllHands: false } as const;
    expect(deriveHandCount([], { twoHandsRead: true }, oneHand)).toBe(2);
    expect(deriveHandCount([], { twoHandsRead: false }, oneHand)).toBe(1);
  });
});
