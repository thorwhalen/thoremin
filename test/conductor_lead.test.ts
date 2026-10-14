/**
 * The body conductor's lead offset (#427) on A1's conductor fixtures, and the take that
 * learns it.
 *
 * The grid of a conductor clip IS the beating wrist's strokes (A1), the stand-in for the
 * click a player conducts against. The claims: a calibration over the clip learns the
 * trunk's lag where the trunk keeps the beat (the 4-pattern clip) and refuses it where it
 * does not (the 3- and 2-pattern clips); with the learned offset, the follower with the
 * trunk alone followed lands its anchors within ±20 ms of the grid (the issue's check),
 * and so does the conductor node's beat; and the learned lag does NOT carry from one half
 * of the 4-pattern clip to the other (pinned, so a change that makes it carry, or a claim
 * that it does, is noticed: `scripts/body/measure_lead_offset.ts` prints the table).
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { conductorNode } from '@/nodes';
import { loadClip } from '../scripts/body/lib_clips';
import { scoreLevel } from '../scripts/body/lib_channels';
import { calibrate, followAnchors } from '../scripts/body/lib_impact';
import { conduct } from './helpers/body_conduct';

const FPS = 30;
const C44 = 'video_body_conducting_44';

function whole(name: string) {
  const clip = loadClip(name);
  const dur = clip.frames.length / clip.fps;
  return { clip, dur, cal: calibrate(clip, 0, dur) };
}

describe('the trunk lead offset on the conductor clips', () => {
  it('the 4-pattern clip: the trunk lags the hand, and the correction lands it on the grid (within 20 ms)', () => {
    const { clip, dur, cal } = whole(C44);
    expect(cal.offsets.trunk).toBeGreaterThan(0.03);
    const before = scoreLevel(followAnchors(clip, ['trunk']), clip.grid, 1, [[0, dur]]);
    const after = scoreLevel(followAnchors(clip, ['trunk'], cal.offsets), clip.grid, 1, [[0, dur]]);
    expect(before.lagS).toBeGreaterThan(0.03);
    expect(Math.abs(after.lagS)).toBeLessThanOrEqual(0.02);
  });

  it.each(['video_body_conducting_34', 'video_body_conducting_24'])('%s: the trunk does not keep the beat, so it gets no offset', (name) => {
    expect(whole(name).cal.offsets.trunk).toBeUndefined();
  });

  it('the wrist (the reference) needs almost none: under 15 ms on every clip', () => {
    for (const name of [C44, 'video_body_conducting_34', 'video_body_conducting_24']) expect(Math.abs(whole(name).cal.offsets.wrist)).toBeLessThan(0.015);
  });

  it("the trunk's lag does not carry across the 4-pattern clip's halves (more than 20 ms off, held out)", () => {
    const clip = loadClip(C44);
    const dur = clip.frames.length / clip.fps;
    const h = dur / 2;
    const first = calibrate(clip, 0, h);
    const after = scoreLevel(followAnchors(clip, ['trunk'], first.offsets), clip.grid, 1, [[h, dur]]);
    expect(Math.abs(after.lagS)).toBeGreaterThan(0.02);
  });
});

describe('the conductor node with the offsets (scripted strokes)', () => {
  // The trunk alone does not phase-lock the NODE's beat to this clip's grid well enough to
  // read a 50 ms shift off it (R 0.1), so the node's path is pinned on scripted strokes,
  // whose every ictus is known: an offset moves the beat by the offset, either way.
  const BPM = 90;
  const sc = conduct([{ kind: 'rest', s: 1 }, { kind: 'ready', s: 1.5 }, { kind: 'upbeat', s: 0.6 }, { kind: 'beat', bpm: BPM, beats: 24 }], { fps: FPS });
  const params = conductorNode.params.parse({ enabled: true, source: 'body', bodyPoint: 'wrist', hand: 'right', transport: { rules: false }, mirrorX: false, mirrorHandedness: false });
  /** The beat's mean lag behind the strokes over the last 12 (seconds; circular). */
  async function lag(leadOffsets?: Record<string, number>): Promise<number> {
    const h = conductorNode.make(params);
    const outs = await replayNode(h, { body: sc.frames, ...(leadOffsets ? { leadOffsets: sc.frames.map(() => leadOffsets) } : {}) }, { dt: 1 / FPS });
    const cross: number[] = [];
    let prev = 0;
    outs.forEach((o, i) => {
      const b = o.beat as number;
      if (Math.floor(b) > Math.floor(prev)) cross.push(i / FPS);
      prev = b;
    });
    const from = sc.ictus[sc.ictus.length - 12];
    return scoreLevel(cross, sc.ictus, 1, [[from, sc.seconds]]).lagS;
  }

  it('a late joint: its beat moves earlier by the offset (within a frame)', async () => {
    const base = await lag();
    const late = base - (await lag({ wrist: 0.08 }));
    expect(Math.abs(late - 0.08)).toBeLessThan(1 / FPS);
  });

  it('an early joint: its anchor is held until its corrected time, and the beat moves later', async () => {
    const base = await lag();
    const early = (await lag({ wrist: -0.08 })) - base;
    expect(Math.abs(early - 0.08)).toBeLessThan(1 / FPS);
  });

  it('no offsets, or an offset for a joint not followed: the same beat as before', async () => {
    const base = await lag();
    expect(await lag({})).toBe(base);
    expect(await lag({ trunk: 0.1 })).toBe(base);
  });
});
