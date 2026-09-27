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
import { DRUM_ANCHOR_POINTS, anchorPoint, gripFulcrum, gripHeel, stickTip } from '@/nodes/music/drum_anchor';
import { TRUE_STICK_LENGTH, gripFrames, parseStickClip, type StickPose } from '../../scripts/air/lib_synthetic_grip';
import { FIXTURES } from '../helpers/fixtures';

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
