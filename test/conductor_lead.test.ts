/**
 * The body conductor's lead offset (#427) on A1's conductor fixtures, and the node's path.
 *
 * The grid of a conductor clip IS the beating wrist's strokes (A1), the stand-in for the
 * click a player conducts against. What the fixtures say (`scripts/body/measure_lead_offset.ts`
 * prints the table; the research doc §5.2):
 *
 * - The correction does what it says: the 4-pattern trunk's own lag subtracted from it
 *   lands the trunk-alone follower within ±20 ms of the grid (the issue's check), on the
 *   take it was measured on.
 * - But the take does not KEEP the trunk on any clip: on the 4-pattern its lag moved
 *   between the take's halves (`drift`), on the 3- and 2-pattern it does not keep the
 *   beat (`lock`). Kept on the 4-pattern's first half, it moved the second half by as much
 *   as it corrected (3 ms became -84 ms) before the gates.
 * - What the take keeps never moves its own joint further from the grid in-sample, and
 *   never moves a held-out half more than 15 ms further (the gates' purpose; the take's
 *   followers mirror the live one, a prior setting each detector's period).
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
const CLIPS = [C44, 'video_body_conducting_34', 'video_body_conducting_24'];

function whole(name: string) {
  const clip = loadClip(name);
  const dur = clip.frames.length / clip.fps;
  return { clip, dur, cal: calibrate(clip, 0, dur) };
}

describe('the lead offset on the conductor clips', () => {
  // The subtraction itself, with the lag the take measured but did not keep (below): the
  // issue's check, met in-sample only.
  it("the 4-pattern trunk: its measured lag, subtracted, lands it on the grid (within 20 ms)", () => {
    const { clip, dur, cal } = whole(C44);
    const lag = cal.lags.trunk.lagS;
    expect(lag).toBeGreaterThan(0.03);
    const before = scoreLevel(followAnchors(clip, ['trunk']), clip.grid, 1, [[0, dur]]);
    const after = scoreLevel(followAnchors(clip, ['trunk'], { trunk: lag }), clip.grid, 1, [[0, dur]]);
    expect(before.lagS).toBeGreaterThan(0.03);
    expect(Math.abs(after.lagS)).toBeLessThanOrEqual(0.02);
  });

  it('...but the take keeps no trunk offset on any clip: it drifts on the 4-pattern, does not lock on the others', () => {
    expect(whole(C44).cal.refused.trunk).toBe('drift');
    for (const name of CLIPS.slice(1)) expect(whole(name).cal.refused.trunk).toBe('lock');
  });

  it('the wrist (the reference) is kept, and needs under 15 ms on every clip', () => {
    for (const name of CLIPS) expect(Math.abs(whole(name).cal.offsets.wrist)).toBeLessThan(0.015);
  });

  it('what the whole take keeps never moves its own joint further from the grid (in-sample)', () => {
    for (const name of CLIPS) {
      const { clip, dur, cal } = whole(name);
      for (const joint of Object.keys(cal.offsets)) {
        const before = scoreLevel(followAnchors(clip, [joint]), clip.grid, 1, [[0, dur]]);
        const after = scoreLevel(followAnchors(clip, [joint], cal.offsets), clip.grid, 1, [[0, dur]]);
        expect(Math.abs(after.lagS), `${name} ${joint}`).toBeLessThanOrEqual(Math.abs(before.lagS) + 0.002);
      }
    }
  });

  it('what a half keeps never moves the other half more than 15 ms further from the grid', () => {
    for (const name of CLIPS) {
      const clip = loadClip(name);
      const dur = clip.frames.length / clip.fps;
      const h = dur / 2;
      for (const [cal, test] of [
        [[0, h], [h, dur]],
        [[h, dur], [0, h]],
      ] as const) {
        const offsets = calibrate(clip, cal[0], cal[1]).offsets;
        for (const joint of Object.keys(offsets)) {
          const before = scoreLevel(followAnchors(clip, [joint]), clip.grid, 1, [[test[0], test[1]]]);
          const after = scoreLevel(followAnchors(clip, [joint], offsets), clip.grid, 1, [[test[0], test[1]]]);
          expect(Math.abs(after.lagS) - Math.abs(before.lagS), `${name} ${joint}`).toBeLessThan(0.015);
        }
      }
    }
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
