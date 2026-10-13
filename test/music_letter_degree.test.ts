/**
 * The letter-chord rule in the SDK's theory (`letterDegree`, `keyName`): a letter names the
 * scale degree whose root has that letter name, the key's accidentals applied (in D, F is the
 * iii, F#). Core's own test: the ASL plugin builds its chord node on it (thorwhalen/thoremin-asl,
 * `test/letter_chords.test.ts` there), but the rule lives here and must not break unnoticed
 * until the plugin's CI runs.
 */
import { describe, expect, it } from 'vitest';
import { keyName, letterDegree, NOTE_LETTERS, type ScaleSpec, type ScaleTypeId } from '@thoremin/sdk/music/theory';

const key = (root: number, type: ScaleTypeId = 'major'): ScaleSpec => ({ root, type, octaves: 2, baseOctave: 3 });
const degreesOf = (k: ScaleSpec) => NOTE_LETTERS.map((l) => letterDegree(k, l));

describe('letterDegree and keyName (the letter-chord rule)', () => {
  it('the letters run C..B', () => {
    expect(NOTE_LETTERS).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });

  it('C major: C is I, B is vii', () => {
    expect(degreesOf(key(0))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('D major: D is I, F (F#) is iii, C (C#) is vii', () => {
    expect(degreesOf(key(2))).toEqual([6, 0, 1, 2, 3, 4, 5]);
  });

  it('a flat key counts from its own letter: Db major, D is I and C is vii', () => {
    expect(degreesOf(key(1))).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(keyName(key(1))).toBe('Db');
  });

  it('a pentatonic key counts like its seven-note parent', () => {
    expect(degreesOf(key(2, 'pentatonic'))).toEqual(degreesOf(key(2)));
    expect(degreesOf(key(9, 'minorPentatonic'))).toEqual(degreesOf(key(9, 'minor')));
  });

  it('key names are spelled by the key: G# minor, Bb major, F# major', () => {
    expect(keyName(key(8, 'minor'))).toBe('G#');
    expect(keyName(key(10))).toBe('Bb');
    expect(keyName(key(6))).toBe('F#');
  });
});
