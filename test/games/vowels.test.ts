/**
 * The vowel games' pieces on real speech: the formant analyser over eight cardinal vowels
 * (Commons recordings, `test/fixtures/audio_games_vowels`) against the reference formants, the
 * chart map placing each recording nearest its own vowel, the inverse map sounding a point back
 * at it, and the vowel cursor and Vowel Pop through the analyser's events.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWav } from '../../scripts/cue/lib_pair_take';
import { createFormantAnalyser, formantsOf } from '@thoremin/sdk/audio/formants';
import { runOffline } from '@thoremin/sdk/audio/offline';
import type { FormantEvent } from '@thoremin/sdk/audio/types';
import { createVowelCursor, formantsAt, nearestVowel, PRIMARY_VOWELS, TRAPEZOID, vowelAt, vowelByIpa, vowelCourse, vowelPoint, VOWEL_POP_LEVELS, VOWELS } from '@thoremin/games/vowels';
import { createPopSession } from '@thoremin/games/pop';
import type { HeardFormants } from '@thoremin/games/listen';

const FILES: Record<string, string> = { i: 'i', e: 'e', ɛ: 'epsilon', a: 'a', ɑ: 'alpha', ɔ: 'open-o', o: 'o', u: 'u' };
const primary = PRIMARY_VOWELS.map((ipa) => vowelByIpa(ipa)!);

function analyse(ipa: string): { frames: HeardFormants[]; duration: number } {
  const w = parseWav(new Uint8Array(readFileSync(`test/fixtures/audio_games_vowels/${FILES[ipa]}.wav`)));
  const run = runOffline(createFormantAnalyser(w.sampleRate), w.pcm);
  const frames = (run.events.filter((e) => e.kind === 'formants') as FormantEvent[]).map((e) => ({ t: e.frame / w.sampleRate, f1: e.f1, f2: e.f2, f3: e.f3, rms: e.rms }));
  return { frames, duration: w.pcm.length / w.sampleRate };
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('the formant analyser', () => {
  it('finds the formants of a synthetic two-resonance vowel', () => {
    // A 120 Hz pulse train through resonances at 500 and 1500 Hz, at 11025 Hz.
    const rate = 11025;
    const n = Math.round(0.025 * rate);
    const x = new Float64Array(n + 2000);
    const res = (f: number, bw: number) => ({ r: Math.exp((-Math.PI * bw) / rate), th: (2 * Math.PI * f) / rate });
    const rs = [res(500, 80), res(1500, 100)];
    const y1 = [0, 0];
    const y2 = [0, 0];
    for (let i = 0; i < x.length; i++) {
      let s = i % Math.round(rate / 120) === 0 ? 1 : 0;
      rs.forEach((q, k) => {
        const y = s + 2 * q.r * Math.cos(q.th) * y1[k] - q.r * q.r * y2[k];
        y2[k] = y1[k];
        y1[k] = y;
        s = y;
      });
      x[i] = s * 0.01;
    }
    const est = formantsOf(x.subarray(x.length - n), rate);
    expect(Math.abs(est.f1! - 500)).toBeLessThan(60);
    expect(Math.abs(est.f2! - 1500)).toBeLessThan(120);
  });

  it('on the eight recorded cardinal vowels, lands near the reference formants', () => {
    for (const ipa of PRIMARY_VOWELS) {
      const { frames } = analyse(ipa);
      const ok = frames.filter((f) => f.f1 !== null && f.f2 !== null);
      expect(ok.length).toBeGreaterThan(40);
      const ref = vowelByIpa(ipa)!;
      // F1 within 25 %, F2 within 30 % of Catford's values: one speaker against a textbook voice.
      expect(Math.abs(med(ok.map((f) => f.f1!)) / ref.f1! - 1), `${ipa} F1`).toBeLessThan(0.25);
      expect(Math.abs(med(ok.map((f) => f.f2!)) / ref.f2! - 1), `${ipa} F2`).toBeLessThan(0.3);
    }
  });

  it('is cheap enough for the audio thread', () => {
    const w = parseWav(new Uint8Array(readFileSync('test/fixtures/audio_games_vowels/a.wav')));
    const big = new Float32Array(48000);
    for (let i = 0; i < big.length; i++) big[i] = w.pcm[i % w.pcm.length];
    const run = runOffline(createFormantAnalyser(48000), big);
    const sorted = [...run.quantumMs].sort((a, b) => a - b);
    // The median quantum well under the 2.67 ms a quantum lasts at 48 kHz.
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(0.5);
  });
});

describe('the vowel chart', () => {
  it('places each recorded vowel nearest its own place among the eight', () => {
    for (const ipa of PRIMARY_VOWELS) {
      const ok = analyse(ipa).frames.filter((f) => f.f1 !== null && f.f2 !== null);
      const p = vowelPoint(med(ok.map((f) => f.f1!)), med(ok.map((f) => f.f2!)));
      expect(nearestVowel(p, primary).ipa, ipa).toBe(ipa);
    }
  });

  it('inverts: the formants drawn at a vowel’s place map back to it', () => {
    for (const w of VOWELS) {
      const q = vowelAt(w);
      const f = formantsAt(q);
      const back = vowelPoint(f.f1, f.f2);
      expect(Math.hypot(back.x - q.x, back.y - q.y), w.ipa).toBeLessThan(0.02);
      expect(f.f2).toBeGreaterThan(f.f1);
    }
  });

  it('puts close vowels high and front vowels left, inside the plane', () => {
    expect(vowelAt(vowelByIpa('i')!).y).toBeGreaterThan(vowelAt(vowelByIpa('a')!).y);
    expect(vowelAt(vowelByIpa('i')!).x).toBeLessThan(vowelAt(vowelByIpa('u')!).x);
    for (const c of TRAPEZOID) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(1);
    }
  });
});

describe('Vowel Pop', () => {
  it('a recording pops its own balloon (an easy one) and not a far one', () => {
    // This speaker's [a] is a central one (F2 1318 Hz against the textbook 1610), 0.17 off [a]'s place:
    // nearest its own place among the eight (above), but outside even an easy balloon.
    for (const [ipa, far] of [['i', 'ɑ'], ['u', 'a'], ['ɛ', 'u'], ['ɔ', 'i']] as const) {
      const { frames, duration } = analyse(ipa);
      const balloons = [ipa, far].map((x) => ({ ...vowelAt(vowelByIpa(x)!), r: VOWEL_POP_LEVELS.easy.r, label: x }));
      const s = createPopSession({ game: 'vowels', title: 't', start: 0, targets: balloons, cursor: createVowelCursor({ voice: 'lower' }), backdrop: {}, aspect: 1, atOnce: 2, holdS: 0.3 });
      let last = s.tick(0).view;
      for (let now = 1 / 60; now <= duration; now += 1 / 60) last = s.tick(now, { pitch: [], onsets: [], formants: frames.filter((f) => f.t > now - 1 / 60 && f.t <= now) }).view;
      const state = Object.fromEntries(last.targets.map((t) => [t.label, t.state]));
      expect(state[ipa], `${ipa} pops`).toBe('popped');
      expect(state[far], `${far} stays`).toBe('live');
    }
  });
});

describe('a Vowel Pop course', () => {
  it('has each vowel once per round, at its place, labelled', () => {
    const c = vowelCourse({ r: 0.1, rounds: 2, seed: 3 });
    expect(c).toHaveLength(16);
    expect(new Set(c.slice(0, 8).map((b) => b.label))).toEqual(new Set(PRIMARY_VOWELS));
    for (const b of c) expect(b).toMatchObject(vowelAt(vowelByIpa(b.label)!));
  });
});
