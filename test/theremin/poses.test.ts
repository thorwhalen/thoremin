/**
 * The codified theremin positions (`lib/poses.ts`), the hand's shape they are read from
 * (`lib/hand_pose.ts`) and the pose snap (`lib/pose_snap.ts`): the library holds what the sources
 * say (Eyck's positions are the major scale's degrees, Rockmore's one scale step each), the
 * classifier names a position from the hand's shape, and the snap keeps the interval between two
 * held positions to the codified one, `strength` 0 the raw physics, without jumps and without
 * touching what the hand does inside a position (a glide, a vibrato).
 */
import { describe, expect, it } from 'vitest';
import type { Hand } from '@thoremin/sdk/nodes/domain';
import { POSE_FEATURE_IDS, poseFeatures } from '@/slices/theremin/lib/hand_pose';
import { classifyPose, POSE_LIBRARY, POSE_REJECT_SPREADS, posesOf, type Pose } from '@/slices/theremin/lib/poses';
import { createPoseSnap, positionPitch, scaleStepsAbove } from '@/slices/theremin/lib/pose_snap';
import { createAssistChain } from '@/slices/theremin/lib/assist';
import { testHand } from '../helpers/theremin_hand';

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const eyck = (n: number): Pose => posesOf('eyck').find((p) => p.id === `eyck.fp${n}`)!;
const rock = (id: string): Pose => posesOf('rockmore').find((p) => p.id === `rockmore.${id}`)!;
const FPS = 30;

describe('the hand shape', () => {
  const hand = (curl: number) => testHand({ cx: 320, cy: 240, pxPerM: 2000, curl: { index: curl, middle: curl, ring: curl, pinky: curl } });

  it('reads a straight finger as open and a curled one as closed', () => {
    const open = poseFeatures(hand(0))!;
    const fist = poseFeatures(hand(1))!;
    for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
      expect(open.open[f], f).toBeGreaterThan(0.8);
      expect(fist.open[f], f).toBeLessThan(0.1);
    }
    expect(poseFeatures(hand(0.5))!.open.middle).toBeGreaterThan(fist.open.middle);
    expect(poseFeatures(hand(0.5))!.open.middle).toBeLessThan(open.open.middle);
  });

  it('is the same for a mirrored image and for either hand label (the shape, not the side)', () => {
    const h = hand(0.4);
    const mirror = (k: { x: number; y: number; z?: number }) => ({ ...k, x: -k.x });
    const flipped: Hand = { ...h, handedness: 'Left', keypoints: h.keypoints.map((k) => ({ ...k, x: 640 - k.x })), worldKeypoints: h.worldKeypoints!.map(mirror) };
    const a = poseFeatures(h)!;
    const b = poseFeatures(flipped)!;
    expect(b.roll).toBeCloseTo(a.roll, 9);
    expect(b.ring).toBeCloseTo(a.ring, 9);
    for (const f of ['index', 'middle', 'ring', 'pinky'] as const) expect(b.open[f]).toBeCloseTo(a.open[f], 9);
  });

  it('measures the turn: the knuckle line flat reads 0, on its edge 90', () => {
    const h = hand(0.3);
    expect(poseFeatures(h)!.roll).toBeLessThan(5);
    const onEdge: Hand = { ...h, worldKeypoints: h.worldKeypoints!.map((k) => ({ x: -k.y, y: k.x, z: k.z })) };
    expect(poseFeatures(onEdge)!.roll).toBeGreaterThan(85);
  });

  it('falls back to the image without world landmarks, and gives nothing without all 21', () => {
    const h = hand(0);
    expect(poseFeatures({ ...h, worldKeypoints: undefined })!.open.middle).toBeGreaterThan(0.8);
    expect(poseFeatures({ ...h, worldKeypoints: undefined, keypoints: h.keypoints.slice(0, 20) })).toBeNull();
  });
});

