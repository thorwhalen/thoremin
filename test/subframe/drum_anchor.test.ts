/**
 * The air drum's tracked point (#246): the stick-tip estimate of
 * `src/nodes/music/drum_anchor.ts`, and the `air-drum` node replayed over a synthetic
 * hand gripping the committed `an.impacts` stick fixtures (`scripts/air/lib_synthetic_grip.ts`).
 *
 * What is pinned: the estimate is exact on the synthetic grip; it commutes with any
 * affine map of the image (so a stick foreshortened toward the camera comes in toward
 * the hand exactly as the real tip would); on a PURE WRIST STROKE (the hand and stick
 * turning about the wrist, the roll §7.3 of the research doc says the pose wrist misses)
 * the wrist sounds nothing while the stick tip and the index fingertip sound every
 * stroke, predicted ahead of the impact after the first; the stick tip lands within the
 * predictor's bound of the impact, while the index fingertip, off the stick's axis,
 * turns on its own arc and lands up to a few tens of milliseconds away; with the arm
 * carrying the stroke all three points find it; and the `stickLength` dial leaf
 * reaches the node live.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayNode } from '@/dag';
import { airDrumNode, type DrumHit } from '@/nodes';
import type { HandsFrame } from '@/nodes/domain';
import { DRUM_ANCHOR_POINTS, anchorPoint, gripFulcrum, gripHeel, gripLength, stickReach, stickTip } from '@/nodes/music/drum_anchor';
import { TRUE_STICK_LENGTH, gripFrames, parseStickClip, type StickPose } from '../../scripts/air/lib_synthetic_grip';
import { FIXTURES, loadRecords } from '../helpers/fixtures';

interface Truth {
  spec: { fps: number };
  events: { t_impact: number }[];
}

function load(name: string): { truth: Truth; poses: StickPose[] } {
  const dir = join(FIXTURES, name);
  return {
    truth: JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as Truth,
    poses: parseStickClip(readFileSync(join(dir, 'keypoints.ndjson'), 'utf8')),
  };
}

describe('the stick-tip estimate', () => {
  const { poses } = load('subframe_stick_air_30');

  it('is the true stick tip on the synthetic grip', () => {
    const frames = gripFrames(poses);
    for (const i of [0, 10, 40, 80]) {
      const tip = stickTip(frames[i].hands[0].keypoints, TRUE_STICK_LENGTH);
      expect(tip.x).toBeCloseTo(poses[i].tip.x, 6);
      expect(tip.y).toBeCloseTo(poses[i].tip.y, 6);
    }
  });

  it('commutes with an affine map of the image (foreshortening is a projection, not an error)', () => {
    const kp = gripFrames(poses)[25].hands[0].keypoints;
    // Squash along a diagonal and shift: what a stick tilted toward the camera looks like.
    const map = (p: { x: number; y: number }) => ({ x: 0.9 * p.x + 0.3 * p.y + 12, y: 0.1 * p.x + 0.4 * p.y - 7 });
    const mapped = kp.map(map);
    const a = map(stickTip(kp));
    const b = stickTip(mapped);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('extends the heel-to-fulcrum line by the stick length', () => {
    const kp = gripFrames(poses)[0].hands[0].keypoints;
    const f = gripFulcrum(kp);
    const h = gripHeel(kp);
    const g = Math.hypot(f.x - h.x, f.y - h.y);
    const tip = stickTip(kp, 2);
    expect(Math.hypot(tip.x - f.x, tip.y - f.y)).toBeCloseTo(2 * g, 6);
  });

  it('names every point, and refuses a hand without its landmarks', () => {
    const kp = gripFrames(poses)[0].hands[0].keypoints;
    for (const p of DRUM_ANCHOR_POINTS) expect(anchorPoint(kp, p)).toBeDefined();
    expect(anchorPoint(kp.slice(0, 5), 'stickTip')).toBeUndefined();
    expect(anchorPoint(kp.slice(0, 5), 'wrist')).toEqual({ x: kp[0].x, y: kp[0].y });
  });
});

async function play(name: string, point: (typeof DRUM_ANCHOR_POINTS)[number], arm: number, extra: Record<string, unknown> = {}) {
  const { truth, poses } = load(name);
  const fps = truth.spec.fps;
  const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, point, minLead: 0.03, ...extra }));
  const outs = await replayNode(h, { hands: gripFrames(poses, { arm }) }, { dt: 1 / fps });
  const hits = outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
  return { truth, fps, hits };
}

describe.each(['subframe_stick_air_30', 'subframe_stick_surface_30'])('air-drum on a gripped stick, %s', (name) => {
  it('a pure wrist stroke: the wrist sounds nothing', async () => {
    const { hits } = await play(name, 'wrist', 0);
    expect(hits).toHaveLength(0);
  });

  // The index fingertip is not on the stick's axis: it circles the wrist on a shorter,
  // rotated arc whose lowest point is not the tip's, so its bound is looser.
  it.each([
    ['stickTip', 0.025],
    ['indexTip', 0.05],
  ] as const)('a pure wrist stroke: the %s sounds every stroke, predicted after the first, within %s s', async (point, bound) => {
    const { truth, fps, hits } = await play(name, point, 0);
    expect(hits).toHaveLength(truth.events.length);
    for (const hit of hits.slice(1)) {
      expect(hit.predicted).toBe(true);
      const e = truth.events.reduce((b, x) => (Math.abs(x.t_impact - hit.t) < Math.abs(b.t_impact - hit.t) ? x : b));
      expect(Math.abs(hit.t - e.t_impact)).toBeLessThan(bound);
      expect(hit.tick / fps).toBeLessThan(e.t_impact);
    }
  });

  it('the arm carrying the stroke: every point finds every stroke', async () => {
    for (const point of DRUM_ANCHOR_POINTS) {
      const { truth, hits } = await play(name, point, 1);
      expect(hits, point).toHaveLength(truth.events.length);
    }
  });
});

describe('the stickLength leaf', () => {
  it('reaches the node live: a length change restarts the sticks, so the next hit is a ghost note', async () => {
    const { truth, poses } = load('subframe_stick_air_30');
    const frames = gripFrames(poses);
    const fps = truth.spec.fps;
    const run = async (lengthAt: (i: number) => number) => {
      const h = airDrumNode.make(airDrumNode.params.parse({ minLead: 0.03 }));
      const config = frames.map((_, i) => ({ enabled: true, point: 'stickTip', stickLength: lengthAt(i) }));
      const outs = await replayNode(h, { hands: frames, config }, { dt: 1 / fps });
      return outs.flatMap((o, i) => (o.hits as DrumHit[]).map((hit) => ({ ...hit, tick: i })));
    };
    // Switch between two strokes: halfway between the 4th and 5th impacts.
    const switchTick = Math.round(((truth.events[3].t_impact + truth.events[4].t_impact) / 2) * fps);
    const steady = await run(() => 3);
    const switched = await run((i) => (i < switchTick ? 3 : 2));
    expect(switched).toHaveLength(steady.length);
    const next = (hs: typeof steady) => hs.find((h) => h.tick >= switchTick)!;
    expect(next(steady).predicted).toBe(true);
    expect(next(switched).predicted).toBe(false);
  });
});

/** A hands stream shrunk by `k` about the frame's centre: the same player standing further back. */
const shrink = (frames: HandsFrame[], k: number): HandsFrame[] =>
  frames.map((f) => ({
    ...f,
    hands: f.hands.map((h) => ({ ...h, keypoints: h.keypoints.map((p) => ({ ...p, x: f.width / 2 + k * (p.x - f.width / 2), y: f.height / 2 + k * (p.y - f.height / 2) })) })),
  }));

