/**
 * The YIN pitch estimator (`@thoremin/sdk/audio/pitch`): exact on synthetic tones, silent on noise,
 * and measured on real singing (two vocadito excerpts, CC BY 4.0: a low male voice and a high
 * voice) against their frame-level f0 annotation.
 */
import { describe, it, expect } from 'vitest';
import { createPitchTracker, windowFor, yin } from '@thoremin/sdk/audio/pitch';
import { runAnalysers } from '@thoremin/sdk/audio/analysers';
import { loadAudioFixture, inBlocks } from '../helpers/audio_fixtures';
import { seeded } from '../helpers/random';

const SR = 22050;
const tone = (hz: number, seconds: number, harmonics = [1]) =>
  Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) =>
    harmonics.reduce((s, a, k) => s + (0.3 * a * Math.sin((2 * Math.PI * hz * (k + 1) * i) / SR)) / harmonics.length, 0),
  );
const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

describe('yin over one window', () => {
  it('finds a sine within two cents and a harmonic tone within five, across the range', () => {
    for (const hz of [82.4, 110, 220, 440, 880, 1200]) {
      const sine = yin(tone(hz, 0.06), SR);
      // Parabolic refinement leaves about a cent at the top, where a period is 18 samples.
      expect(Math.abs(cents(sine.f0!, hz))).toBeLessThan(2);
      expect(sine.clarity).toBeGreaterThan(0.95);
      // A strong second harmonic is where autocorrelation slips an octave; YIN must not.
      const rich = yin(tone(hz, 0.06, [1, 1.5, 0.8, 0.5]), SR);
      expect(Math.abs(cents(rich.f0!, hz))).toBeLessThan(5);
    }
  });

  it('hears noise and silence as unvoiced', () => {
    const rnd = seeded(7);
    const noise = Float32Array.from({ length: 1400 }, () => 0.3 * (rnd() * 2 - 1));
    expect(yin(noise, SR).f0).toBeNull();
    const silence = yin(new Float32Array(1400), SR);
    expect(silence.f0).toBeNull();
    expect(silence.clarity).toBe(0);
  });

  it('sizes its window from the lowest pitch', () => {
    expect(windowFor(22050, 70)).toBe(630);
    expect(windowFor(48000, 100)).toBe(960);
  });
});

describe('the streaming tracker', () => {
  it('estimates once per hop, stamped at the window centre, whatever the block size', () => {
    const x = tone(330, 1);
    const run = (block: number) => {
      const tr = createPitchTracker({ sampleRate: SR });
      return inBlocks(x, SR, block, (b, t0) => tr.push(b, t0));
    };
    const a = run(128);
    const b = run(1000);
    expect(a.length).toBe(b.length);
    a.forEach((f, i) => expect(f.t).toBeCloseTo(b[i].t, 9));
    const tr = createPitchTracker({ sampleRate: SR });
    // The first window completes at sample `window - 1`; its centre is half a window before its end.
    expect(a[0].t).toBeCloseTo(tr.window / SR - tr.window / (2 * SR), 6);
    expect(a[1].t - a[0].t).toBeCloseTo(tr.hop / SR, 6);
    expect(a.every((f) => Math.abs(cents(f.f0!, 330)) < 1)).toBe(true);
  });

  it('starts over after reset', () => {
    const tr = createPitchTracker({ sampleRate: SR });
    tr.push(tone(330, 0.05), 0);
    tr.reset();
    expect(tr.push(tone(330, 0.02), 1)).toEqual([]);
  });
});

describe('real singing (vocadito)', () => {
  // Raw pitch accuracy within 50 cents on the frames both call voiced, voicing recall, and false
  // voicing on the reference's silent frames, with a clarity gate of 0.5 (the judge's default).
  // Measured at the default threshold: low voice 0.967 / 0.895 / 0.055, high voice 0.989 / 0.930 / 0.000.
  for (const name of ['audio_games_vocadito_28', 'audio_games_vocadito_2']) {
    it(name, () => {
      const fx = loadAudioFixture(name);
      const tr = createPitchTracker({ sampleRate: fx.wav.sampleRate });
      const frames = inBlocks(fx.wav.pcm, fx.wav.sampleRate, 128, (b, t0) => tr.push(b, t0));
      let both = 0;
      let ok = 0;
      let refVoiced = 0;
      let recalled = 0;
      let refSilent = 0;
      let falseVoiced = 0;
      let k = 0;
      for (const r of fx.f0) {
        while (k + 1 < frames.length && Math.abs(frames[k + 1].t - r.t) <= Math.abs(frames[k].t - r.t)) k++;
        const f = frames[k];
        if (Math.abs(f.t - r.t) > 0.006) continue;
        const voiced = f.f0 !== null && f.clarity >= 0.5;
        if (r.hz > 0) {
          refVoiced++;
          if (voiced) {
            recalled++;
            both++;
            if (Math.abs(cents(f.f0!, r.hz)) <= 50) ok++;
          }
        } else {
          refSilent++;
          if (voiced) falseVoiced++;
        }
      }
      expect(refVoiced).toBeGreaterThan(400);
      expect(ok / both).toBeGreaterThan(0.95);
      expect(recalled / refVoiced).toBeGreaterThan(0.85);
      expect(falseVoiced / Math.max(1, refSilent)).toBeLessThan(0.1);
    });
  }
});

describe('the pitch analyser on the audio thread (runAnalysers, the worklet loop offline)', () => {
  it('posts the same estimates as the tracker, one per hop, stamped at the window centre frame', () => {
    const fx = loadAudioFixture('audio_games_vocadito_2');
    const sr = fx.wav.sampleRate;
    const events = runAnalysers(fx.wav.pcm, sr, [{ name: 'pitch' }]).map((e) => e.event);
    const tr = createPitchTracker({ sampleRate: sr });
    const frames = inBlocks(fx.wav.pcm, sr, 128, (b, t0) => tr.push(b, t0));
    expect(events.every((e) => e.kind === 'pitch')).toBe(true);
    expect(events.length).toBe(frames.length);
    events.forEach((e, i) => {
      if (e.kind !== 'pitch') return;
      expect(e.frame / sr).toBeCloseTo(frames[i].t, 6);
      expect(e.f0 === null).toBe(frames[i].f0 === null);
      if (e.f0 !== null) expect(e.f0).toBeCloseTo(frames[i].f0!, 6);
      expect(e.clarity).toBeCloseTo(frames[i].clarity, 9);
    });
  });
});
