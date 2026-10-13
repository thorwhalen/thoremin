/**
 * ictus unit cases from the sprint-review coverage issue (#391 item 6): the edges of
 * the oscillator's hold, the blend's gates, the scheduler's loop contract and a long
 * forward jump, and the lag gate on a degenerate window.
 *
 * Four cases pin defects listed in #393, now fixed: an anchor delivered after
 * `advance` crossed the hold threshold but timed before it no longer restarts the
 * lock; the blend's trend no longer learns from an anchor the oscillator's floor
 * refused, and its `predict()` no longer blends the trend's window while its state
 * has fallen back to the oscillator alone; the scheduler rejects an event at or past
 * `loopBeats`. The lag gate's all-zero case pins today's behaviour (gate 0), a
 * judgement call rather than a defect: see the case.
 */
import { describe, expect, it } from 'vitest';
import {
  createAdaptiveOscillator,
  createBlendPrior,
  createScheduler,
  SCHEDULER_DEFAULTS,
  lagGate,
  LAG_STROKES,
  type Anchor,
  type ScoreEvent,
} from '@thoremin/ictus';

const anchor = (t: number, confidence = 1): Anchor => ({ t, confidence, strength: 1, sharpness: NaN, lateral: 0 });
const ev = (key: number, start: number, duration = 0.5, channel = 0, velocity = 0.8): ScoreEvent => ({ key, channel, start, duration, velocity });

/** The bench's accelerando (as `ictus_blend.test.ts`): the period shrinking 1.5 % per
 *  beat from 0.625 s; it engages the blend's trend half fully. */
function accelerando(beats = 24, t0 = 1, start = 0.625, ratio = 0.985): number[] {
  const times = [t0];
  let period = start;
  for (let k = 1; k < beats; k++) {
    times.push(times[k - 1] + period);
    period *= ratio;
  }
  return times;
}

describe('adaptive oscillator: an anchor delivered late (#391 item 6)', () => {
  it('an anchor timed before the hold threshold but delivered after advance crossed it keeps restarts() unchanged (#393 lower "anchor delivered late")', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.5;
    for (const t of [1, 1.5, 2, 2.5, 3]) {
      osc.advance(t);
      osc.update(anchor(t));
    }
    expect(osc.state().state).toBe('running');
    const restarts = osc.restarts();
    // The caller's clock runs past the hold threshold (2.25 periods after the last
    // anchor) before the detector delivers the beat that was on time.
    osc.advance(3 + 2.4 * period);
    expect(osc.state().state).toBe('hold');
    osc.update(anchor(3 + period));
    // An on-time beat is not a preparatory beat after a fermata: no re-seed.
    expect(osc.restarts()).toBe(restarts);
    expect(osc.state().state).toBe('running');
  });

  it('an anchor delivered after the hold threshold AND timed after it is a preparatory beat: it restarts (the control)', () => {
    const osc = createAdaptiveOscillator();
    const period = 0.5;
    for (const t of [1, 1.5, 2, 2.5, 3]) {
      osc.advance(t);
      osc.update(anchor(t));
    }
    const restarts = osc.restarts();
    osc.advance(3 + 2.4 * period);
    expect(osc.state().state).toBe('hold');
    osc.update(anchor(3 + 2.5 * period));
    expect(osc.restarts()).toBe(restarts + 1);
  });
});