describe('the default point on real and scaled hands (gates in reaches)', () => {
  const replay = async (frames: HandsFrame[], fps: number, params: Record<string, unknown>) => {
    let hits = 0;
    // Both mirror conventions: a third-person recording labels the hands either way.
    for (const mirrorHandedness of [true, false]) {
      const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, mirrorHandedness, ...params }));
      const outs = await replayNode(h, { hands: frames }, { dt: 1 / fps });
      hits += outs.flatMap((o) => o.hits as DrumHit[]).length;
    }
    return hits;
  };
  const recorded = (scenario: string) => {
    const recs = loadRecords(scenario, 'src.hands');
    return { frames: recs.map((r) => r.value as HandsFrame), fps: (recs.length - 1) / (recs[recs.length - 1].t - recs[0].t) };
  };

  it.each(['video_hand_open_close', 'video_hand_pinch', 'video_hand_sweep', 'two_hands', 'sweep_right'])('drums nothing on %s, close to the camera or far from it', async (scenario) => {
    const { frames, fps } = recorded(scenario);
    for (const k of [1, 0.5, 0.3]) expect(await replay(shrink(frames, k), fps, {}), `scale ${k}`).toBe(0);
  });

  it.each(['subframe_stick_air_30', 'subframe_stick_surface_30'])('sounds every pure wrist stroke of %s, close or far', async (name) => {
    const { truth, poses } = load(name);
    for (const k of [1, 0.5, 0.3]) {
      for (const stickLength of [2, 3, 4]) {
        const h = airDrumNode.make(airDrumNode.params.parse({ enabled: true, stickLength }));
        const outs = await replayNode(h, { hands: shrink(gripFrames(poses), k) }, { dt: 1 / truth.spec.fps });
        expect(outs.flatMap((o) => o.hits as DrumHit[]), `scale ${k}, length ${stickLength}`).toHaveLength(truth.events.length);
      }
    }
  });

  it.each(['conducting_44', 'conducting_34'])('drums on the beats of %s about as often as the wrist, close or far', async (scenario) => {
    const { frames, fps } = recorded(scenario);
    for (const k of [1, 0.6, 0.4]) {
      const s = shrink(frames, k);
      const stick = await replay(s, fps, {});
      const wrist = await replay(s, fps, { point: 'wrist' });
      expect(wrist, `scale ${k}`).toBeGreaterThan(0);
      expect(stick, `scale ${k}`).toBeGreaterThanOrEqual(0.8 * wrist);
    }
  });

  it('measures the reach in the image, so the gates follow the hand size and the stick', () => {
    const kp = gripFrames(load('subframe_stick_air_30').poses)[0].hands[0].keypoints;
    const small = kp.map((p) => ({ x: p.x / 2, y: p.y / 2 }));
    expect(gripLength(small)).toBeCloseTo(gripLength(kp) / 2, 9);
    expect(stickReach(kp, 3)).toBeCloseTo(4 * gripLength(kp), 9);
  });
});
