/**
 * The body's impact detector replayed on A1's body fixtures (#374, body-movement A2),
 * through the follower, scored at the beat against each clip's grid with A1's scorer.
 * The full table is `npx vite-node scripts/body/score_impact.ts`; these are the claims
 * the defaults rest on, with margins.
 *
 * On the conductor clips the grid IS the beating wrist's strokes (A1), so the default
 * detector reading that wrist scores against its own reference; the body's own finding
 * is the row without the wrist: the trunk and the elbow lock to the hand's beat on the 4-
 * and 2-pattern clips (Rayleigh p below 10^-3), and the trunk alone does not on the slow
 * 3-pattern hymn, as A1 measured offline. No dancer locks at the beat (A1 §4.4).
 */
import { describe, it, expect } from 'vitest';
import { createImpactDetector, type ImpactDetectorOptions } from '@thoremin/ictus';
import { loadClip } from '../scripts/body/lib_clips';
import { clipFrames, replayAnchors, scoreBeat } from '../scripts/body/lib_impact';

function beat(name: string, options: ImpactDetectorOptions = {}) {
  const clip = loadClip(name);
  return scoreBeat(clip, replayAnchors(clipFrames(clip), createImpactDetector(options)));
}

describe('the impact detector on the conductor clips', () => {
  it.each([
    ['video_body_conducting_44', 0.9],
    ['video_body_conducting_34', 0.75],
    ['video_body_conducting_24', 0.9],
  ] as const)('%s: the default set marks the beat (F >= %s)', (name, f) => {
    const s = beat(name);
    expect(s.f).toBeGreaterThanOrEqual(f);
    expect(s.p).toBeLessThan(1e-3);
  });

  it.each(['video_body_conducting_44', 'video_body_conducting_24'])("%s: without the wrist, the body's own joints lock to the hand's beat", (name) => {
    const s = beat(name, { joints: ['trunk', 'elbow'] });
    expect(s.r).toBeGreaterThan(0.5);
    expect(s.p).toBeLessThan(1e-3);
  });

  it('the slow 3-pattern: the trunk alone does not lock (A1: R 0.35, p 0.08)', () => {
    expect(beat('video_body_conducting_34', { joints: ['trunk'] }).p).toBeGreaterThan(0.01);
  });
});

describe('the impact detector on the dancers', () => {
  it.each(['video_body_budots', 'video_body_que_calor'])('%s: nothing locks at the beat', (name) => {
    expect(beat(name).p).toBeGreaterThan(0.01);
  });
});
