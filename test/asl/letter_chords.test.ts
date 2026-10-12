/**
 * Letters name chords "in their own key": the letter is the chord root's letter name, with
 * the key's accidentals applied. The rule the user stated: in D, F is F#m (iii).
 */
import { describe, expect, it } from 'vitest';
import { chordName, keyName, letterDegree, NOTE_LETTERS, type ScaleSpec, type ScaleTypeId } from '@thoremin/sdk/music/theory';
import { chordCaptions, letterChordName, letterTriad } from '@thoremin/ext-asl/nodes/sign_chord';

const key = (root: number, type: ScaleTypeId = 'major'): ScaleSpec => ({ root, type, octaves: 2, baseOctave: 3 });
const chordsOf = (k: ScaleSpec) => NOTE_LETTERS.map((l) => letterChordName(k, l));

describe('letter chords', () => {
  it('D major: D Em F#m G A Bm C#dim, letter by letter', () => {
    expect(letterDegree(key(2), 'F')).toBe(2);
    expect(chordsOf(key(2))).toEqual(['C#dim', 'D', 'Em', 'F#m', 'G', 'A', 'Bm']);
  });

  it('C major is the plain diatonic set', () => {
    expect(chordsOf(key(0))).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  });

  it('a flat key spells with its own letters (Db major: D is the tonic, C is vii°)', () => {
    expect(letterDegree(key(1), 'D')).toBe(0);
    expect(letterDegree(key(1), 'C')).toBe(6);
    expect(chordsOf(key(1))).toEqual(['Cdim', 'Db', 'Ebm', 'Fm', 'Gb', 'Ab', 'Bbm']);
    expect(keyName(key(1))).toBe('Db');
  });

  it('minor keys: A minor G is VII (G major), E minor F is ii° (F#dim)', () => {
    expect(chordName(letterTriad(key(9, 'minor'), 'G'))).toBe('G');
    expect(letterChordName(key(4, 'minor'), 'F')).toBe('F#dim');
    expect(keyName(key(8, 'minor'))).toBe('G#');
  });

  it('chords are spelled on the letter signed: F major B is Bb, never A#', () => {
    expect(letterChordName(key(5), 'B')).toBe('Bb');
    expect(keyName(key(10))).toBe('Bb');
    expect(keyName(key(6))).toBe('F#');
  });

  it('a pentatonic key spells like its seven-note parent', () => {
    expect(chordsOf(key(2, 'pentatonic'))).toEqual(chordsOf(key(2)));
    expect(chordsOf(key(9, 'minorPentatonic'))).toEqual(chordsOf(key(9, 'minor')));
  });

  it('captions name the chord under A..G and nothing under other signs', () => {
    expect(chordCaptions(key(2), ['A', 'F', 'H', 'yes'])).toEqual(['A', 'F#m', '', '']);
    expect(chordCaptions(undefined, ['A'])).toEqual(['']);
  });
});
