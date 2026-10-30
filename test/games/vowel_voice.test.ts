/**
 * The Vowels page's voice, both ways. Out: the cascade formant synthesiser sounds every primary
 * vowel so the formant analyser hears it as itself. In: sung vowels (VocalSet, two singers,
 * `test/fixtures/audio_games_vocalset`) through the vowel cursor, without and with the player's
 * calibration (fitted on their scales takes, scored on their separate arpeggio takes, sung with
 * vibrato), and the calibration session fed the same recordings.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWav } from '../../scripts/cue/lib_pair_take';
import { calibrateFrom, formantFrames, scoreVowel } from '../../scripts/audio_games/lib_vowels';
import { cascadeOf, levelFor, renderVowel } from '@thoremin/games/formant_synth';
import { createFormantAnalyser } from '@thoremin/sdk/audio/formants';
import { runOffline } from '@thoremin/sdk/audio/offline';
import type { FormantEvent } from '@thoremin/sdk/audio/types';
import { applyVoice, CALIBRATION_VOWELS, createVowelCursor, fitVoice, formantsAt, nearestVowel, PRIMARY_VOWELS, TRAPEZOID, vowelAt, vowelByIpa, vowelMarks, vowelPoint } from '@thoremin/games/vowels';
import { createVowelCalibration } from '@thoremin/games/vowel_calibration';

const DIR = 'test/fixtures/audio_games_vocalset';
const SINGERS = ['m2', 'f1'] as const;
const wav = (name: string) => parseWav(new Uint8Array(readFileSync(`${DIR}/${name}.wav`)));
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const primary = PRIMARY_VOWELS.map((ipa) => vowelByIpa(ipa)!);
const mapOf = (s: string) => calibrateFrom({ a: wav(`${s}_scales_straight_a`), i: wav(`${s}_scales_straight_i`), u: wav(`${s}_scales_straight_u`) });

describe('the cascade formant synthesiser', () => {
  it('sounds every primary vowel so the analyser hears it as itself', () => {
    for (const ipa of PRIMARY_VOWELS) {
      const want = formantsAt(vowelAt(vowelByIpa(ipa)!));
      const pcm = renderVowel(want, { seconds: 0.6 });
      const ev = runOffline(createFormantAnalyser(48000), pcm).events.filter((e) => e.kind === 'formants' && e.f1 && e.f2) as FormantEvent[];
      const f1 = med(ev.map((e) => e.f1!));
      const f2 = med(ev.map((e) => e.f2!));
      expect(Math.abs(f1 / want.f1 - 1), `${ipa} F1`).toBeLessThan(0.1);
      expect(Math.abs(f2 / want.f2 - 1), `${ipa} F2`).toBeLessThan(0.1);
      expect(nearestVowel(vowelPoint(f1, f2), primary).ipa).toBe(ipa);
    }
  });

  it('keeps every vowel equally loud and inside full scale', () => {
    const peaks = PRIMARY_VOWELS.map((ipa) => renderVowel(formantsAt(vowelAt(vowelByIpa(ipa)!)), { seconds: 0.3 }).reduce((m, x) => Math.max(m, Math.abs(x)), 0));
    expect(Math.max(...peaks)).toBeLessThan(1);
    expect(Math.max(...peaks) / Math.min(...peaks)).toBeLessThan(2.5);
    expect(levelFor(cascadeOf({ f1: 300, f2: 2300, f3: 3000 }), 130)).toBeGreaterThan(0);
  });
});

describe('the player calibration', () => {
  it('fits three vowels exactly: each lands on the place it was asked for', () => {
    // A voice with a small vowel space: every formant pulled 40 % of the way to the middle.
    const squeeze = (f: { f1: number; f2: number }) => ({ f1: 500 + 0.6 * (f.f1 - 500), f2: 1500 + 0.6 * (f.f2 - 1500) });
    const samples = CALIBRATION_VOWELS.map((c) => ({ place: c.place, ...squeeze(formantsAt(c.place)) }));
    const m = fitVoice(samples);
    for (const s of samples) {
      const ref = applyVoice(m, s.f1, s.f2);
      const p = vowelPoint(ref.f1, ref.f2);
      expect(Math.hypot(p.x - s.place.x, p.y - s.place.y)).toBeLessThan(0.01);
    }
  });

  it('refuses fewer than three vowels, or three alike', () => {
    expect(() => fitVoice(CALIBRATION_VOWELS.slice(0, 2).map((c) => ({ place: c.place, f1: 300, f2: 2000 })))).toThrow(/three/);
    expect(() => fitVoice(CALIBRATION_VOWELS.map((c) => ({ place: c.place, f1: 400, f2: 1500 })))).toThrow(/alike/);
  });

  it('on sung vowels: the textbook map misses [i] and [u]; calibrated, the dot follows the singer', () => {
    const takes = ['a', 'e', 'i', 'o', 'u'] as const;
    for (const s of SINGERS) {
      const plain = Object.fromEntries(takes.map((v) => [v, scoreVowel(wav(`${s}_arpeggios_vibrato_${v}`).pcm, 11025, v)]));
      const calibration = mapOf(s);
      const fitted = Object.fromEntries(takes.map((v) => [v, scoreVowel(wav(`${s}_arpeggios_vibrato_${v}`).pcm, 11025, v, { calibration })]));
      // The reason for calibrating (measured, not assumed): a sung [i] reads as [e], a sung [u] as [o].
      expect(plain.i.on, `${s} plain i`).toBeLessThan(0.2);
      expect(plain.u.on, `${s} plain u`).toBeLessThan(0.2);
      // Floors under what the calibrated cursor does on these held-out takes (see measure_vowels.ts).
      expect(fitted.i.on, `${s} i`).toBeGreaterThan(0.9);
      expect(fitted.u.on, `${s} u`).toBeGreaterThan(0.35);
      const mean = takes.reduce((acc, v) => acc + fitted[v].on, 0) / takes.length;
      expect(mean, `${s} mean`).toBeGreaterThan(0.7);
      // Steady: the dot's 90th-percentile step per 10 ms stays near 5 % of the chart's width (the
      // chart spans 0.94 of the plane, so 0.06 of it).
      for (const v of takes) expect(fitted[v].stepP90, `${s} ${v} step`).toBeLessThan(0.06);
    }
  });
});

describe('the vowel cursor across vowels', () => {
  it('keeps the dot live on a soft [u] sung after a loud [a]', () => {
    const calibration = mapOf('m2');
    const cursor = createVowelCursor({ calibration });
    let live = 0;
    let total = 0;
    let t0 = 0;
    for (const v of ['a', 'u']) {
      const frames = formantFrames(wav(`m2_arpeggios_vibrato_${v}`).pcm, 11025);
      for (const f of frames) {
        const c = cursor.push({ pitch: [], onsets: [], formants: [{ ...f, t: f.t + t0 }] }, f.t + t0);
        if (v === 'u' && f.f1 !== null) {
          total++;
          if (c?.live) live++;
        }
      }
      t0 += 3.2;
    }
    expect(live / total).toBeGreaterThan(0.8);
  });
});

describe('the calibration session', () => {
  it('asks for ee, oo and ah in turn, then fits a map', () => {
    const backdrop = { outline: TRAPEZOID, marks: vowelMarks(), xLabel: '' };
    const cal = createVowelCalibration({ start: 0, backdrop });
    // The singer's three corner takes, one after another, ticked every 50 ms like a page.
    const order = { i: 'i', u: 'u', ä: 'a' } as Record<string, string>;
    let t = 0;
    const titles = new Set<string>();
    let clicks = 0;
    for (const [k, step] of CALIBRATION_VOWELS.entries()) {
      // Each take is fed until the session moves on (two seconds of voice), like a singer stopping.
      const frames = formantFrames(wav(`m2_scales_straight_${order[step.ipa]}`).pcm, 11025).map((f) => ({ ...f, t: f.t + t }));
      const end = frames[frames.length - 1].t;
      let now = t;
      let done = false;
      for (; now <= end + 0.05 && !done; now += 0.05) {
        const heard = { pitch: [], onsets: [], formants: frames.filter((f) => f.t > now - 0.05 && f.t <= now) };
        const { view, cues } = cal.tick(now, heard);
        titles.add(view.title);
        clicks += cues.length;
        done = cues.length > 0;
        if (!done) expect(view.targets[0].label).toBe(step.ipa);
      }
      expect(done, `${step.word} taken`).toBe(true);
      expect(k).toBeLessThan(3);
      t = now + 0.1;
    }
    expect([...titles]).toEqual(['Your vowels: 1 of 3', 'Your vowels: 2 of 3', 'Your vowels: 3 of 3', 'Your vowels']);
    expect(clicks).toBe(3);
    const m = cal.result();
    expect(m).not.toBeNull();
    // The map it fitted places the singer's held-out [i] on [i].
    expect(scoreVowel(wav('m2_arpeggios_vibrato_i').pcm, 11025, 'i', { calibration: m! }).on).toBeGreaterThan(0.9);
  });
});
