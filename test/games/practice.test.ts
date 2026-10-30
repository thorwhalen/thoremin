/**
 * The practice knobs (`@thoremin/games/tuning`): one smoothing number scales every cursor's filters
 * (0.5 = the measured defaults); a pop round's balloons grow or shrink and their hold changes while
 * it runs; a balloon too hard is skipped; the maze's openings widen. All on scripted voices.
 */
import { describe, it, expect } from 'vitest';
import { hzOf } from '@thoremin/judge';
import { createPitchCursor, pitchX, semitoneOfX } from '@thoremin/games/cursor';
import { createPopSession } from '@thoremin/games/pop';
import { createTrackSession, wallsOf } from '@thoremin/games/maze';
import { smoothingFactor, smoothedAt } from '@thoremin/games/tuning';
import { createVowelCursor } from '@thoremin/games/vowels';
import { createLoudnessScale } from '@thoremin/games/loudness';
import type { FieldView } from '@thoremin/games/field';
import type { Heard, HeardPitch } from '@thoremin/games/listen';

const TICK = 1 / 60;

function run(s: { tick: (now: number, heard: Heard) => { view: FieldView } }, pitch: (a: number, b: number) => HeardPitch[], t0: number, t1: number, at?: { t: number; then: () => void }): FieldView {
  let last!: FieldView;
  let prev = t0 - TICK;
  for (let now = t0; now <= t1 + 1e-9; now += TICK) {
    if (at && prev < at.t && now >= at.t) at.then();
    last = s.tick(now, { pitch: pitch(prev, now), onsets: [] }).view;
    prev = now;
  }
  return last;
}

const sung = (midi: number, from = 0, to = 10) => (a: number, b: number) => {
  const out: HeardPitch[] = [];
  for (let t = Math.ceil(a * 100) / 100; t <= b; t += 0.01) if (t > a && t >= from && t < to) out.push({ t, f0: hzOf(midi), clarity: 0.9, rms: 0.05 });
  return out;
};

const backdrop = { columns: [] };
const balloon = (semis: number) => ({ x: pitchX(60 + semis), y: 0.5, r: 0.04 });

describe('smoothing', () => {
  it('0.5 is the defaults; each end is three octaves of cutoff away', () => {
    expect(smoothingFactor(0.5)).toBe(1);
    expect(smoothingFactor(0)).toBe(8);
    expect(smoothingFactor(1)).toBe(1 / 8);
    expect(smoothedAt({ minCutoff: 1.5, beta: 0.02 }, 1)).toEqual({ minCutoff: 1.5 / 8, beta: 0.02 / 8 });
  });

  it('a steadier cursor follows a leap more slowly, and is retuned while it runs', () => {
    const after = (smoothing: number) => {
      const c = createPitchCursor({ smoothing });
      let x = 0;
      for (let t = 0; t < 1; t += 0.01) x = c.push({ pitch: [{ t, f0: hzOf(t < 0.5 ? 60 : 64), clarity: 0.9 }], onsets: [] }, t)!.x;
      return semitoneOfX(x);
    };
    // Half a second after a leap of four semitones.
    expect(after(0)).toBeGreaterThan(after(1) + 0.5);
    const c = createPitchCursor({ smoothing: 1 });
    c.tune!({ smoothing: 0 });
    let x = 0;
    for (let t = 0; t < 1; t += 0.01) x = c.push({ pitch: [{ t, f0: hzOf(t < 0.5 ? 60 : 64), clarity: 0.9 }], onsets: [] }, t)!.x;
    expect(semitoneOfX(x)).toBeCloseTo(after(0), 5);
  });

  it('retuning mid-note does not move the dot', () => {
    const c = createPitchCursor({ smoothing: 0.5 });
    let x = 0;
    for (let t = 0; t < 1; t += 0.01) {
      if (Math.abs(t - 0.5) < 0.005) c.tune!({ smoothing: 1 });
      const next = c.push({ pitch: [{ t, f0: hzOf(t < 0.3 ? 60 : 62), clarity: 0.9 }], onsets: [] }, t)!.x;
      if (t > 0.3) expect(Math.abs(semitoneOfX(next) - semitoneOfX(x))).toBeLessThan(0.3);
      x = next;
    }
  });

  it('the vowel cursor takes the knob too: a steadier one is still on its way from [i] to [a]', () => {
    const after = (smoothing: number, retuned?: number) => {
      const c = createVowelCursor({ smoothing, voice: 'lower', loudness: createLoudnessScale({ mode: 'normal' }) });
      if (retuned !== undefined) c.tune!({ smoothing: retuned });
      let x = 0;
      // [i] for half a second, then [a] for a fifth: the dot moves right (back) and down.
      for (let t = 0; t < 0.7; t += 0.01) {
        const [f1, f2] = t < 0.5 ? [280, 2250] : [750, 1300];
        x = c.push({ pitch: [], onsets: [], formants: [{ t, f1, f2, f3: 2700, rms: 0.05 }] }, t)!.x;
      }
      return x;
    };
    expect(after(0)).toBeGreaterThan(after(1) + 0.05);
    expect(after(1, 0)).toBeCloseTo(after(0), 5);
  });
});

