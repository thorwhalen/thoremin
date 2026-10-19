/**
 * Chord in (H8 of #613): the chord a keyboard holds, in any inversion, committed after a dwell
 * and kept while the keys are up.
 */
import { describe, it, expect } from 'vitest';
import { chordOfPitchClasses, createChordFollower } from '@thoremin/sdk/harmony/chord_in';

describe('the chord held', () => {
  it('reads any inversion or spacing, and nothing from a dyad or a bare fifth', () => {
    expect(chordOfPitchClasses([64, 67, 72])).toEqual({ root: 0, quality: 'maj' }); // E G C: C, first inversion
    expect(chordOfPitchClasses([43, 59, 62, 65])).toEqual({ root: 7, quality: '7' }); // G7, spread
    expect(chordOfPitchClasses([57, 60, 64, 67])).toEqual({ root: 9, quality: 'min7' }); // A C E G: the bass's reading (Am7, not C6)
    expect(chordOfPitchClasses([60, 64])).toBeNull();
    expect(chordOfPitchClasses([48, 55])).toBeNull();
    expect(chordOfPitchClasses([])).toBeNull();
  });

  it('commits after the dwell, ignores a passing shape, and holds while the keys are up', () => {
    const f = createChordFollower({ dwellS: 0.08 });
    expect(f.push([60, 64, 67], 0)).toBeNull();
    expect(f.push([60, 64, 67], 0.1)).toEqual({ root: 0, quality: 'maj' });
    expect(f.push([62, 65, 69], 0.12)?.root).toBe(0); // Dm just arrived: C still sounds
    expect(f.push([60, 64, 67], 0.15)?.root).toBe(0); // and it was only passing
    expect(f.push([], 0.3)?.root).toBe(0); // keys up: the harmony stays
    f.push([62, 65, 69], 0.4);
    expect(f.push([62, 65, 69], 0.5)).toEqual({ root: 2, quality: 'min' });
  });
});
