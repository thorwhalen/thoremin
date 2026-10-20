/**
 * The harmonic layers' chord model (H1 of #613, `docs/design/harmonic-layers.md` §2.1): one
 * quality table that `music/theory` and the air guitar now derive from, chords and keys, ids,
 * spelled names, classification, a key's chords and their functions.
 *
 * The facade guarantee comes first: `classifyChord` (the overlay's chord names and numerals)
 * must classify every set of tones exactly as its hand-written predecessor did. The reference
 * below is that predecessor, verbatim, and a seeded property test compares them.
 */
import { describe, it, expect } from 'vitest';
import { QUALITIES, QUALITY_IDS, qualityOfIntervals } from '@thoremin/sdk/harmony/qualities';
import {
  chordId,
  chordName,
  chordOfFunction,
  chordSymbol,
  classify,
  diatonicChords,
  functionOf,
  keyOf,
  parseChordId,
  pitchClasses,
  tonesOf,
  type Chord,
  type Key,
} from '@thoremin/sdk/harmony/chord';
import { classifyChord, nashvilleNumber, romanNumeral, NOTES, type ChordQuality } from '@thoremin/sdk/music/theory';
import { CHORD_QUALITIES } from '@thoremin/sdk/music/guitar';

/** `classifyChord` as it was before the quality table (copied verbatim, the facade's reference). */
function referenceClassify(tones: number[]): { root: number; quality: ChordQuality; symbol: string } | null {
  const QUALITY_SUFFIX: Record<ChordQuality, string> = { maj: '', min: 'm', dim: 'dim', aug: 'aug', power: '5', maj7: 'maj7', dom7: '7', min7: 'm7', m7b5: 'm7b5', dim7: 'dim7', minMaj7: 'mMaj7', augMaj7: 'augMaj7', unknown: '' };
  if (!tones.length) return null;
  const sorted = [...tones].sort((a, b) => a - b);
  const root = ((sorted[0] % 12) + 12) % 12;
  const iv = new Set(sorted.map((m) => (((m - sorted[0]) % 12) + 12) % 12));
  const has = (i: number) => iv.has(i);
  let quality: ChordQuality = 'unknown';
  if (has(4) && has(7) && has(11)) quality = 'maj7';
  else if (has(4) && has(7) && has(10)) quality = 'dom7';
  else if (has(3) && has(7) && has(10)) quality = 'min7';
  else if (has(3) && has(6) && has(10)) quality = 'm7b5';
  else if (has(3) && has(6) && has(9)) quality = 'dim7';
  else if (has(3) && has(7) && has(11)) quality = 'minMaj7';
  else if (has(4) && has(8) && has(11)) quality = 'augMaj7';
  else if (has(4) && has(7)) quality = 'maj';
  else if (has(3) && has(7)) quality = 'min';
  else if (has(3) && has(6)) quality = 'dim';
  else if (has(4) && has(8)) quality = 'aug';
  else if (has(7) && !has(3) && !has(4)) quality = 'power';
  return { root, quality, symbol: NOTES[root] + QUALITY_SUFFIX[quality] };
}

