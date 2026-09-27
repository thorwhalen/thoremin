/**
 * Guitar chords (#249): chord names parse to root + quality, and the open-chord rule on
 * six strings rebuilds the open chords a beginner learns; a strum is that voicing, low
 * string first, a few milliseconds apart, each note on its string's voice.
 */
import { describe, it, expect } from 'vitest';
import { parseChordName, guitarVoicing } from '@/music/guitar';
import { strumNotes } from '@/nodes/music/air_guitar';

const voicing = (name: string) => guitarVoicing(parseChordName(name)!);

describe('parseChordName', () => {
  it('reads roots, accidentals and qualities, and canonicalises the name', () => {
    expect(parseChordName('G')).toMatchObject({ root: 7, quality: '', name: 'G' });
    expect(parseChordName(' em ')).toMatchObject({ root: 4, quality: 'm', name: 'Em' });
    expect(parseChordName('F#m7')).toMatchObject({ root: 6, quality: 'm7', name: 'F#m7' });
    expect(parseChordName('Bb')).toMatchObject({ root: 10, quality: '', name: 'A#' });
    expect(parseChordName('Dsus')).toMatchObject({ root: 2, quality: 'sus4' });
    expect(parseChordName('Cmaj7')?.intervals).toEqual([0, 4, 7, 11]);
    expect(parseChordName('Amin')?.quality).toBe('m');
  });

  it('refuses what is not a chord', () => {
    for (const bad of ['', 'H', 'Gxyz', 'my shape', '7']) expect(parseChordName(bad)).toBeNull();
  });
});

describe('guitarVoicing', () => {
  it('rebuilds the open chords (low E string first, null = muted)', () => {
    expect(voicing('C')).toEqual([null, 48, 52, 55, 60, 64]); // x32010
    expect(voicing('G')).toEqual([43, 47, 50, 55, 59, 67]); // 320003
    expect(voicing('D')).toEqual([null, null, 50, 57, 62, 66]); // xx0232
    expect(voicing('Em')).toEqual([40, 47, 52, 55, 59, 64]); // 022000
    expect(voicing('Am')).toEqual([null, 45, 52, 57, 60, 64]); // x02210
    expect(voicing('E')).toEqual([40, 47, 52, 56, 59, 64]); // 022100
  });

  it('keeps every chord tone but the fifth: a seventh takes a doubled string or the fifth', () => {
    expect(voicing('C7')).toEqual([null, 48, 52, 58, 60, 64]); // x32310
    expect(voicing('G7')).toEqual([43, 47, 50, 55, 59, 65]); // 320001
    for (const name of ['C7', 'Am7', 'Dmaj7', 'E6', 'Fadd9']) {
      const chord = parseChordName(name)!;
      const got = new Set(guitarVoicing(chord).filter((n): n is number => n !== null).map((n) => n % 12));
      // The fifth is the one tone a guitarist may drop (C7 is x32310, no G).
      for (const i of chord.intervals) if (i !== 7) expect(got.has((chord.root + i) % 12), `${name} misses ${i}`).toBe(true);
    }
  });

  it('voices every parseable chord with the root in the bass', () => {
    for (const root of ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) {
      for (const q of ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', '5', 'dim', 'aug', '6', 'm6', 'add9']) {
        const chord = parseChordName(root + q)!;
        const notes = guitarVoicing(chord);
        const bass = notes.find((n) => n !== null);
        expect(bass, root + q).toBeDefined();
        expect(bass! % 12, root + q).toBe(chord.root);
        expect(notes.filter((n) => n !== null).length, root + q).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('strumNotes', () => {
  it('is the voicing low string first, spread in time, one voice per string', () => {
    const notes = strumNotes('C', 10, 0.8, 0.01, { predicted: true, lead: 0.05 });
    expect(notes.map((n) => n.midi)).toEqual([48, 52, 55, 60, 64]);
    expect(notes.map((n) => n.voice)).toEqual([1, 2, 3, 4, 5]);
    notes.forEach((n, i) => expect(n.t).toBeCloseTo(10 + i * 0.01, 9));
  });

  it('shifts by octaves, and plays nothing for a name that is not a chord', () => {
    expect(strumNotes('Em', 0, 1, 0, { predicted: true, lead: 0 }, -1)[0].midi).toBe(28);
    expect(strumNotes('my shape', 0, 1, 0, { predicted: true, lead: 0 })).toEqual([]);
  });
});
