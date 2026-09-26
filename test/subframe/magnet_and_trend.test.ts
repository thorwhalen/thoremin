/**
 * The timing magnet (src/ictus/magnet.ts) and the trend prior (src/ictus/trend_prior.ts).
 *
 * Magnet: the pull toward the prior's nearest expected beat scales with magnetism,
 * fades with distance through the attentional window, is off when the prior is not
 * running, and never moves an event past the grid. Trend prior: locks on a steady
 * beat, follows an accelerando with no lag (the case the adaptive oscillator lags
 * on, which `scripts/subframe/score.ts` measures), bridges a dropped beat, holds
 * when the beats stop, and honours the RhythmPrior contract (`beatAt`, `predict`).
 */
import { describe, it, expect } from 'vitest';
import { beatAt, createAdaptiveOscillator, createTrendPrior, magnetise, nearestExpectedBeat, type Anchor, type MusicalTime } from '@/ictus';

const anchor = (t: number, confidence = 1): Anchor => ({ t, confidence, strength: 1, sharpness: NaN, lateral: 0 });

/** A running prior state at time `t` with the beat exactly on `t0 + k * period`. */
function runningState(t: number, t0: number, period: number, confidence = 1): MusicalTime {
  const beat = (t - t0) / period;
  return {
    t,
    beat,
    phase: beat - Math.floor(beat),
    tempo: 60 / period,
    period,
    confidence,
    nextBeatAt: t0 + (Math.floor(beat) + 1) * period,
    beatsPerBar: 4,
    beatInBar: Math.floor(beat) % 4,
    state: 'running',
    anchors: 8,
  };
}

describe('magnetise', () => {
  const period = 0.5;
  const state = runningState(10.13, 10, period);

  it('finds the nearest expected beat on either side', () => {
    expect(nearestExpectedBeat(state, 10.52)).toBeCloseTo(10.5, 9);
    expect(nearestExpectedBeat(state, 10.98)).toBeCloseTo(11.0, 9);
    expect(nearestExpectedBeat(state, 10.24)).toBeCloseTo(10.0, 9); // nearer the beat behind
    expect(Number.isNaN(nearestExpectedBeat({ ...state, state: 'ready' }, 10.5))).toBe(true);
  });

  it('pulls by the magnetism, through the gate, never past the grid', () => {
    const t = 10.52; // 20 ms late
    const none = magnetise(t, state, 0);
    expect(none.t).toBe(t);
    expect(none.pull).toBe(0);
    const half = magnetise(t, state, 0.5);
    const full = magnetise(t, state, 1);
    expect(half.grid).toBeCloseTo(10.5, 9);
    expect(half.pull).toBeLessThan(0);
    expect(full.pull).toBeCloseTo(2 * half.pull, 9);
    expect(full.t).toBeGreaterThanOrEqual(10.5);
    expect(full.t).toBeLessThan(t);
    // 20 ms in a 125 ms window is well inside the gate: most of the way there.
    expect(full.gate).toBeGreaterThan(0.9);
  });

  it('the gate fades with distance from the expected beat, and with the prior\'s confidence', () => {
    const near = magnetise(10.51, state, 1);
    const far = magnetise(10.75, state, 1); // exactly between two beats
    expect(far.gate).toBeLessThan(0.2);
    expect(near.gate).toBeGreaterThan(far.gate);
    expect(Math.abs(far.pull)).toBeLessThan(0.05);
    const unsure = magnetise(10.51, runningState(10.13, 10, period, 0.2), 1);
    expect(unsure.gate).toBeCloseTo(0.2 * near.gate, 9);
  });

  it('does nothing for a prior that is not running', () => {
    const r = magnetise(10.52, { ...state, state: 'hold' }, 1);
    expect(r.t).toBe(10.52);
    expect(r.gate).toBe(0);
  });
});

describe('trend prior', () => {
  it('locks on a steady beat and predicts the next one', () => {
    const p = createTrendPrior();
    for (let k = 0; k < 6; k++) p.update(anchor(1 + 0.5 * k));
    const s = p.state();
    expect(s.state).toBe('running');
    expect(s.tempo).toBeCloseTo(120, 3);
    expect(s.nextBeatAt).toBeCloseTo(1 + 0.5 * 6, 3);
    expect(s.lastAnchorAt).toBeCloseTo(3.5, 9);
    expect(s.confidence).toBeGreaterThan(0.9);
    p.advance(3.7);
    expect(beatAt(p.state(), 3.75)).toBeCloseTo(5.5, 3);
    expect(p.predict().expectedAt).toBeCloseTo(4.0, 3);
  });

  it('follows an accelerando with no lag, where the oscillator runs late', () => {
    // Period shrinking 1.5% per beat from 0.625 s: what the benchmark's 96 -> 132 bpm
    // accelerando does, without humanisation.
    const times: number[] = [1];
    let period = 0.625;
    for (let k = 1; k < 24; k++) {
      times.push(times[k - 1] + period);
      period *= 0.985;
    }
    const trend = createTrendPrior({ memory: 12, quadraticAfter: 5 });
    const osc = createAdaptiveOscillator({ initialTempo: 100 });
    const errTrend: number[] = [];
    const errOsc: number[] = [];
    for (let k = 0; k < times.length; k++) {
      if (k >= 8) {
        // Where each prior's grid puts THIS beat, asked just before it (the magnet's
        // question; `predict().expectedAt` right after an early anchor is the beat
        // the oscillator thinks is still due, which is not the comparison).
        const ask = times[k] - 0.02;
        trend.advance(ask);
        osc.advance(ask);
        errTrend.push(nearestExpectedBeat(trend.state(), times[k]) - times[k]);
        errOsc.push(nearestExpectedBeat(osc.state(), times[k]) - times[k]);
      }
      trend.update(anchor(times[k]));
      osc.update(anchor(times[k]));
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(errTrend))).toBeLessThan(0.005);
    expect(mean(errOsc)).toBeGreaterThan(0.01); // late
    expect(mean(errOsc)).toBeGreaterThan(5 * Math.abs(mean(errTrend)));
  });

  it('bridges a dropped beat and keeps the beat count', () => {
    const p = createTrendPrior();
    const times = [1, 1.5, 2, 2.5, 3, 4, 4.5]; // 3.5 missing
    for (const t of times) p.update(anchor(t));
    const s = p.state();
    expect(s.state).toBe('running');
    expect(s.tempo).toBeCloseTo(120, 1);
    expect(Math.round(s.beat)).toBe(7);
  });

  it('holds when the beats stop, and restarts on the next', () => {
    const p = createTrendPrior();
    for (let k = 0; k < 6; k++) p.update(anchor(1 + 0.5 * k));
    p.advance(3.5 + 0.5 * 2.5);
    expect(p.state().state).toBe('hold');
    expect(p.state().nextBeatAt).toBe(Infinity);
    p.update(anchor(6));
    p.update(anchor(6.5));
    expect(p.state().state).toBe('running');
    expect(p.state().tempo).toBeCloseTo(120, 1);
  });

  it('ignores a weak anchor and an out-of-order one', () => {
    const p = createTrendPrior();
    for (let k = 0; k < 4; k++) p.update(anchor(1 + 0.5 * k));
    const before = p.state();
    p.update(anchor(2.6, 0.1));
    p.update(anchor(2.0));
    expect(p.state().anchors).toBe(before.anchors);
  });
});