/** A small seeded generator (mulberry32), so a failure replays. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C_MAJOR: Key = { tonic: 0, scale: 'major' };
const ids = (chords: Chord[]) => chords.map(chordId);

describe('the quality table', () => {
  it('gives every quality one role per interval, the root first, and distinct suffixes', () => {
    for (const id of QUALITY_IDS) {
      const q = QUALITIES[id];
      expect(q.roles.length, id).toBe(q.intervals.length);
      expect(q.intervals[0], id).toBe(0);
      expect(q.roles[0], id).toBe('1');
      expect([...q.intervals].sort((a, b) => a - b), id).toEqual([...q.intervals].sort((a, b) => a - b));
    }
    const symbols = QUALITY_IDS.map((id) => QUALITIES[id].symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    const shorts = QUALITY_IDS.map((id) => QUALITIES[id].short);
    expect(new Set(shorts).size).toBe(shorts.length);
  });

  it('is what the air guitar reads: its suffix table is unchanged', () => {
    expect(CHORD_QUALITIES).toEqual({
      '': [0, 4, 7],
      m: [0, 3, 7],
      '7': [0, 4, 7, 10],
      m7: [0, 3, 7, 10],
      maj7: [0, 4, 7, 11],
      sus2: [0, 2, 7],
      sus4: [0, 5, 7],
      '5': [0, 7],
      dim: [0, 3, 6],
      aug: [0, 4, 8],
      '6': [0, 4, 7, 9],
      m6: [0, 3, 7, 9],
      add9: [0, 2, 4, 7],
    });
  });

  it('classifyChord is its predecessor exactly, on 20 000 random sets of tones', () => {
    const r = rng(613);
    for (let n = 0; n < 20_000; n++) {
      const size = 1 + Math.floor(r() * 6);
      const tones = Array.from({ length: size }, () => 36 + Math.floor(r() * 48));
      expect(classifyChord(tones), tones.join(',')).toEqual(referenceClassify(tones));
    }
    expect(classifyChord([])).toBeNull();
  });

  it('keeps the numerals and Nashville numbers it wrote before', () => {
    expect(romanNumeral(6, 'm7b5')).toBe('viiø');
    expect(romanNumeral(4, 'dom7')).toBe('V7');
    expect(romanNumeral(1, 'min')).toBe('ii');
    expect(romanNumeral(6, 'dim')).toBe('vii°');
    expect(romanNumeral(2, 'augMaj7')).toBe('III+maj7');
    expect(nashvilleNumber(1, 'min7')).toBe('2m7');
    expect(nashvilleNumber(6, 'dim7')).toBe('7°7');
    expect(romanNumeral(0, 'unknown')).toBe('I');
  });

  it('detects only what it detected before: a sus chord reads as its fifth, a sixth as its triad', () => {
    expect(qualityOfIntervals([0, 2, 7])).toBe('5');
    expect(qualityOfIntervals([0, 5, 7])).toBe('5');
    expect(qualityOfIntervals([0, 4, 7, 9])).toBe('maj');
    expect(qualityOfIntervals([0, 1, 2])).toBeNull();
  });
});

describe('chords and their ids', () => {
  it('round-trips every root, quality and bass through its id', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of QUALITY_IDS) {
        for (const bass of [undefined, (root + 4) % 12]) {
          const c: Chord = bass === undefined ? { root, quality } : { root, quality, bass };
          expect(parseChordId(chordId(c))).toEqual(c);
        }
      }
    }
    expect(chordId({ root: 7, quality: '7', bass: 11 })).toBe('G:7/B');
    expect(parseChordId('Bb:min7')).toEqual({ root: 10, quality: 'min7' });
    expect(parseChordId('H:maj')).toBeNull();
    expect(parseChordId('C:mystery')).toBeNull();
  });

  it('gives a chord its pitch classes and the role of each', () => {
    expect(pitchClasses({ root: 7, quality: '7' })).toEqual([7, 11, 2, 5]);
    expect(tonesOf({ root: 9, quality: 'min' })).toEqual([
      { pc: 9, role: '1' },
      { pc: 0, role: 'b3' },
      { pc: 4, role: '5' },
    ]);
  });

  it('classifies notes by their lowest, as the overlay does', () => {
    expect(classify([52, 55, 59])).toEqual({ root: 4, quality: 'min' });
    expect(classify([55, 59, 62, 65])).toEqual({ root: 7, quality: '7' });
    expect(classify([60, 62])).toBeNull();
    expect(classify([])).toBeNull();
  });
});

describe("a key's chords", () => {
  it('builds the triads and the sevenths of a key, read through its seven-note parent', () => {
    expect(ids(diatonicChords(C_MAJOR))).toEqual(['C:maj', 'D:min', 'E:min', 'F:maj', 'G:maj', 'A:min', 'B:dim']);
    expect(ids(diatonicChords(C_MAJOR, 4))).toEqual(['C:maj7', 'D:min7', 'E:min7', 'F:maj7', 'G:7', 'A:min7', 'B:hdim7']);
    expect(ids(diatonicChords({ tonic: 9, scale: 'minorHarmonic' }, 4))).toEqual(['A:minmaj7', 'B:hdim7', 'C:augmaj7', 'D:min7', 'E:7', 'F:maj7', 'G#:dim7']);
    expect(ids(diatonicChords({ tonic: 0, scale: 'pentatonic' }))).toEqual(ids(diatonicChords(C_MAJOR)));
    expect(keyOf({ root: 14, type: 'minor' })).toEqual({ tonic: 2, scale: 'minor' });
  });

  it('spells chords in the key, an altered root on the letter it alters', () => {
    const F: Key = { tonic: 5, scale: 'major' };
    expect(diatonicChords(F).map((c) => chordName(c, F))).toEqual(['F', 'Gm', 'Am', 'Bb', 'C', 'Dm', 'E°']);
    expect(diatonicChords({ tonic: 7, scale: 'major' }).map((c) => chordName(c, { tonic: 7, scale: 'major' }))).toEqual(['G', 'Am', 'Bm', 'C', 'D', 'Em', 'F#°']);
    expect(chordName({ root: 10, quality: 'maj' }, C_MAJOR)).toBe('Bb'); // bVII
    expect(chordName({ root: 10, quality: 'maj' })).toBe('A#'); // no key: sharps
    expect(chordName({ root: 0, quality: 'maj', bass: 4 }, C_MAJOR)).toBe('C/E');
    expect(chordSymbol({ root: 11, quality: 'dim' }, C_MAJOR)).toBe('Bdim');
    expect(chordName({ root: 11, quality: 'hdim7' }, C_MAJOR)).toBe('Bø7');
  });

  it('names each chord\'s function: diatonic, applied, altered', () => {
    const fn = (id: string) => functionOf(parseChordId(id)!, C_MAJOR);
    expect(diatonicChords(C_MAJOR).map((c) => functionOf(c, C_MAJOR)?.numeral)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(diatonicChords(C_MAJOR).map((c) => functionOf(c, C_MAJOR)?.riemann)).toEqual(['T', 'S', undefined, 'S', 'D', 'T', 'D']);
    expect(fn('G:7')).toMatchObject({ degree: 4, numeral: 'V7', riemann: 'D' });
    expect(fn('D:maj')).toMatchObject({ degree: 4, of: 4, numeral: 'V/V' });
    expect(fn('E:7')).toMatchObject({ degree: 4, of: 5, numeral: 'V7/vi' });
    expect(fn('C:7')).toMatchObject({ degree: 4, of: 3, numeral: 'V7/IV' });
    expect(fn('A#:maj')).toMatchObject({ degree: 6, alter: -1, numeral: 'bVII' });
    expect(fn('G#:maj')).toMatchObject({ degree: 5, alter: -1, numeral: 'bVI' });
    expect(fn('F:min')).toMatchObject({ degree: 3, numeral: 'iv' }); // borrowed: no Riemann claim
    expect(fn('F:min')?.riemann).toBeUndefined();
  });

  it('builds the chord a function names, the inverse of functionOf', () => {
    for (let degree = 0; degree < 7; degree++) {
      const c = chordOfFunction({ degree }, C_MAJOR);
      expect(functionOf(c, C_MAJOR)?.degree).toBe(degree);
    }
    expect(chordId(chordOfFunction({ degree: 4, of: 4 }, C_MAJOR))).toBe('D:maj');
    expect(chordId(chordOfFunction({ degree: 4, of: 1 }, C_MAJOR, 4))).toBe('A:7');
    expect(chordId(chordOfFunction({ degree: 6, alter: -1 }, C_MAJOR))).toBe('A#:maj');
    // As sevenths: V/IV as a triad IS the tonic (C), only V7/IV (C7) is its own chord.
    for (const of of [1, 2, 3, 4, 5]) expect(functionOf(chordOfFunction({ degree: 4, of }, C_MAJOR, 4), C_MAJOR)).toMatchObject({ of });
    expect(functionOf(chordOfFunction({ degree: 4, of: 3 }, C_MAJOR), C_MAJOR)?.numeral).toBe('I');
  });
});
