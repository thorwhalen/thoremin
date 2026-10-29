/**
 * The song model the listening games read (`@thoremin/sdk/score/song`) and the music formats that
 * produce it (`@thoremin/music-formats`): the compact text both ways, the shipped demo scores (a
 * MIDI symphony, a compressed MusicXML quartet) reduced to one melodic line, ABC, and a song
 * written to MIDI and read back, pitched and as a rhythm.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPitchedSong, melodyPart, nameOf, songFromScore, songFromText, songToText, type Song } from '@thoremin/sdk/score/song';
import { SongSchema } from '@thoremin/sdk/score/song_schema';
import { midiToScoreDoc, songToMidi } from '@thoremin/music-formats/midi';
import { musicxmlToScoreDoc } from '@thoremin/music-formats/musicxml';
import { abcToScoreDoc } from '@thoremin/music-formats/abc';
import { notesFrom } from '@thoremin/games/lesson';

const ODE: Song = { title: 'Ode to Joy', bpm: 100, beatsPerBar: 4, notes: notesFrom('E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:0.5 D4:2') };
const RHYTHM: Song = { bpm: 90, beatsPerBar: 4, notes: notesFrom('x x:0.5 x:0.5 - x  x:2 -:0.5 x:0.5 x') };

/** No two notes sound at once, in onset order. */
const monophonic = (s: Song) => s.notes.every((n, i) => i === 0 || s.notes[i - 1].beat + s.notes[i - 1].beats <= n.beat + 1e-9);

describe('the compact text', () => {
  it('writes a song and reads it back unchanged, rests and tempo included', () => {
    for (const s of [ODE, RHYTHM]) {
      const text = songToText(s);
      const back = songFromText(text);
      expect(back.notes).toEqual(s.notes);
      expect(back.bpm).toBe(s.bpm);
      expect(back.beatsPerBar).toBe(s.beatsPerBar);
    }
    expect(songToText(RHYTHM)).toBe('bpm=90 bar=4 x x:0.5 x:0.5 - x x:2 -:0.5 x:0.5 x');
  });

  it('ignores comments, and says what is wrong with a bad token', () => {
    expect(songFromText('# a scale\nC4 D4 E4 # up').notes.map((n) => nameOf(n.midi!))).toEqual(['C4', 'D4', 'E4']);
    expect(() => songFromText('C4 H4')).toThrow(/"H4" is not a pitch/);
    expect(() => songFromText('C4:0')).toThrow(/bad length/);
  });

  it('is what the schema accepts', () => {
    expect(SongSchema.parse(ODE)).toEqual(ODE);
    expect(SongSchema.safeParse({ notes: [] }).success).toBe(false);
    expect(SongSchema.safeParse({ notes: [{ beat: 0, beats: -1 }] }).success).toBe(false);
  });
});

describe('the compact text, edge cases (from the review)', () => {
  it('reads and writes sharps: # is a comment only at the start of a token', () => {
    const s = songFromText('C#4 F#3 # a comment\nG#4:2');
    expect(s.notes.map((n) => n.midi)).toEqual([61, 54, 68]); // G#4 is written back as its spelling, Ab4
    expect(songFromText(songToText(s)).notes).toEqual(s.notes);
  });

  it('writes overlapping notes as one line (the skyline), and keeps short lengths', () => {
    const chord: Song = { notes: [{ beat: 0, beats: 2, midi: 60 }, { beat: 0, beats: 2, midi: 64 }, { beat: 1, beats: 1, midi: 62 }, { beat: 2, beats: 0.00002, midi: 67 }] };
    const back = songFromText(songToText(chord)).notes;
    expect(back).toEqual([{ beat: 0, beats: 1, midi: 64 }, { beat: 1, beats: 1, midi: 62 }, { beat: 2, beats: 0.00002, midi: 67 }]);
  });
});

describe('a score reduced to a song', () => {
  it('the demo MIDI: the busiest pitched part, one line, its tempo and bar', () => {
    const doc = midiToScoreDoc(new Uint8Array(readFileSync('public/scores/beethoven-symphony-5-1.mid')));
    const song = songFromScore(doc);
    expect(song.notes.length).toBeGreaterThan(50);
    expect(isPitchedSong(song)).toBe(true);
    expect(monophonic(song)).toBe(true);
    expect(song.bpm).toBeGreaterThan(0);
    expect(song.beatsPerBar).toBe(2); // 2/4
    expect(melodyPart(doc)!.notes.length).toBe(Math.max(...doc.parts.filter((p) => !p.percussion).map((p) => p.notes.length)));
  });

  it('the demo compressed MusicXML, and a part chosen by index', () => {
    const doc = musicxmlToScoreDoc(new Uint8Array(readFileSync('public/scores/haydn-op76-3.mxl')));
    const first = songFromScore(doc, { part: 0 });
    expect(first.notes.length).toBeGreaterThan(20);
    expect(monophonic(first)).toBe(true);
    expect(() => songFromScore(doc, { part: 99 })).toThrow(/no notes in part 99/);
  });

  it('ABC: a tune read to its notes', () => {
    const abc = ['X:1', 'T:Scale', 'M:4/4', 'L:1/4', 'Q:1/4=120', 'K:C', 'C D E F | G2 G2 |'].join('\n');
    const song = songFromScore(abcToScoreDoc(abc));
    expect(song.notes.map((n) => nameOf(n.midi!))).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'G4']);
    expect(song.notes.map((n) => n.beats)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(song.beatsPerBar).toBe(4);
    expect(song.bpm).toBe(120);
  });
});

describe('a song written to MIDI', () => {
  it('reads back as the same notes, tempo and bar', () => {
    const back = songFromScore(midiToScoreDoc(songToMidi(ODE)));
    expect(back.notes).toEqual(ODE.notes);
    expect(back.bpm).toBe(100);
    expect(back.beatsPerBar).toBe(4);
  });

  it('a melody with unpitched hits keeps them hits; no tempo is invented; an odd meter stays odd', async () => {
    const mixed: Song = { beatsPerBar: 2.5, notes: [{ beat: 0, beats: 1, midi: 60 }, { beat: 1, beats: 0.5 }, { beat: 1.5, beats: 1, midi: 62 }] };
    const back = songFromScore(midiToScoreDoc(songToMidi(mixed)));
    expect(back.notes).toEqual(mixed.notes);
    expect(back.bpm).toBeUndefined();
    expect(back.beatsPerBar).toBe(2.5);
  });

  it('a rhythm goes out as claps on the percussion channel and comes back a rhythm', () => {
    const doc = midiToScoreDoc(songToMidi(RHYTHM));
    expect(doc.parts[0].percussion).toBe(true);
    const back = songFromScore(doc);
    expect(isPitchedSong(back)).toBe(false);
    expect(back.notes).toEqual(RHYTHM.notes);
  });
});
