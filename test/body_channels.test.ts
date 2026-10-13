/**
 * Which body channel carries the beat, and at which level (#373, body-movement A1):
 * the measurement of `docs/research/body-conducting-and-pose-categories.md`, pinned.
 *
 * - The METHOD is checked on the synthetic control first: a skeleton whose bounce,
 *   steps and sway run at the beat, the half-bar and the bar of a known grid, with
 *   tracker-sized noise. If the measurement could not find those three levels there,
 *   no number it gives on a real clip would mean anything.
 * - The FINDINGS are pinned on the committed fixtures, with margins (the write-up's
 *   tables are `scripts/body/measure_channels.ts`; these are the claims the defaults
 *   rest on): a conductor's trunk marks the beat the conductor's hand gives (on the 4- and 2-pattern
 *   clips, not the slow 3-pattern one); the torso's rotation marks the bar; the dancer's
 *   stride marks the bar; and two levels at once give the conductor's meter but cannot by
 *   themselves tell a half-bar from a bar.
 *
 * Every lock is asserted by its Rayleigh p as well as its R, since R alone rewards a
 * channel that fires rarely.
 */
import { describe, it, expect } from 'vitest';
import { measureClip, bestCell, rayleighP, meterReading } from '../scripts/body/lib_channels';
import { loadClip, syntheticClip, type BodyClip } from '../scripts/body/lib_clips';

function cell(clip: BodyClip, channel: string, level: 'beat' | 'half-bar' | 'bar') {
  return bestCell(measureClip(clip.frames, clip.fps, clip.grid, clip.beatsPerBar, { channels: [channel], levels: [level] }), channel, level).score;
}

describe('the method, on the synthetic control (bounce at the beat, steps at the half-bar, sway at the bar)', () => {
  const clip = syntheticClip();

  it('finds the bounce at the beat, in the trunk and the head', () => {
    for (const ch of ['com.y', 'hips.y', 'head.y']) {
      const s = cell(clip, ch, 'beat');
      expect(s.r, ch).toBeGreaterThan(0.95);
      expect(s.p, ch).toBeLessThan(1e-6);
      expect(s.f, ch).toBeGreaterThan(0.9);
    }
  });

  it('finds the steps at the half-bar and the sway at the bar, and not the other way round', () => {
    expect(cell(clip, 'stride', 'half-bar').r).toBeGreaterThan(0.9);
    expect(cell(clip, 'sway.x', 'bar').r).toBeGreaterThan(0.9);
    // A channel at the beat spreads evenly over the bar's four beats: no bar lock.
    expect(cell(clip, 'com.y', 'bar').r).toBeLessThan(0.4);
  });
});

describe('a conductor: the trunk marks the beat the conductor's baton hand gives', () => {
  // The grid is the conductor's own right-wrist strokes (the clips' choir is legato and
  // carries no beat), so the wrist is the reference here, not a finding.
  for (const name of ['video_body_conducting_44', 'video_body_conducting_24']) {
    it(`${name}: the trunk centroid's height locks to the beat`, () => {
      const clip = loadClip(name);
      expect(clip.referenceWrist).toBe('right');
      const s = cell(clip, 'com.y', 'beat');
      expect(s.r).toBeGreaterThan(0.5);
      expect(s.p).toBeLessThan(1e-3);
    });
  }

  it('the torso rotation locks at the bar of the 2-pattern', () => {
    const s = cell(loadClip('video_body_conducting_24'), 'torso.yaw', 'bar');
    expect(s.r).toBeGreaterThan(0.35);
    expect(s.p).toBeLessThan(1e-2);
  });
});

describe('two levels at once: the meter as the ratio of a lateral period to a vertical one', () => {
  const ratio = (clip: BodyClip) => {
    const beatS = (clip.grid[clip.grid.length - 1] - clip.grid[0]) / (clip.grid.length - 1);
    return meterReading(clip.frames, clip.fps, beatS);
  };

  it('reads 4 and 2 from the conductors, as torso rotation over the trunk bob', () => {
    const four = ratio(loadClip('video_body_conducting_44'));
    const two = ratio(loadClip('video_body_conducting_24'));
    expect(four.barChannel).toBe('torso.yaw');
    expect(Math.round(four.ratio)).toBe(4);
    expect(two.barChannel).toBe('torso.yaw');
    expect(Math.round(two.ratio)).toBe(2);
  });

  it('cannot tell a half-bar from a bar by itself: the synthetic 4-beat bar reads 2 (the stride wins over the sway)', () => {
    const m = ratio(syntheticClip());
    expect(m.barChannel).toBe('stride');
    expect(Math.round(m.ratio)).toBe(2);
  });

  it('finds no beat-level vertical on either dancer, so no ratio at all', () => {
    for (const name of ['video_body_que_calor', 'video_body_budots']) expect(Number.isFinite(ratio(loadClip(name)).ratio), name).toBe(false);
  });
});

describe('a dancer (Que Calor): the stride carries the bar, the head and hips do not carry the beat', () => {
  const clip = loadClip('video_body_que_calor');

  it('the stride is phase-locked at the bar', () => {
    expect(cell(clip, 'stride', 'bar').r).toBeGreaterThan(0.6);
  });

  it('the head and the hips are not locked at the beat (#339 item 3)', () => {
    for (const ch of ['head.y', 'hips.y']) expect(cell(clip, ch, 'beat').p, ch).toBeGreaterThan(1e-2);
  });
});

describe('rayleighP', () => {
  it('is near 1 for a uniform spread and tiny for a tight cluster', () => {
    expect(rayleighP(0.05, 40)).toBeGreaterThan(0.8);
    expect(rayleighP(0.9, 20)).toBeLessThan(1e-6);
    expect(rayleighP(1, 1)).toBe(1);
  });
});
