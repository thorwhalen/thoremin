/**
 * The pattern follower (#269): playback snaps each hit to the pattern's grid at the
 * player's running tempo with their learned feel put back. On a synthetic player whose
 * tempo drifts and whose snare is late: every hit is taken as its own event (the struck
 * pad decides), the snapped time sits on the grid plus the feel, the grid keeps up with
 * the drift, and a hit nowhere near an event sounds as struck.
 */
import { describe, expect, it } from 'vitest';
import { patternById } from '@/music/drum_patterns';
import { fitPattern, type HitSample } from '@/drums/pattern_fit';
import { createPatternFollower } from '@/drums/pattern_play';
import type { PadId } from '@/nodes/music/drum_pads';

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
const gauss = (r: () => number, sd: number) => (r() + r() + r() - 1.5) * sd * 1.41;

const ROCK = patternById('rock')!;
const PADS: Record<string, PadId> = { kick: 'p6', snare: 'p1', hihat: 'p2' };
const FEEL: Record<number, number> = { 3: 0.05, 9: 0.05 };

/** A take: the pattern from `start`, `passes` times, tempo drifting `drift` bpm a pass,
 *  with the feel and jitter; each hit remembers the grid time it was meant for. */
function take(bpm: number, drift: number, passes: number, start: number, seed: number) {
  const r = rng(seed);
  const hits: (HitSample & { grid: number; event: number; feelS: number })[] = [];
  let t0 = start;
  for (let pass = 0; pass < passes; pass++) {
    const period = 60 / (bpm + drift * pass);
    for (const e of ROCK.events) {
      const grid = t0 + e.beat * period;
      const feelS = (FEEL[e.index] ?? 0) * period;
      hits.push({ t: grid + feelS + gauss(r, 0.012) * period, sound: e.sound, pad: PADS[e.drum], x: 0.5, y: 0.6, grid, event: e.index, feelS });
    }
    t0 += ROCK.lengthBeats * period;
  }
  return hits.sort((a, b) => a.t - b.t);
}

describe('the pattern follower', () => {
  const training = take(96, 0, 4, 1, 3);
  const model = fitPattern(training, ROCK, { statedBpm: 96 })!;

  it('snaps every hit of a drifting take to its own event on the grid, feel kept', () => {
    expect(model).not.toBeNull();
    const follower = createPatternFollower({ pattern: ROCK, model });
    const live = take(96, -1.5, 6, 10, 8);
    follower.start(10);
    let wrongEvent = 0;
    const errors: number[] = [];
    const snareFeel: number[] = [];
    for (const h of live) {
      const s = follower.snap(h.t, { sound: h.sound, pad: h.pad });
      if (s.event !== h.event) wrongEvent += 1;
      if (s.grid !== null) errors.push(s.at - (h.grid + h.feelS));
      if (h.event === 3 && s.grid !== null) snareFeel.push(s.feel);
    }
    expect(wrongEvent).toBe(0);
    // The snapped hit sits where the player MEANT it (grid plus their feel), within a
    // few milliseconds even as the tempo drifts 7 bpm over the take.
    const rms = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
    expect(rms).toBeLessThan(0.012);
    expect(Math.max(...errors.map(Math.abs))).toBeLessThan(0.04);
    // The snare's learned lateness is applied, the kick's absence of one is not.
    expect(Math.min(...snareFeel)).toBeGreaterThan(0.015);
    expect(follower.state().tempo).toBeLessThan(93);
    expect(follower.state().tempo).toBeGreaterThan(86);
  });

  it('takes the struck pad as the drum, and leaves a hit nowhere near an event as struck', () => {
    const follower = createPatternFollower({ pattern: ROCK, model });
    follower.start(5);
    const period = 60 / 96;
    // The kick's pad at beat 1, where the pattern has a snare and a hi-hat: it is a
    // stray, no kick event is near, so the nearest event of another drum takes it last.
    const stray = follower.snap(5 + 1 * period, { sound: 'kick', pad: 'p6' });
    expect(stray.event).not.toBeNull();
    expect(stray.drum).not.toBe('kick');
    // The snare pad at beat 1 is the snare, and its feel is applied.
    const snare = follower.snap(5 + 1 * period + 0.01, { sound: 'snare', pad: 'p1' });
    expect(snare.drum).toBe('snare');
    expect(snare.feel).toBeGreaterThan(0);
    // Between events (three sixteenths after beat 1.5): unsnapped.
    const off = follower.snap(5 + 1.68 * period, { sound: 'hihat', pad: 'p2' });
    expect(off.event).toBeNull();
    expect(off.at).toBe(5 + 1.68 * period);
    expect(off.pull).toBe(0);
    // Before start: unsnapped.
    const cold = createPatternFollower({ pattern: ROCK, model });
    expect(cold.snap(1, {}).event).toBeNull();
    expect(cold.beat(1)).toBeNull();
    // The cursor: two beats after the start, within the tenth of a beat the stray
    // anchors above may have nudged the tempo by.
    expect(Math.abs(follower.beat(5 + 2 * period)! - 2)).toBeLessThan(0.15);
  });

  it('after a pause of more than a bar, the next hit is the one and the pattern starts over', () => {
    const follower = createPatternFollower({ pattern: ROCK, model });
    const period = 60 / 96;
    // Six beats of the pattern, then silence for three seconds, then back on the one.
    follower.start(10);
    const live = take(96, 0, 2, 10, 5).filter((h) => h.t < 10 + 6 * period);
    for (const h of live) follower.snap(h.t, { sound: h.sound, pad: h.pad });
    const resume = 10 + 6 * period + 3;
    const one = follower.snap(resume + 0.01, { sound: 'kick', pad: 'p6' });
    expect(one.drum).toBe('kick');
    expect(follower.beat(resume)).toBeCloseTo(0, 1);
    // The snare on two after the resume is the snare, not a kick three beats off.
    const two = follower.snap(resume + 1 * period + 0.02, { sound: 'snare', pad: 'p1' });
    expect(two.drum).toBe('snare');
    expect(two.feel).toBeGreaterThan(0);
    const three = follower.snap(resume + 2 * period, { sound: 'kick', pad: 'p6' });
    expect(three.drum).toBe('kick');
  });

  it('half magnetism moves a hit halfway to the grid', () => {
    const follower = createPatternFollower({ pattern: ROCK, model, magnetism: 0.5 });
    follower.start(5);
    const period = 60 / 96;
    const early = 5 + 2 * period - 0.03;
    const s = follower.snap(early, { sound: 'kick', pad: 'p6' });
    expect(s.drum).toBe('kick');
    expect(s.pull).toBeCloseTo((s.grid! + s.feel - early) / 2, 6);
  });
});
