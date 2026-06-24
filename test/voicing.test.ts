/**
 * Tests the pure chord voicing + rendering engine (src/music/voicing.ts):
 * researched triad voicings (low bass, quality-agnostic, view-independent) and the
 * tempo-based articulation gain patterns.
 */
import { describe, it, expect } from 'vitest';
import { voiceTriad, renderGains, isTempoRendering } from '@/music/voicing';

// C major triad as ascending scale tones: C3, E3, G3.
const cMaj = [48, 52, 55];

describe('voiceTriad', () => {
  it('anchors a low bass an octave below the root and stacks each voicing', () => {
    // bass b = 48 - 12 = 36 (C2); third T = 4, fifth F = 7.
    expect(voiceTriad(cMaj, 'close')).toEqual([36, 40, 43]); // C2 E2 G2
    expect(voiceTriad(cMaj, 'bassTriad')).toEqual([36, 48, 52, 55]); // C2 + C3 E3 G3
    expect(voiceTriad(cMaj, 'spread')).toEqual([36, 43, 52, 48]); // root, 5th, 3rd+oct, root+oct
    expect(voiceTriad(cMaj, 'shell')).toEqual([36, 40, 55]); // root, 3rd, high 5th
    expect(voiceTriad(cMaj, 'power')).toEqual([36, 43, 48]); // root, 5th, octave
  });

  it('is quality-agnostic — reads the third/fifth from the triad', () => {
    // A minor triad A3 C4 E4: third = 3 (minor), fifth = 7. bass = 57 - 12 = 45.
    expect(voiceTriad([57, 60, 64], 'close')).toEqual([45, 48, 52]);
    // B diminished B3 D4 F4: third = 3, fifth = 6.
    expect(voiceTriad([59, 62, 65], 'close')).toEqual([47, 50, 53]);
  });

  it('tracks the keyboard octave shift', () => {
    expect(voiceTriad(cMaj, 'close', 1)).toEqual([48, 52, 55]); // +12 everywhere
    expect(voiceTriad(cMaj, 'close', -1)).toEqual([24, 28, 31]);
  });

  it('returns [] for a non-triad input', () => {
    expect(voiceTriad([], 'spread')).toEqual([]);
    expect(voiceTriad([60, 64], 'spread')).toEqual([]);
  });
});

describe('renderGains', () => {
  it('sustained holds all voices', () => {
    expect(renderGains(4, 'sustained', 0, 0)).toEqual([1, 1, 1, 1]);
    expect(renderGains(4, 'sustained', 3.7, 5)).toEqual([1, 1, 1, 1]);
  });

  it('arpUp lights one voice per eighth-note step, cycling', () => {
    expect(renderGains(4, 'arpUp', 0, 0)).toEqual([1, 0, 0, 0]);
    expect(renderGains(4, 'arpUp', 0.5, 0)).toEqual([0, 1, 0, 0]); // step 1
    expect(renderGains(4, 'arpUp', 1.0, 0)).toEqual([0, 0, 1, 0]); // step 2
    expect(renderGains(4, 'arpUp', 2.0, 0)).toEqual([1, 0, 0, 0]); // step 4 wraps
  });

  it('arpUpDown ping-pongs without doubling the endpoints', () => {
    const idx = (beat: number) => renderGains(4, 'arpUpDown', beat, 0).indexOf(1);
    // steps 0..5 over a 4-voice ping-pong cycle (length 6): 0,1,2,3,2,1
    expect([0, 0.5, 1.0, 1.5, 2.0, 2.5].map(idx)).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it('pulse re-articulates: on early in the step, off in the tail', () => {
    expect(renderGains(3, 'pulse', 0, 0)).toEqual([1, 1, 1]); // frac 0 < gate
    // beat 0.45 → stepF 0.9 → frac 0.9 ≥ 0.85 gate → silent tail
    expect(renderGains(3, 'pulse', 0.45, 0)).toEqual([0, 0, 0]);
  });

  it('alberti plays low, high, mid, high', () => {
    const idx = (beat: number) => renderGains(4, 'alberti', beat, 0).indexOf(1);
    expect([0, 0.5, 1.0, 1.5].map(idx)).toEqual([0, 3, 1, 3]);
  });

  it('strum staggers onsets from the chord change, then sustains', () => {
    expect(renderGains(4, 'strum', 0, 0)).toEqual([1, 0, 0, 0]); // only the bass at t=0
    expect(renderGains(4, 'strum', 0, 0.025)).toEqual([1, 1, 0, 0]); // 2nd voice in
    expect(renderGains(4, 'strum', 0, 0.1)).toEqual([1, 1, 1, 1]); // fully rolled
  });

  it('classifies tempo vs non-tempo renderings', () => {
    expect(isTempoRendering('sustained')).toBe(false);
    expect(isTempoRendering('strum')).toBe(false);
    expect(isTempoRendering('arpUp')).toBe(true);
    expect(isTempoRendering('pulse')).toBe(true);
  });
});
