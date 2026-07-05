import { describe, it, expect } from 'vitest';
import {
  midiToFreq,
  freqToMidi,
  generateScale,
  magneticPitch,
  nearestScaleNote,
  rangeMap,
  midiToName,
  chordName,
  classifyChord,
  scaleDegreeOf,
  romanNumeral,
  nashvilleNumber,
  scaleGuide,
  DEFAULT_SCALE,
} from '@/music/theory';

describe('chordName', () => {
  it('classifies triad quality from the tones (root = lowest)', () => {
    expect(chordName([60, 64, 67])).toBe('C'); // C E G  → major
    expect(chordName([57, 60, 64])).toBe('Am'); // A C E  → minor
    expect(chordName([59, 62, 65])).toBe('Bdim'); // B D F  → diminished
    expect(chordName([60, 64, 68])).toBe('Caug'); // C E G# → augmented
    expect(chordName([62, 66, 69])).toBe('D'); // D F# A → major, different root
  });
  it('is octave-agnostic and unsorted-input safe', () => {
    expect(chordName([67, 60, 64])).toBe('C'); // reordered C major
    expect(chordName([48, 52, 55])).toBe('C'); // low octave
  });
  it('falls back gracefully (empty / power / non-triad)', () => {
    expect(chordName([])).toBe('');
    expect(chordName([60, 67])).toBe('C5'); // root + fifth, no third
  });
  it('names the diatonic sevenths (the pose/brow add-7th chords)', () => {
    expect(chordName([60, 64, 67, 71])).toBe('Cmaj7'); // C E G B  → major 7th
    expect(chordName([67, 71, 74, 77])).toBe('G7'); // G B D F  → dominant 7th
    expect(chordName([62, 65, 69, 72])).toBe('Dm7'); // D F A C  → minor 7th
    expect(chordName([71, 74, 77, 81])).toBe('Bm7b5'); // B D F A  → half-diminished
    expect(chordName([71, 74, 77, 80])).toBe('Bdim7'); // B D F Ab → diminished 7th
    // Harmonic-minor III with the pose brow-7th: an augmented triad + major 7th.
    // Must NOT collapse to a plain augmented triad (dropping the sounding 7th).
    expect(chordName([63, 67, 71, 74])).toBe('D#augMaj7'); // D# G B D → aug(maj7)
    expect(chordName([60, 64, 68])).toBe('Caug'); // plain augmented triad still 'aug'
  });
});

describe('classifyChord', () => {
  it('returns root pitch class + quality + symbol; null for no tones', () => {
    expect(classifyChord([])).toBeNull();
    expect(classifyChord([60, 64, 67])).toEqual({ root: 0, quality: 'maj', symbol: 'C' });
    expect(classifyChord([57, 60, 64])).toMatchObject({ root: 9, quality: 'min' });
    expect(classifyChord([67, 71, 74, 77])).toMatchObject({ root: 7, quality: 'dom7', symbol: 'G7' });
  });
});

describe('scaleDegreeOf', () => {
  const cMajor = generateScale({ root: 0, type: 'major', octaves: 2, baseOctave: 3 });
  it('maps a pitch class to its scale degree (0=tonic), -1 when out of scale', () => {
    expect(scaleDegreeOf(0, cMajor)).toBe(0); // C = tonic
    expect(scaleDegreeOf(7, cMajor)).toBe(4); // G = V
    expect(scaleDegreeOf(11, cMajor)).toBe(6); // B = vii
    expect(scaleDegreeOf(1, cMajor)).toBe(-1); // C# not in C major
  });
  it('is octave-agnostic (a high chord root still resolves to its degree)', () => {
    expect(scaleDegreeOf(67 % 12, cMajor)).toBe(4); // G in any octave → V
  });
});

describe('romanNumeral / nashvilleNumber', () => {
  it('encodes degree + quality (case, °/ø/+, sevenths)', () => {
    expect(romanNumeral(0, 'maj')).toBe('I');
    expect(romanNumeral(1, 'min')).toBe('ii');
    expect(romanNumeral(4, 'dom7')).toBe('V7');
    expect(romanNumeral(6, 'dim')).toBe('vii°');
    expect(romanNumeral(6, 'm7b5')).toBe('viiø');
    expect(romanNumeral(0, 'maj7')).toBe('Imaj7');
    expect(romanNumeral(2, 'aug')).toBe('III+');
    expect(romanNumeral(2, 'augMaj7')).toBe('III+maj7'); // uppercase (major-ish) + aug-maj7 mark
    expect(romanNumeral(-1, 'maj')).toBe(''); // silence sentinel → no label
  });
  it('nashville: number-first with m / marks', () => {
    expect(nashvilleNumber(0, 'maj')).toBe('1');
    expect(nashvilleNumber(1, 'min')).toBe('2m');
    expect(nashvilleNumber(4, 'dom7')).toBe('57');
    expect(nashvilleNumber(6, 'dim')).toBe('7°');
    expect(nashvilleNumber(6, 'm7b5')).toBe('7ø');
    expect(nashvilleNumber(0, 'maj7')).toBe('1maj7');
    expect(nashvilleNumber(-1, 'maj')).toBe('');
  });
});