describe('blend prior: the gates the oscillator owns (#391 item 6)', () => {
  /** A blend locked on a steady 0.5 s train, with the given oscillator floor. */
  function locked(confidenceFloor: number) {
    const blend = createBlendPrior({ oscillator: { confidenceFloor } });
    for (const t of [1, 1.5, 2, 2.5, 3, 3.5]) {
      blend.advance(t);
      blend.update(anchor(t));
    }
    expect(blend.oscillator.state().state).toBe('running');
    return blend;
  }

  it('with oscillator.confidenceFloor 0.5, an on-beat anchor below the floor does not update the trend (#393 lower "blend\'s trend learns")', () => {
    const blend = locked(0.5);
    const oscAnchors = blend.oscillator.state().anchors;
    const trendAnchors = blend.trend.state().anchors;
    blend.advance(4);
    // Above the trend half's own floor (0.2), below the oscillator's (0.5).
    blend.update(anchor(4, 0.3));
    expect(blend.oscillator.state().anchors).toBe(oscAnchors);
    expect(blend.trend.state().anchors).toBe(trendAnchors);
  });

  it('an anchor at or above the floor reaches both halves (the control)', () => {
    const blend = locked(0.5);
    const oscAnchors = blend.oscillator.state().anchors;
    const trendAnchors = blend.trend.state().anchors;
    blend.advance(4);
    blend.update(anchor(4, 0.6));
    expect(blend.oscillator.state().anchors).toBe(oscAnchors + 1);
    expect(blend.trend.state().anchors).toBe(trendAnchors + 1);
  });

  it('when the two halves disagree (the state falls back to the oscillator), predict().window equals the oscillator\'s (#393 lower "blend\'s trend learns", predict)', () => {
    const blend = createBlendPrior();
    for (const t of accelerando()) {
      blend.advance(t);
      blend.update(anchor(t));
    }
    expect(blend.weight()).toBeGreaterThan(0);
    // Make the trend half describe another beat: anchors at double the tempo, fed to
    // the half directly (the blend only reads it). Its period is now half the
    // oscillator's, so the published state is the oscillator's alone.
    const so = blend.oscillator.state();
    const last = so.lastAnchorAt!;
    for (let k = 1; k <= 12; k++) blend.trend.update(anchor(last + (k * so.period) / 2));
    const t = last + 6 * so.period;
    blend.oscillator.advance(t);
    blend.trend.advance(t);
    const st = blend.trend.state();
    const sNow = blend.oscillator.state();
    expect(Math.abs(st.period - sNow.period)).toBeGreaterThan(0.2 * sNow.period);
    expect(blend.weight()).toBeGreaterThan(0);
    expect(blend.state()).toEqual(sNow);
    expect(blend.predict().window).toBe(blend.oscillator.predict().window);
  });
});

describe('scheduler: the loop contract and a long forward jump (#391 item 6)', () => {
  it('an event at start >= loopBeats is rejected (#393 lower "scheduler accepts events past the loop")', () => {
    expect(() => createScheduler([ev(60, 0), ev(62, 4)], { loopBeats: 4 })).toThrow();
    expect(() => createScheduler([ev(60, 0), ev(62, 5.5)], { loopBeats: 4 })).toThrow();
  });

  it('an event just below loopBeats is accepted', () => {
    expect(() => createScheduler([ev(60, 0), ev(62, 3.99)], { loopBeats: 4 })).not.toThrow();
  });

  it('a forward jump of 1000 beats returns promptly with the passed notes counted as skipped', () => {
    // One note per beat on a 4-beat loop.
    const s = createScheduler([ev(60, 0), ev(62, 1), ev(64, 2), ev(65, 3)], { loopBeats: 4 });
    const first = s.tick({ now: 0, beat: 0, bpm: 60, horizon: 0.1 });
    expect(first.filter((c) => c.type === 'noteOn')).toHaveLength(1);
    const t0 = performance.now();
    const out = s.tick({ now: 1, beat: 1000.25, bpm: 60, horizon: 0.1 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
    // Beats 1..999 are entirely behind the beat: skipped, never played as ghosts.
    expect(s.skipped).toBe(999);
    // The note at beat 1000 is still under way: due now, it plays now (a retrigger gap after
    // the beat-0 note on the same key, released in the same tick).
    const ons = out.filter((c) => c.type === 'noteOn');
    expect(ons).toHaveLength(1);
    expect(ons[0].key).toBe(60);
    expect(ons[0].time).toBeCloseTo(1 + SCHEDULER_DEFAULTS.retriggerGap, 9);
    expect(out.filter((c) => c.type === 'noteOff')).toEqual([{ type: 'noteOff', channel: 0, key: 60, time: 1 }]);
    expect(s.sounding).toBe(1);
  });
});

describe('lagGate on a degenerate window (#391 item 6)', () => {
  it('all-zero lags: finite numbers, nothing NaN, the gate in [0, 1]', () => {
    const g = lagGate(Array.from({ length: LAG_STROKES }, () => 0));
    expect(g.n).toBe(LAG_STROKES);
    expect(g.lag).toBe(0);
    expect(g.se).toBe(0);
    expect(g.tolerance).toBe(0);
    expect(Number.isFinite(g.gate)).toBe(true);
    expect(g.gate).toBeGreaterThanOrEqual(0);
    expect(g.gate).toBeLessThanOrEqual(1);
    // Today a zero scatter gates to 0 whatever the lag: a window with no scatter is
    // no estimate of it (the header's "too few strokes" rule, extended).
    expect(g.gate).toBe(0);
  });
});