describe('a pop round with practice knobs', () => {
  it('a balloon a little off the voice pops once it is made bigger, mid-round', () => {
    // Sung 0.6 semitone sharp of C: 0.05 across, outside a 0.04 balloon, inside one twice that.
    const make = () => createPopSession({ title: 't', start: 0, targets: [balloon(0)], cursor: createPitchCursor(), backdrop, wrapX: true, aspect: 1, holdS: 0.5 });
    expect(run(make(), sung(60.6), 0, 2).score.done).toBe(0);
    const s = make();
    const v = run(s, sung(60.6), 0, 2, { t: 0.5, then: () => s.tune({ sizeScale: 2 }) });
    expect(v.score.done).toBe(1);
  });

  it('a shorter hold, set while it runs, pops sooner', () => {
    const s = createPopSession({ title: 't', start: 0, targets: [balloon(0)], cursor: createPitchCursor(), backdrop, wrapX: true, aspect: 1, holdS: 3 });
    expect(run(s, sung(60), 0, 1, { t: 0.2, then: () => s.tune({ holdS: 0.4 }) }).score.done).toBe(1);
  });

  it('skips the oldest balloon, or the one named; the round ends when none is left', () => {
    const s = createPopSession({ title: 't', start: 0, targets: [balloon(0), balloon(4), balloon(7)], cursor: createPitchCursor(), backdrop, wrapX: true, aspect: 1, atOnce: 2 });
    run(s, () => [], 0, 0.1);
    expect(s.skip()).toBe(true);
    let v = run(s, () => [], 0.1, 0.2);
    expect(v.targets.map((t) => t.id)).toEqual([1, 2]);
    expect(s.skip(2)).toBe(true);
    expect(s.skip(2)).toBe(false);
    expect(run(s, sung(64), 0.2, 2).phase).toBe('results');
    v = run(s, () => [], 2, 2.1);
    expect(v.results!.counts).toEqual({ popped: 1, skipped: 2, missed: 0 });
    // The running count leaves the skipped ones out.
    expect(v.score).toMatchObject({ done: 1, total: 1 });
    expect(v.results!.summary).toMatch(/^1 of 3 popped, 2 skipped/);
  });
});

describe('the maze with wider openings', () => {
  it('the openings drawn and tested are the knob times wider', () => {
    const s = createTrackSession({ title: 't', start: 0, segments: wallsOf([60, 64]), cursor: createPitchCursor(), backdrop });
    const w0 = run(s, () => [], 0, 0.1).maze!.segments[0].gapW;
    s.tune({ sizeScale: 2 });
    expect(run(s, () => [], 0.1, 0.2).maze!.segments[0].gapW).toBeCloseTo(2 * w0);
  });
});
