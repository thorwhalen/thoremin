/**
 * Chord from sound (H8 of #613, second part): synthesized chords (sines with their first
 * harmonics, Hann-windowed, the analyser's 8192-point spectrum at 44.1 kHz) fold into a chroma
 * whose best template is the chord played; silence and a single note read no chord.
 */
import { describe, it, expect } from 'vitest';
import { chromaFromSpectrum, createLevelGate, matchChord } from '@thoremin/sdk/harmony/chroma';
import { createChordFollower } from '@thoremin/sdk/harmony/chord_in';

const SR = 44100;
const N = 8192;

/** The magnitude spectrum of notes played together (each with `harmonics` partials at 1/h). */
function spectrum(midis: readonly number[], harmonics = 4, tilt = 1): Float64Array {
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    let s = 0;
    for (const m of midis) {
      const f = 440 * 2 ** ((m - 69) / 12);
      for (let h = 1; h <= harmonics; h++) s += Math.sin((2 * Math.PI * f * h * i) / SR) / h ** tilt;
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
const read = (midis: readonly number[], harmonics = 4, tilt = 1) => matchChord(chromaFromSpectrum(spectrum(midis, harmonics, tilt), { sampleRate: SR, fftSize: N }));

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

  it('a bright timbre (ten harmonics): a triad and its own seventh do not cancel, a power chord is no major chord', () => {
    const c = read([48, 52, 55, 60, 64], 10, 0.7)!; // an open C, bright
    expect(c.chord.root).toBe(0);
    expect(['maj', 'maj7']).toContain(c.chord.quality);
    expect(c.margin).toBeGreaterThan(0.02);
    const a5 = read([45, 52, 57], 10, 1); // A2 E3 A3: the root's fifth harmonic is a faint C#
    expect(a5 === null || a5.chord.quality !== 'maj' || a5.chord.root !== 9).toBe(true);
  });

  it('a sound counts only clearly above the room\'s own floor, whatever the gain', () => {
    const g = createLevelGate();
    for (let i = 0; i < 20; i++) expect(g.push(1e-9, 0.1)).toBe(false); // the room
    expect(g.push(5e-8, 0.1)).toBe(true); // 17 dB over it: a guitar across the room
    expect(g.push(3e-9, 0.1)).toBe(false); // a breath
    const loud = createLevelGate();
    for (let i = 0; i < 20; i++) loud.push(1e-5, 0.1); // a noisy, hot microphone
    expect(loud.push(5e-5, 0.1)).toBe(false); // not 10 dB over its floor
    expect(loud.push(5e-4, 0.1)).toBe(true);
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