describe('the pose library', () => {
  it("holds Eyck's eight positions on the major scale, FP1 to FP8 an octave, each with its sources", () => {
    expect(posesOf('eyck').map((p) => ('semitones' in p.interval ? p.interval.semitones : NaN))).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
    expect(posesOf('rockmore').map((p) => p.label)).toEqual(['Position 1', 'Half position', 'Position 2', 'Position 3', 'Position 4']);
    const ids = Object.values(POSE_LIBRARY.systems).flatMap((s) => s!.poses.map((p) => p.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of Object.values(POSE_LIBRARY.systems).flatMap((s) => s!.poses)) {
      expect(p.refs.length, p.id).toBeGreaterThan(0);
      expect(p.prototype).toHaveLength(POSE_FEATURE_IDS.length);
    }
  });

  it("Eyck's shapes are measured on her videos (only the numbers are kept), Rockmore's read from her method", () => {
    for (const p of posesOf('eyck')) {
      expect(p.measured?.frames, p.id).toBeGreaterThan(100);
      expect(p.measured!.videos.length, p.id).toBeGreaterThan(0);
    }
    for (const p of posesOf('rockmore')) expect(p.measured).toBeNull();
    // The measured direction: the hand turns from FP1 to FP5 (roll up), the fingers open from FP5 to FP8.
    const roll = (n: number) => eyck(n).prototype[POSE_FEATURE_IDS.indexOf('roll')]!;
    const middle = (n: number) => eyck(n).prototype[POSE_FEATURE_IDS.indexOf('open.middle')]!;
    expect(roll(5) - roll(1)).toBeGreaterThan(30);
    expect(middle(8) - middle(5)).toBeGreaterThan(0.3);
  });

  it('names the position at its prototype, surely, and none far from all of them', () => {
    for (const system of ['eyck', 'rockmore'] as const)
      for (const p of posesOf(system)) {
        const r = classifyPose(p.prototype, system);
        expect(r.pose?.id, p.id).toBe(p.id);
        expect(r.confidence, p.id).toBeGreaterThan(0.5);
      }
    const far = classifyPose(eyck(8).prototype.map((x, i) => x + (POSE_REJECT_SPREADS + 1) * 3 * eyck(8).spread[i]!), 'eyck');
    expect(far.pose).toBeNull();
  });

  it("keeps FP1 for a fist whose curled fingers read a little open (FP1's measured spread is 0)", () => {
    const fist = [...eyck(1).prototype];
    for (const f of ['open.middle', 'open.ring', 'open.pinky']) fist[POSE_FEATURE_IDS.indexOf(f as (typeof POSE_FEATURE_IDS)[number])] = 0.1;
    expect(classifyPose(fist, 'eyck').pose?.id).toBe('eyck.fp1');
  });
});

describe('the pose snap', () => {
  type Snap = ReturnType<typeof createPoseSnap>;
  interface Opts { strength?: number; wrist?: { x: number; y: number }; confidence?: number; scale?: number[] }
  const frame = (snap: Snap, pose: Pose | null, pitch: number, { strength = 1, wrist = { x: 0, y: 0 }, confidence = 1, scale = C_MAJOR }: Opts = {}) =>
    snap.step({ pitch, dt: 1 / FPS, pose, confidence, wrist, palm: 100, strength, pitchClasses: scale });
  /** Hold `pose` at `pitch` for `s` seconds; every output. */
  const hold = (snap: Snap, pose: Pose | null, pitch: number, s: number, o: Opts = {}) => Array.from({ length: Math.round(s * FPS) }, () => frame(snap, pose, pitch, o).pitch);
  const last = <T,>(xs: T[]) => xs[xs.length - 1]!;
  const maxStep = (xs: number[]) => Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i]!)));

  it("pulls the interval between two held positions to the codified one; 0 is the raw field", () => {
    // FP1 sounds 60.3 here; FP8 at the same place sounds only 65 in the field (a real hand's
    // fist-to-palm span is about five semitones). Eyck tunes it to be the octave: 72.3.
    for (const [strength, want] of [[0, 65], [0.5, 68.65], [1, 72.3]] as const) {
      const snap = createPoseSnap();
      hold(snap, eyck(1), 60.3, 0.5, { strength });
      expect(last(hold(snap, eyck(8), 65, 1.5, { strength }))).toBeCloseTo(want, 2);
    }
  });

  it('passes what the hand does inside a position: a glide is heard as played, from the snapped pitch', () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    hold(snap, eyck(8), 65, 1);
    // Still FP8, the arm drifting a third of a palm closer: the field rises 3 semitones, so does the output.
    const out = Array.from({ length: FPS }, (_, i) => frame(snap, eyck(8), 65 + (3 * (i + 1)) / FPS, { wrist: { x: i, y: 0 } }).pitch);
    expect(last(out)).toBeCloseTo(75, 1);
    expect(maxStep(out)).toBeLessThan(0.2);
  });

  it('never jumps: taking, losing or flickering a position glides', () => {
    const snap = createPoseSnap();
    // What the snap adds to the field, frame by frame: it must change smoothly.
    const added: number[] = [];
    const run = (pose: Pose | null, pitch: number, s: number, o: Opts = {}) => {
      for (const x of hold(snap, pose, pitch, s, o)) added.push(x - pitch);
    };
    run(eyck(1), 60.3, 0.5);
    run(eyck(8), 65, 1.5);
    // A frame of doubt, then a frame of FP7 (its neighbour): nothing changes.
    run(eyck(8), 65, 1 / FPS, { confidence: 0.1 });
    run(eyck(7), 65, 1 / FPS);
    run(eyck(8), 65, 0.3);
    expect(last(added)).toBeCloseTo(7.3, 2);
    // Lost for good: back to the field, gliding.
    run(null, 65, 2);
    expect(last(added)).toBeCloseTo(0, 2);
    // 7.3 semitones taken and let go over a fade of 0.15 s: no frame moves more than a quarter of it.
    expect(maxStep(added)).toBeLessThan(0.25 * 7.3);
  });

  it("the classifier's confidence decides whether, never how much: a reading between 0.5 and 0.9 does not warble", () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60.3, 0.5);
    hold(snap, eyck(8), 65, 2);
    const out = Array.from({ length: FPS }, (_, i) => frame(snap, eyck(8), 65, { confidence: i % 2 ? 0.5 : 0.9 }).pitch);
    expect(Math.max(...out) - Math.min(...out)).toBeLessThan(1e-3);
    // Held FP8 survives a reading of 0.35 (the hold threshold), not taken at it from nothing.
    expect(last(hold(snap, eyck(8), 65, 0.5, { confidence: 0.35 }))).toBeCloseTo(72.3, 2);
    const fresh = createPoseSnap();
    hold(fresh, eyck(1), 60.3, 0.5, { confidence: 0.35 });
    expect(fresh.step({ pitch: 60.3, dt: 1 / FPS, pose: eyck(1), confidence: 0.35, wrist: { x: 0, y: 0 }, palm: 100, strength: 1, pitchClasses: C_MAJOR }).pose).toBeNull();
  });

  it('a position read for less than the dwell, or unsurely, pulls nothing', () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    expect(frame(snap, eyck(8), 64).pitch).toBe(64);
    expect(last(hold(snap, eyck(8), 64, 1, { confidence: 0.1 }))).toBeCloseTo(64, 6);
  });

  it('a quick arm move while the position is held re-anchors there, without a jump', () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    hold(snap, eyck(8), 65, 1);
    // FP8 still, the wrist two palm lengths away in a quarter second, the field from 65 to 69.
    const out = Array.from({ length: 8 }, (_, i) => frame(snap, eyck(8), 65 + (4 * (i + 1)) / 8, { wrist: { x: 25 * (i + 1), y: 0 } }).pitch);
    expect(last(out)).toBeCloseTo(76, 1);
    expect(maxStep(out)).toBeLessThan(1);
    // Played there a moment (the anchor settles on the new place), then FP5: the new place's
    // position 1 is FP8's pitch there less the octave, so FP5 is pulled to 76 - 12 + 7.
    hold(snap, eyck(8), 69, 8, { wrist: { x: 200, y: 0 } });
    expect(last(hold(snap, eyck(5), 68, 1.5, { wrist: { x: 200, y: 0 } }))).toBeCloseTo(71, 1);
  });

  it('an arm move with a change of shape is a new place: the next position anchors afresh', () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    expect(last(hold(snap, eyck(5), 70, 1.5, { wrist: { x: 200, y: 0 } }))).toBeCloseTo(70, 3);
    expect(last(hold(snap, eyck(8), 72, 1.5, { wrist: { x: 200, y: 0 } }))).toBeCloseTo(75, 3);
  });

  it("a slow slide at one position moves the anchor; another position's pull is not undone by holding it", () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    expect(last(hold(snap, eyck(8), 65, 4))).toBeCloseTo(72, 3);
    // Back at FP1 (pulled back to 60), slid slowly to 61 over 4 s: FP8 is now 73.
    hold(snap, eyck(1), 60, 0.5);
    for (let i = 0; i < 4 * FPS; i++) frame(snap, eyck(1), 60 + (i + 1) / (4 * FPS));
    hold(snap, eyck(1), 61, 8);
    expect(last(hold(snap, eyck(8), 66, 1.5))).toBeCloseTo(73, 1);
  });

  it("Rockmore's positions are scale steps, kept as intervals: an anchor 0.4 above C puts position 2 0.4 above D", () => {
    expect(scaleStepsAbove(60, 3, C_MAJOR)).toBe(65);
    expect(scaleStepsAbove(65, -3, C_MAJOR)).toBe(60);
    expect(positionPitch(60, rock('p4'), C_MAJOR)).toBe(65);
    expect(positionPitch(60, rock('p_half'), C_MAJOR)).toBe(61);
    expect(positionPitch(60.4, rock('p2'), C_MAJOR)).toBeCloseTo(62.4, 9);
    expect(positionPitch(60.4, rock('p_half'), C_MAJOR)).toBeCloseTo(61.4, 9);
    const snap = createPoseSnap();
    hold(snap, rock('p1'), 60.4, 0.5);
    expect(last(hold(snap, rock('p2'), 61.9, 1.5))).toBeCloseTo(62.4, 3);
    expect(last(hold(snap, rock('p3'), 62.5, 1.5))).toBeCloseTo(64.4, 3);
  });

  it("a position the tracker often mistakes (FP6, measured) is shown but played unpulled, and the next trusted one is pulled again", () => {
    expect(eyck(6).measured!.precision!).toBeLessThan(0.7);
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    expect(last(hold(snap, eyck(6), 64, 1.5))).toBeCloseTo(64, 2);
    const six = snap.step({ pitch: 64, dt: 1 / FPS, pose: eyck(6), confidence: 1, wrist: { x: 0, y: 0 }, palm: 100, strength: 1, pitchClasses: C_MAJOR });
    expect(six.pose?.id).toBe('eyck.fp6');
    expect(six.target).toBeNull();
    // FP7 after it: the anchor is still FP1's, so FP7 is 60 + 11.
    expect(last(hold(snap, eyck(7), 64.5, 1.5))).toBeCloseTo(71, 2);
  });

  it('switching the technique starts over: the snap is reset', () => {
    const snap = createPoseSnap();
    hold(snap, eyck(1), 60, 0.5);
    snap.reset();
    expect(last(hold(snap, rock('p2'), 63, 1))).toBeCloseTo(63, 6);
  });

  for (const [name, stages] of [
    ['with the vibrato aid', { snap: 'chromatic' as const, correction: 0, smoothing: 0, vibratoAid: 1 }],
    ['at assistance 0 (pass-through)', { snap: 'chromatic' as const, correction: 0, smoothing: 0, vibratoAid: 0 }],
  ] as const)
    it(`on the assist chain's centre, ${name}: a vibrato survives the pull, as deep as played`, () => {
      const chain = createAssistChain();
      const snap = createPoseSnap();
      let pose = eyck(1);
      let base = 60;
      const out: number[] = [];
      for (let i = 0; i < 180; i++) {
        if (i === 60) {
          pose = eyck(8);
          base = 65;
        }
        const wobble = 0.4 * Math.sin((2 * Math.PI * 6 * i) / FPS);
        const r = chain.step(base + wobble, 1 / FPS, stages, C_MAJOR, (p, dt) => snap.step({ pitch: p, dt, pose, confidence: 1, wrist: { x: 0, y: 0 }, palm: 100, strength: 1, pitchClasses: C_MAJOR }).pitch);
        out.push(r.pitch);
      }
      const tail = out.slice(150);
      const mean = tail.reduce((a, x) => a + x, 0) / tail.length;
      expect(mean).toBeGreaterThan(71.5);
      expect(mean).toBeLessThan(72.5);
      expect(Math.max(...tail) - Math.min(...tail)).toBeGreaterThan(0.7);
    });
});
