/**
 * Chord from sound (H8 of #613, second part): synthesized chords (sines with their first
 * harmonics, Hann-windowed, the analyser's 8192-point spectrum at 44.1 kHz) fold into a chroma
 * whose best template is the chord played; silence and a single note read no chord.
 */
import { describe, it, expect } from 'vitest';
import { chromaFromSpectrum, matchChord } from '@thoremin/sdk/harmony/chroma';
import { createChordFollower } from '@thoremin/sdk/harmony/chord_in';

const SR = 44100;
const N = 8192;

/** The magnitude spectrum of notes played together (each with `harmonics` partials at 1/h). */
function spectrum(midis: readonly number[], harmonics = 4): Float64Array {
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    let s = 0;
    for (const m of midis) {
      const f = 440 * 2 ** ((m - 69) / 12);
      for (let h = 1; h <= harmonics; h++) s += Math.sin((2 * Math.PI * f * h * i) / SR) / h;
    }
    x[i] = s * w;
  }
  const mags = new Float64Array(N / 2);
  const hi = Math.ceil(2100 / (SR / N));
  for (let k = 1; k <= hi; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * k * i) / N;
      re += x[i] * Math.cos(a);
      im -= x[i] * Math.sin(a);
    }
    mags[k] = Math.hypot(re, im);
  }
  return mags;
}
const read = (midis: readonly number[]) => matchChord(chromaFromSpectrum(spectrum(midis), { sampleRate: SR, fftSize: N }));

describe('a chord from its sound', () => {
  it('reads triads, sevenths and a guitar\'s open E, each clearly', () => {
    const cases: [readonly number[], { root: number; quality: string }][] = [
      [[48, 52, 55, 60], { root: 0, quality: 'maj' }],
      [[45, 57, 60, 64], { root: 9, quality: 'min' }],
      [[50, 53, 57], { root: 2, quality: 'min' }],
      [[43, 47, 50, 53], { root: 7, quality: '7' }],
      [[40, 47, 52, 56, 59, 64], { root: 4, quality: 'maj' }],
    ];
    for (const [midis, chord] of cases) {
      const m = read(midis)!;
      expect(m.chord, JSON.stringify(midis)).toEqual(chord);
      expect(m.score).toBeGreaterThan(0.8);
      expect(m.margin).toBeGreaterThan(0.02);
    }
  });

  it('reads nothing from silence, and no clear chord from a single note', () => {
    expect(matchChord(chromaFromSpectrum(new Float64Array(N / 2), { sampleRate: SR, fftSize: N }))).toBeNull();
    expect(read([60])!.score).toBeLessThan(0.8);
  });

  it('follows a heard chord with the same dwell as the keys', () => {
    const f = createChordFollower({ dwellS: 0.25 });
    const c = { root: 0, quality: 'maj' as const };
    expect(f.pushChord(c, 0)).toBeNull();
    expect(f.pushChord(c, 0.3)).toEqual(c);
    expect(f.pushChord(null, 0.5)).toEqual(c); // nothing clear: the harmony stays
  });
});
