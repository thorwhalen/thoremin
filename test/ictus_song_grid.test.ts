/**
 * The song's beat grid (#186 PR G): the hand-rolled flux + ACF + comb tracker in
 * `@thoremin/ictus`, on synthetic click tracks generated at test time (research map §7:
 * exact tempo, exact phase, optional hi-hat eighths and swing), and the song's musical
 * time read off the grid.
 */
import { describe, expect, it } from 'vitest';
import { beatIndexAt, songTimeAt, songTimeOfBeat, trackSongGrid, EMPTY_SONG_GRID, type SongGrid } from '@thoremin/ictus';
import { renderClickTrack, SR } from './helpers/clicks';
import { seeded } from './helpers/random';

/** The fraction of `truth` beats with a tracked beat within `tol` seconds. */
function hitRate(beats: readonly number[], truth: readonly number[], tol: number): number {
  let hits = 0;
  for (const t of truth) if (beats.some((b) => Math.abs(b - t) <= tol)) hits++;
  return hits / truth.length;
}

describe('trackSongGrid on synthetic click tracks', () => {
  const cases = [
    { name: '129.2 bpm (Que Calor)', bpm: 129.2, offset: 0.31 },
    { name: '90 bpm', bpm: 90, offset: 0.05 },
    { name: '120 bpm with hi-hat eighths', bpm: 120, offset: 0.2, hats: true },
    { name: '100 bpm, swung hi-hats', bpm: 100, offset: 0.4, hats: true, swing: 0.62 },
    { name: '150 bpm', bpm: 150, offset: 0.12 },
    { name: '110 bpm, swung hi-hats as loud as the kick', bpm: 110, offset: 0.25, hats: true, swing: 0.62, hatLevel: 1.6 },
  ];
  for (const c of cases) {
    it(`${c.name}: the tempo within 0.2 bpm and 95 % of beats within 50 ms`, () => {
      const { samples, beats: truth } = renderClickTrack({ bpm: c.bpm, seconds: 30, offset: c.offset, hats: c.hats, swing: c.swing, hatLevel: c.hatLevel });
      const g = trackSongGrid(samples, { sampleRate: SR });
      expect(Math.abs(g.bpm - c.bpm)).toBeLessThan(0.2);
      expect(hitRate(g.beats, truth.slice(1, -1), 0.05)).toBeGreaterThan(0.95);
      expect(g.confidence).toBeGreaterThan(0.3);
      expect(g.downbeats).toEqual([]);
      expect(g.phaseS).toBeGreaterThanOrEqual(0);
      expect(g.phaseS).toBeLessThan(g.periodS);
    });
  }

  it('white noise has no beat: the empty grid, not a faint one', () => {
    const rnd = seeded(3);
    const noise = Float32Array.from({ length: SR * 20 }, () => rnd() - 0.5);
    expect(trackSongGrid(noise, { sampleRate: SR })).toEqual(EMPTY_SONG_GRID);
  });

  it('silence and a too-short buffer give the empty grid, never a zero tempo', () => {
    expect(trackSongGrid(new Float32Array(SR * 10), { sampleRate: SR })).toEqual(EMPTY_SONG_GRID);
    expect(trackSongGrid(new Float32Array(100), { sampleRate: SR })).toEqual(EMPTY_SONG_GRID);
    expect(trackSongGrid(new Float32Array(0), { sampleRate: SR }).beats).toEqual([]);
  });

  it('keeps the tracked beats of a drifting song, not only the line', () => {
    // 120 bpm drifting to 124 over 30 s: the line is a compromise, the beats are not.
    const { samples, beats: truth } = renderClickTrack({ bpm: 120, endBpm: 124, seconds: 30, offset: 0.1 });
    const g = trackSongGrid(samples, { sampleRate: SR });
    expect(hitRate(g.beats, truth.slice(1, -1), 0.05)).toBeGreaterThan(0.9);
  });
});

describe('the song musical time', () => {
  const grid: SongGrid = { ...EMPTY_SONG_GRID, periodS: 0.5, bpm: 120, phaseS: 0.25, beats: [0.25, 0.75, 1.25, 1.8, 2.3], confidence: 0.8 };

  it('interpolates between tracked beats and extends the line outside them', () => {
    expect(beatIndexAt(grid, 0.25)).toBeCloseTo(0);
    expect(beatIndexAt(grid, 1.525)).toBeCloseTo(2.5);
    expect(beatIndexAt(grid, 2.8)).toBeCloseTo(5);
    expect(beatIndexAt(grid, 0)).toBeCloseTo(-0.5);
    for (const k of [-1, 0, 0.3, 2.5, 3.9, 6]) expect(beatIndexAt(grid, songTimeOfBeat(grid, k))).toBeCloseTo(k);
  });

  it('reads tempo and the next beat in ENGINE time at the playback rate', () => {
    const m = songTimeAt(grid, 0.5, { t: 10, rate: 2 });
    expect(m.beat).toBeCloseTo(0.5);
    expect(m.phase).toBeCloseTo(0.5);
    expect(m.period).toBeCloseTo(0.25);
    expect(m.tempo).toBeCloseTo(240);
    expect(m.nextBeatAt).toBeCloseTo(10 + 0.25 / 2);
    expect(m.state).toBe('running');
    expect(songTimeAt(grid, 0.5, { t: 10, playing: false }).state).toBe('hold');
  });

  it('is ready (no beat, no tempo) without a ruler', () => {
    const m = songTimeAt(EMPTY_SONG_GRID, 3, { t: 1 });
    expect(m.state).toBe('ready');
    expect(m.tempo).toBe(0);
  });
});
