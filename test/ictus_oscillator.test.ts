/**
 * The adaptive oscillator (src/ictus/oscillator.ts) on synthetic anchor trains: lock,
 * tracking under a tempo ramp, robustness to a dropped and a doubled anchor, the hold
 * state and the preparatory restart, and the attentional gate (a stray anchor far from
 * the beat moves the state less than one near it). No detector involved: these pin the
 * prior alone, so a detector regression cannot hide an oscillator one.
 */
import { describe, it, expect } from 'vitest';
import { createAdaptiveOscillator, kappaFromResultant, beatAt, wrapPhase, type Anchor } from '@/ictus';

const anchor = (t: number, confidence = 1): Anchor => ({ t, confidence, strength: 1, sharpness: 1, lateral: 0 });

/** Feed anchors at the given times, free-running (advance) every `dt` between them. */
function drive(osc: ReturnType<typeof createAdaptiveOscillator>, times: number[], dt = 1 / 30) {
  let t = 0;
  for (const at of times) {
    while (t + dt < at) {
      t += dt;
      osc.advance(t);
    }
    osc.update(anchor(at));
    t = at;
  }
}

describe('kappaFromResultant', () => {
  it('is monotone and spans the small/large-r regimes', () => {
    let prev = -1;
    for (let r = 0; r <= 0.99; r += 0.01) {
      const k = kappaFromResultant(r);
      expect(k).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(kappaFromResultant(0)).toBe(0);
    expect(kappaFromResultant(0.9)).toBeGreaterThan(5);
  });
});

describe('adaptive oscillator', () => {
  it('locks within three anchors on a steady train and reports the tempo', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6; // 100 bpm
    const times = Array.from({ length: 12 }, (_, i) => 1 + i * period);
    drive(osc, times.slice(0, 3));
    expect(osc.state().state).toBe('running');
    drive(osc, times.slice(3));
    const s = osc.state();
    expect(s.tempo).toBeCloseTo(100, 0);
    expect(s.confidence).toBeGreaterThan(0.7);
    // Right after an anchor the phase is ~0 and the next beat is one period away.
    expect(Math.abs(wrapPhase(s.phase))).toBeLessThan(0.05);
    expect(s.nextBeatAt).toBeCloseTo(times[times.length - 1] + period, 1);
  });

  it('predicts ahead: beatAt at the audio time extrapolates at the locked tempo', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.5;
    drive(osc, [1, 1.5, 2, 2.5, 3, 3.5]);
    const s = osc.state();
    expect(beatAt(s, s.t + period)).toBeCloseTo(s.beat + 1, 1);
    expect(beatAt(s, s.t + 0.25)).toBeCloseTo(s.beat + 0.5, 1);
  });

  it('tracks a linear accelerando from 80 to 120 bpm', () => {
    const osc = createAdaptiveOscillator();
    const times: number[] = [];
    let t = 1;
    for (let i = 0; i < 24; i++) {
      const bpm = 80 + (40 * i) / 23;
      times.push(t);
      t += 60 / bpm;
    }
    drive(osc, times);
    const s = osc.state();
    expect(s.tempo).toBeGreaterThan(110);
    expect(s.tempo).toBeLessThan(125);
    expect(s.state).toBe('running');
  });

  it('survives a dropped anchor: free-runs through it without entering hold, the tempo holds', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6;
    const times = Array.from({ length: 12 }, (_, i) => 1 + i * period).filter((_, i) => i !== 6);
    const states = new Set<string>();
    let t = 0;
    for (const at of times) {
      while (t + 1 / 30 < at) {
        t += 1 / 30;
        osc.advance(t);
        states.add(osc.state().state);
      }
      osc.update(anchor(at));
      t = at;
    }
    const s = osc.state();
    expect(s.tempo).toBeCloseTo(100, 0);
    expect(s.state).toBe('running');
    // A single missed beat (an anchor at two periods) is below the hold threshold.
    expect(states.has('hold')).toBe(false);
    // 11 anchors over 11 periods: the beat count is still ~11 (the missed beat was
    // free-run through, not lost).
    expect(Math.round(s.beat)).toBe(11);
  });

  it('a single mid-beat rebound (a weak anchor) does not flip the tempo to double', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6;
    const times = Array.from({ length: 8 }, (_, i) => 1 + i * period);
    drive(osc, times);
    const tEnd = times[times.length - 1];
    // The rebound: mid-beat, above the confidence floor but not a strong stroke.
    osc.update(anchor(tEnd + period / 2, 0.3));
    // Then the real beats continue.
    drive(osc, [1, 2, 3, 4].map((k) => tEnd + k * period));
    const s = osc.state();
    expect(s.tempo).toBeCloseTo(100, 0);
    expect(Math.round(s.beat)).toBe(11);
  });

  it('a lock seeded at half the real period recovers once the real beats arrive', () => {
    const osc = createAdaptiveOscillator();
    // Two anchors 0.3 s apart seed 200 bpm; the conductor is actually at 100 bpm.
    drive(osc, [1, 1.3]);
    drive(osc, Array.from({ length: 10 }, (_, i) => 1.3 + (i + 1) * 0.6));
    const s = osc.state();
    expect(s.state).toBe('running');
    expect(Math.abs(s.tempo - 100) / 100).toBeLessThan(0.08);
  });

  it('a doubled anchor (a rebound firing mid-beat) is gated by the attentional pulse', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6;
    const times = Array.from({ length: 10 }, (_, i) => 1 + i * period);
    drive(osc, times);
    const before = osc.state();
    // An anchor exactly mid-beat, at full confidence.
    drive(osc, [before.t + period / 2]);
    const after = osc.state();
    // Once locked the pulse is narrow: the period barely moves. (A mid-beat anchor has
    // phase error 0.5 where the gate is exp(-2κ); with κ well above 1 that is tiny.)
    expect(Math.abs(after.period - before.period) / before.period).toBeLessThan(0.02);
    // An anchor slightly late, on the other hand, does move it.
    const osc2 = createAdaptiveOscillator();
    drive(osc2, times);
    const b2 = osc2.state();
    drive(osc2, [b2.t + period * 1.1]);
    expect(osc2.state().period).toBeGreaterThan(b2.period);
  });

  it('enters hold when the beat stops, and a preparatory anchor restarts it at phase 0', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6;
    drive(osc, [1, 1.6, 2.2, 2.8, 3.4]);
    expect(osc.state().state).toBe('running');
    const lockedPeriod = osc.state().period;
    // Nothing for three periods.
    for (let t = 3.4; t < 3.4 + 3 * period; t += 1 / 30) osc.advance(t);
    const held = osc.state();
    expect(held.state).toBe('hold');
    expect(held.nextBeatAt).toBe(Infinity);
    expect(held.confidence).toBeLessThan(0.5);
    // Frozen: beatAt does not advance in hold.
    expect(beatAt(held, held.t + 10)).toBe(held.beat);
    // A preparatory beat restarts with the kept period and phase 0.
    osc.update(anchor(6));
    const restarted = osc.state();
    expect(restarted.state).toBe('running');
    expect(restarted.phase).toBe(0);
    expect(restarted.period).toBeCloseTo(lockedPeriod, 5);
  });

  it('does not seed a lock from an implausible first interval', () => {
    const osc = createAdaptiveOscillator();
    osc.update(anchor(1));
    osc.update(anchor(1.05)); // 1200 bpm: not a beat
    expect(osc.state().state).toBe('ready');
    osc.update(anchor(1.65)); // 100 bpm from the previous anchor
    expect(osc.state().state).toBe('running');
    expect(osc.state().tempo).toBeCloseTo(100, 0);
  });

  it('a below-floor anchor is not an observation: the next real beat still measures a full interval', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6;
    drive(osc, [1, 1.6, 2.2, 2.8, 3.4]);
    const before = osc.state();
    osc.update(anchor(3.4 + 0.45, 0));
    expect(osc.state().period).toBeCloseTo(before.period, 10);
    expect(osc.state().anchors).toBe(before.anchors);
    // The on-time real beat after it: the period must not shrink (a weak anchor that
    // advanced the clock would make this interval read as 0.15 s).
    drive(osc, [4.0]);
    expect(osc.state().period).toBeCloseTo(period, 2);
  });

  it('an out-of-order anchor is ignored rather than driving the period to the floor', () => {
    const osc = createAdaptiveOscillator();
    drive(osc, [1, 1.6, 2.2, 2.8]);
    const before = osc.state();
    osc.update(anchor(2.5));
    expect(osc.state().period).toBeCloseTo(before.period, 10);
  });

  it('measures the phase error at the anchor time, not at the last advance (no one-frame lag)', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.6;
    const dt = 1 / 30;
    let t = 0;
    // Anchors arrive one frame AFTER their refined time, as the detector delivers them.
    for (let k = 0; k < 12; k++) {
      const at = 1 + k * period;
      while (t + dt <= at + dt) {
        t += dt;
        osc.advance(t);
      }
      osc.update(anchor(at));
    }
    const s = osc.state();
    // The prediction for the next beat is within 5 ms of the truth, not a frame late.
    expect(Math.abs(s.nextBeatAt - (1 + 12 * period))).toBeLessThan(0.005);
  });

  it('re-locks after a tempo jump instead of staying lost (Pardo\'s failure mode)', () => {
    const osc = createAdaptiveOscillator();
    // 54 bpm, then a jump to 100 bpm — a single fixed-window hypothesis never re-locks.
    const slow = Array.from({ length: 8 }, (_, i) => 1 + i * (60 / 54));
    const t0 = slow[slow.length - 1];
    const fast = Array.from({ length: 10 }, (_, i) => t0 + (i + 1) * 0.6);
    drive(osc, [...slow, ...fast]);
    const s = osc.state();
    expect(s.state).toBe('running');
    expect(Math.abs(s.tempo - 100) / 100).toBeLessThan(0.08);
  });

  it('reset returns to ready', () => {
    const osc = createAdaptiveOscillator();
    drive(osc, [1, 1.6, 2.2]);
    osc.reset();
    expect(osc.state()).toMatchObject({ state: 'ready', beat: 0, anchors: 0 });
  });
});