describe('scaleGuide', () => {
  it('places notes at ascending normalized x matching the magneticPitch mapping', () => {
    const scale = generateScale(DEFAULT_SCALE); // C major, 2 octaves
    const guide = scaleGuide(scale);
    expect(guide.length).toBe(scale.length);
    expect(guide[0].x).toBeCloseTo(0, 6); // lowest note at x=0
    expect(guide[guide.length - 1].x).toBeCloseTo(1, 6); // highest at x=1
    // x is strictly ascending and each x lands where magneticPitch(x)=that note.
    for (let i = 1; i < guide.length; i++) expect(guide[i].x).toBeGreaterThan(guide[i - 1].x);
    for (const { midi, x } of guide) {
      expect(magneticPitch(x, scale, 0)).toBeCloseTo(midi, 6); // free glide hits the note exactly
    }
  });

  it('handles empty and single-note scales', () => {
    expect(scaleGuide([])).toEqual([]);
    expect(scaleGuide([60])).toEqual([{ midi: 60, x: 0 }]);
  });
});

describe('pitch conversions', () => {
  it('midiToFreq / freqToMidi are inverse, A4 = 440', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
    expect(freqToMidi(440)).toBeCloseTo(69, 6);
    expect(freqToMidi(midiToFreq(73))).toBeCloseTo(73, 6);
  });
  it('names notes', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(61)).toBe('C#4');
  });
});

describe('scale generation', () => {
  it('C major over 2 octaves, base octave 3', () => {
    const s = generateScale(DEFAULT_SCALE);
    // base = (3+1)*12 + 0 = 48 (C3); 7 notes/oct + completing top note
    expect(s[0]).toBe(48);
    expect(s).toContain(60); // C4
    expect(s[s.length - 1]).toBe(48 + 24); // top C
    expect(s).toEqual([...s].sort((a, b) => a - b)); // ascending
    expect(new Set(s).size).toBe(s.length); // no dupes
  });
  it('pentatonic has 5 notes per octave', () => {
    const s = generateScale({ root: 0, type: 'pentatonic', octaves: 1, baseOctave: 4 });
    expect(s.length).toBe(6); // 5 + completing octave
  });
});

describe('magneticPitch (tonal guidance)', () => {
  const scale = generateScale({ root: 0, type: 'major', octaves: 1, baseOctave: 4 }); // C4..C5

  it('magnetism 0 = free continuous glide spanning the scale range', () => {
    expect(magneticPitch(0, scale, 0)).toBeCloseTo(scale[0], 6);
    expect(magneticPitch(1, scale, 0)).toBeCloseTo(scale[scale.length - 1], 6);
    const mid = magneticPitch(0.5, scale, 0);
    expect(mid).toBeGreaterThan(scale[0]);
    expect(mid).toBeLessThan(scale[scale.length - 1]);
  });

  it('magnetism 1 = hard snap to an actual scale note', () => {
    for (const x of [0.07, 0.21, 0.33, 0.5, 0.7, 0.9]) {
      const midi = magneticPitch(x, scale, 1);
      expect(scale).toContain(Math.round(midi));
      expect(midi).toBeCloseTo(Math.round(midi), 6);
    }
  });

  it('is monotonic non-decreasing in x for any magnetism', () => {
    for (const mag of [0, 0.5, 0.8, 1]) {
      let prev = -Infinity;
      for (let i = 0; i <= 50; i++) {
        const v = magneticPitch(i / 50, scale, mag);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('clamps x outside [0,1]', () => {
    expect(magneticPitch(-1, scale, 0.5)).toBeCloseTo(scale[0], 6);
    expect(magneticPitch(2, scale, 0.5)).toBeCloseTo(scale[scale.length - 1], 6);
  });
});

describe('helpers', () => {
  it('nearestScaleNote picks the closest member', () => {
    expect(nearestScaleNote(61.4, [60, 62, 64])).toBe(62);
    expect(nearestScaleNote(60.4, [60, 62, 64])).toBe(60);
  });
  it('rangeMap maps and clamps', () => {
    expect(rangeMap(0.5, 0, 1, 0, 100)).toBe(50);
    expect(rangeMap(-1, 0, 1, 0, 100)).toBe(0);
    expect(rangeMap(2, 0, 1, 10, 20)).toBe(20);
  });
});
