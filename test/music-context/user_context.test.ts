/**
 * The player's producer (#934): a key, a tempo tapped along and a chord chart, read into a timeline
 * for any source; overlaid on whatever else is in force; and read at a song player's position (the
 * `position` its musical time now carries), with the chart's chords landing on the tapped bars.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contextFromUser, parseChart, parseChordSymbol, tempoFromTaps, UserEntrySchema } from '@thoremin/sdk/context/from_user';
import { chordAt, keyAt } from '@thoremin/sdk/context/cursor';
import { EMPTY_SONG_GRID, songTimeAt } from '@thoremin/ictus';
import { combineLayers } from '@/slices/music-context/app/combine';
import { musicContextNode } from '@/slices/music-context/nodes/music_context';
import { contextFromScore } from '@thoremin/sdk/context/from_score';
import { musicxmlToScoreDoc } from '@thoremin/music-formats/musicxml';
import type { MusicChordReading, MusicContextStatus } from '@thoremin/sdk/context/reading';
import type { ScaleOverride } from '@thoremin/sdk/context/scale';

describe('lead-sheet chords and charts', () => {
  it('reads the common symbols, a slash bass, and refuses what is not a chord', () => {
    expect(parseChordSymbol('F#m7')).toEqual({ root: 6, quality: 'min7' });
    expect(parseChordSymbol('Bb/D')).toEqual({ root: 10, quality: 'maj', bass: 2 });
    expect(parseChordSymbol('Gsus')).toEqual({ root: 7, quality: 'sus4' });
    expect(parseChordSymbol('Cmaj7')).toEqual({ root: 0, quality: 'maj7' });
    expect(parseChordSymbol('Ebdim7')).toEqual({ root: 3, quality: 'dim7' });
    expect(parseChordSymbol('A9')).toEqual({ root: 9, quality: '7' });
    expect(parseChordSymbol('H')).toBeNull();
    expect(parseChordSymbol('Cxyz')).toBeNull();
  });

  it('splits bars on |, shares a bar between its chords, repeats a bar with %, and names its errors', () => {
    const { bars, errors } = parseChart('| C | F G | % | N.C. | Q7 |');
    expect(bars).toHaveLength(5);
    expect(bars[1]).toEqual([{ root: 5, quality: 'maj' }, { root: 7, quality: 'maj' }]);
    expect(bars[2]).toEqual(bars[1]);
    expect(bars[3]).toEqual([null]);
    expect(errors).toEqual(['Q7']);
  });
});

describe('tap tempo', () => {
  it('fits a tempo and a downbeat to steady taps, and keeps only the last run after a pause', () => {
    const taps = [3, 3.5, 4, 4.5, 5].map((t, i) => t + (i % 2 ? 0.01 : -0.01));
    const tempo = tempoFromTaps(taps)!;
    expect(tempo.bpm).toBeCloseTo(120, 0);
    expect(tempo.firstBeatS).toBeCloseTo(3, 1);
    // An early try, a pause, then the real run at 100 bpm from 20 s.
    const again = tempoFromTaps([1, 1.4, 20, 20.6, 21.2, 21.8])!;
    expect(again.bpm).toBeCloseTo(100, 6);
    expect(again.firstBeatS).toBeCloseTo(20, 6);
    expect(tempoFromTaps([1, 1.5, 2])).toBeNull();
  });
});

describe("the player's timeline", () => {
  const entry = UserEntrySchema.parse({ key: { tonic: 7, mode: 'major' }, tempo: { bpm: 120, firstBeatS: 2, beatsPerBar: 4 }, chart: 'G | C D | G' });

  it('puts the chart on the tapped bars, the key over everything', () => {
    const ctx = contextFromUser(entry);
    expect(ctx.source).toBe('user');
    expect(ctx.analyzers.map((a) => a.name)).toEqual(['user']);
    // Bar 1 at 2 s, a bar is 2 s: C from 4 s, D from 5 s, G from 6 s.
    expect(chordAt(ctx, 1.9)).toBeNull();
    expect(chordAt(ctx, 2)?.chord).toEqual({ root: 7, quality: 'maj' });
    expect(chordAt(ctx, 4.5)?.chord).toEqual({ root: 0, quality: 'maj' });
    expect(chordAt(ctx, 5)?.chord).toEqual({ root: 2, quality: 'maj' });
    expect(chordAt(ctx, 7.9)?.chord).toEqual({ root: 7, quality: 'maj' });
    expect(keyAt(ctx, 0)).toMatchObject({ tonic: 7, mode: 'major' });
    expect(keyAt(ctx, 0)!.scalePcs).toContain(6);
    expect(ctx.downbeats.slice(0, 3)).toEqual([2, 4, 6]);
  });

  it("uses a song's own beat grid for the chart when nothing was tapped, and a key alone needs no ruler", () => {
    const ruler = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5];
    const ctx = contextFromUser({ ...entry, tempo: null }, { ruler });
    expect(chordAt(ctx, 2.6)?.chord).toEqual({ root: 0, quality: 'maj' });
    const keyOnly = contextFromUser({ key: { tonic: 9, mode: 'minor' }, tempo: null, chart: '' });
    expect(keyOnly.chords).toEqual([]);
    expect(keyAt(keyOnly, 123)).toMatchObject({ tonic: 9, mode: 'minor' });
  });
});

describe('which timeline is in force', () => {
  const score = { context: contextFromScore(musicxmlToScoreDoc(new Uint8Array(readFileSync(join(__dirname, '..', '..', 'public', 'scores', 'modulation-study.musicxml'))))), clock: 'conductor' as const };
  const userOf = (e: Parameters<typeof contextFromUser>[0]) => ({ active: { context: contextFromUser(e), clock: 'song' as const }, entry: e });

  it('a key alone overlays the score: its bars and chords stay, its keys give way', () => {
    const key = UserEntrySchema.parse({ key: { tonic: 2, mode: 'minor' } });
    const out = combineLayers({ user: userOf(key), score })!;
    expect(out.clock).toBe('conductor');
    expect(out.context.source).toBe('user');
    expect(out.context.chords).toEqual(score.context.chords);
    expect(out.context.keys).toHaveLength(1);
    expect(keyAt(out.context, 25)).toMatchObject({ tonic: 2, mode: 'minor' });
    expect(out.context.analyzers.map((a) => a.name)).toEqual([...score.context.analyzers.map((a) => a.name), 'user']);
  });

  it('a chart or a tapped tempo is a timeline of its own, on the song; nothing said leaves the score', () => {
    const chart = UserEntrySchema.parse({ chart: 'C | G' });
    expect(combineLayers({ user: userOf(chart), score })!.clock).toBe('song');
    expect(combineLayers({ user: null, score })).toBe(score);
    expect(combineLayers({})).toBeNull();
  });
});

describe('the node reads a song by its position, grid or not', () => {
  /** One tick of the node over a song reading at song position `p` (playing), engine time `t`. */
  function run(entry: Parameters<typeof contextFromUser>[0], readings: { t: number; p: number }[]) {
    const h = musicContextNode.make(musicContextNode.params.parse({}));
    const context = contextFromUser(entry);
    return readings.map(({ t, p }) => {
      const time = songTimeAt(EMPTY_SONG_GRID, p, { t, rate: 1, playing: true });
      return h.process({ config: { scaleFrom: 'music' }, context: { context, clock: 'song' }, time }, { time: t, dt: 1 / 60, tick: 0, resources: {} } as never) as { scale: ScaleOverride | null; chord: MusicChordReading; status: MusicContextStatus };
    });
  }

  it('a song with no beat grid still carries its position, and the tapped chart lands on it', () => {
    expect(songTimeAt(EMPTY_SONG_GRID, 12.5, { t: 3, rate: 1.1, playing: true })).toMatchObject({ state: 'ready', position: 12.5, rate: 1.1 });
    expect(songTimeAt(EMPTY_SONG_GRID, 12.5, { t: 3, rate: 1.1, playing: false })).toMatchObject({ position: 12.5, rate: 0 });
    const entry = UserEntrySchema.parse({ key: { tonic: 7, mode: 'major' }, tempo: { bpm: 120, firstBeatS: 2, beatsPerBar: 4 }, chart: 'G | C D | G' });
    // Song position = engine time + 100 (the song started long before), moving.
    const out = run(entry, [0, 1, 2, 3.9, 4, 4.9, 5, 5.5].map((t) => ({ t: t + 100, p: t })));
    expect(out.map((o) => o.chord.name)).toEqual([null, null, 'G', 'G', 'C', 'C', 'D', 'D']);
    expect(out[1].status).toMatchObject({ active: true, source: 'user', clock: 'song', key: 'G major', ownsScale: true });
    // Moving (its rate is not 0): the D at 5 s is announced from the C, a beat ahead.
    expect(out[5].chord.next).toMatchObject({ name: 'D' });
    expect(out[5].chord.next!.at).toBeCloseTo(105, 6);
    expect(out[0].scale).toEqual({ key: { tonic: 7, mode: 'major' }, fit: 'flavour' });
  });
});
