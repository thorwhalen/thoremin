/**
 * The blend prior (packages/ictus/src/blend_prior.ts) and the prior factory (#232, the
 * timing plan's step 2), on synthetic anchor trains: at rest it IS the oscillator;
 * under the benchmark's accelerando it follows where the oscillator runs late; at a
 * steady humanised tempo its false triggers are rare and cheap (the issue's bounds:
 * at most 15 % of anchors, mean trend weight at most 0.1); with the trend engaged a
 * mid-beat rebound and a dropped beat leave the tempo within 2 % (the oscillator's
 * gate survives the blend); hold and restart pass through; the three priors are
 * selectable by name and the facade defaults to the blend.
 *
 * The real-fixture half of #232's acceptance is in `ictus_detector.test.ts` (the 2/4
 * lock) and `scripts/ictus/conducting_metrics.ts`; the bench numbers are in
 * `docs/research/subframe-impact-prediction.md` §3.7.
 */
import { describe, it, expect } from 'vitest';
import {
  beatAt,
  createAdaptiveOscillator,
  createBlendPrior,
  createIctus,
  createRhythmPrior,
  createTrendPrior,
  nearestExpectedBeat,
  DEFAULT_RHYTHM_PRIOR,
  type Anchor,
  type RhythmPrior,
} from '@thoremin/ictus';
import { gaussian, seeded } from './helpers/random';

const anchor = (t: number, confidence = 1): Anchor => ({ t, confidence, strength: 1, sharpness: NaN, lateral: 0 });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const mae = (xs: number[]) => mean(xs.map(Math.abs));

/** The bench's accelerando: the period shrinking 1.5 % per beat from 0.625 s (96 bpm)
 *  over 24 beats, as `magnet_and_trend.test.ts` and `scripts/subframe/score.ts`. */
function accelerando(beats = 24, t0 = 1, start = 0.625, ratio = 0.985): number[] {
  const times = [t0];
  let period = start;
  for (let k = 1; k < beats; k++) {
    times.push(times[k - 1] + period);
    period *= ratio;
  }
  return times;
}

/** The bench's humanisation: AR(1) timing noise (sd 12 ms, rho 0.3, `an.impacts`'
 *  BENCHMARK_SPEC) plus white detection error (sd 7 ms, the 30 fps anchor spread). */
function humanise(times: number[], next: () => number, sd = 0.012, rho = 0.3, detection = 0.007): number[] {
  let h = 0;
  return times.map((t) => {
    h = rho * h + Math.sqrt(1 - rho * rho) * sd * gaussian(next);
    return t + h + detection * gaussian(next);
  });
}

/** Beats the oscillator and the trend need before either has a grid worth scoring. */
const WARM_UP = 8;
/** The magnet's question is asked this long before the beat. */
const ASK_BEFORE = 0.02;

/** Where the prior's grid puts each beat from `warm` on, asked just before it, minus
 *  the beat itself (negative = the grid is early); each anchor is then folded in. */
function gridErrors(prior: RhythmPrior, times: number[], anchors = times, warm = WARM_UP): number[] {
  const errors: number[] = [];
  for (let k = 0; k < times.length; k++) {
    if (k >= warm) {
      prior.advance(anchors[k] - ASK_BEFORE);
      const grid = nearestExpectedBeat(prior.state(), anchors[k]);
      if (Number.isFinite(grid)) errors.push(grid - times[k]);
    }
    prior.update(anchor(anchors[k]));
  }
  return errors;
}

describe('blend prior', () => {
  it('at rest it is the oscillator to the bit: a steady train never engages the trend', () => {
    const blend = createBlendPrior();
    const osc = createAdaptiveOscillator();
    for (let k = 0; k < 16; k++) {
      const t = 1 + 0.5 * k;
      blend.advance(t - 0.01);
      osc.advance(t - 0.01);
      blend.update(anchor(t));
      osc.update(anchor(t));
      expect(blend.weight()).toBe(0);
      expect(blend.state()).toEqual(osc.state());
      expect(blend.predict()).toEqual(osc.predict());
    }
  });

  it('follows the accelerando where the oscillator runs late: grid MAE under 20 ms and under a third of the oscillator\'s; the trend takes over', () => {
    const times = accelerando();
    const blend = createBlendPrior();
    const eBlend = gridErrors(blend, times);
    const eOsc = gridErrors(createAdaptiveOscillator(), times);
    expect(mae(eOsc)).toBeGreaterThan(0.03); // the lag this fixes
    expect(mae(eBlend)).toBeLessThan(0.02); // the issue's acceptance (bench: 18 / 20 ms)
    expect(mae(eBlend)).toBeLessThan(mae(eOsc) / 3);
    expect(Math.abs(mean(eBlend))).toBeLessThan(0.01);
    expect(blend.weight()).toBe(1);
  });

  it('false triggers at a steady humanised tempo: at most 15 % of anchors, mean weight at most 0.1, grid within 1 ms of the oscillator\'s', () => {
    // The red-team's protocol (`design.md` step 2): 24-beat passages, counted from the
    // fifth anchor. Its 12 to 13 % excluded the cold start, where the oscillator's
    // one-interval seed makes a same-sign run likely and the trend's five-point fit
    // is the better grid; counted from the lock itself the rate is about 16 %.
    const RUNS = 100;
    const BEATS = 24;
    const COUNT_FROM = 5;
    let triggers = 0;
    let scored = 0;
    let weightSum = 0;
    const eBlend: number[] = [];
    const eOsc: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const next = seeded(1000 * run + 7);
      const times = Array.from({ length: BEATS }, (_, k) => 0.5 + 0.6 * k);
      const anchors = humanise(times, next);
      const blend = createBlendPrior();
      const osc = createAdaptiveOscillator();
      let w = 0;
      for (let k = 0; k < BEATS; k++) {
        if (k >= WARM_UP) {
          blend.advance(anchors[k] - ASK_BEFORE);
          osc.advance(anchors[k] - ASK_BEFORE);
          eBlend.push(nearestExpectedBeat(blend.state(), anchors[k]) - times[k]);
          eOsc.push(nearestExpectedBeat(osc.state(), anchors[k]) - times[k]);
        }
        blend.update(anchor(anchors[k]));
        osc.update(anchor(anchors[k]));
        if (k >= COUNT_FROM) {
          scored++;
          if (blend.weight() > w) triggers++;
          weightSum += blend.weight();
        }
        w = blend.weight();
      }
    }
    expect(triggers / scored).toBeLessThanOrEqual(0.15);
    expect(weightSum / scored).toBeLessThanOrEqual(0.1);
    expect(Math.abs(mae(eBlend) - mae(eOsc))).toBeLessThan(0.001);
  });

  it('with the trend engaged, a mid-beat rebound and a dropped beat keep the tempo within 2 % (the oscillator\'s gate survives the blend)', () => {
    const times = accelerando(30);
    const periods = times.map((t, k) => (k + 1 < times.length ? times[k + 1] - t : times[k] - times[k - 1]));
    const REBOUND_AFTER = 16; // a rebound half a beat after this anchor
    const DROPPED = 21; // this beat is never seen
    const run = (prior: RhythmPrior, withStrays: boolean) => {
      const worst: number[] = [];
      let trendAnchorsBefore = 0;
      let trendStarved = false;
      for (let k = 0; k < times.length; k++) {
        if (withStrays && k === DROPPED) continue;
        prior.advance(times[k] - ASK_BEFORE);
        prior.update(anchor(times[k]));
        if (k >= REBOUND_AFTER) worst.push(Math.abs(prior.state().period - periods[k]) / periods[k]);
        if (withStrays && k === REBOUND_AFTER) {
          const parts = prior as ReturnType<typeof createBlendPrior>;
          trendAnchorsBefore = parts.trend?.state().anchors ?? 0;
          prior.advance(times[k] + periods[k] / 2 - ASK_BEFORE);
          prior.update(anchor(times[k] + periods[k] / 2));
          trendStarved = (parts.trend?.state().anchors ?? 0) === trendAnchorsBefore;
        }
      }
      return { worst: Math.max(...worst), trendStarved };
    };
    const clean = run(createBlendPrior(), false);
    const strays = run(createBlendPrior(), true);
    expect(clean.worst).toBeLessThan(0.02);
    expect(strays.worst).toBeLessThan(0.02);
    expect(strays.trendStarved).toBe(true);
    // The trend alone carries the rebound (it has no gate), which is why the blend keeps the oscillator's.
    const trendAlone = run(createTrendPrior({ memory: 12, quadraticAfter: 5 }), true);
    expect(trendAlone.worst).toBeGreaterThan(0.02);
  });

  it('holds when the beats stop, restarts on the next, and reset returns to rest', () => {
    const blend = createBlendPrior();
    const times = accelerando(12);
    for (const t of times) blend.update(anchor(t));
    expect(blend.state().state).toBe('running');
    const last = times[times.length - 1];
    for (let t = last; t < last + 2; t += 1 / 30) blend.advance(t);
    const held = blend.state();
    expect(held.state).toBe('hold');
    expect(held.nextBeatAt).toBe(Infinity);
    expect(beatAt(held, held.t + 5)).toBe(held.beat);
    blend.update(anchor(last + 2.5));
    expect(blend.state().state).toBe('running');
    expect(blend.weight()).toBeLessThan(1);
    blend.reset();
    expect(blend.weight()).toBe(0);
    expect(blend.state()).toMatchObject({ state: 'ready', beat: 0, anchors: 0 });
  });

  it('with the trend engaged, the beat count never jumps into hold and out of it: the oscillator\'s state machine is the one published', () => {
    // The two halves enter hold at their own thresholds (2.25 of their own period),
    // which differ while the trend is engaged. Publishing the trend whole in between
    // would swap the score's beat for the trend's fit index (beats away) and back;
    // what is allowed is the slide dropping at the hold: a step back of under half a
    // beat, which a whole-beat consumer never sees as a second beat.
    const times = accelerando();
    const blend = createBlendPrior();
    for (const t of times) {
      blend.advance(t - ASK_BEFORE);
      blend.update(anchor(t));
    }
    expect(blend.weight()).toBe(1);
    const last = times[times.length - 1];
    let prev = blend.state();
    const DT = 1 / 30;
    for (let t = last + DT; t < last + 3; t += DT) {
      blend.advance(t);
      const s = blend.state();
      // Free-running, the beat advances by about a frame's worth (the trend's curvature
      // bends it a little); frozen in hold, not at all; never a whole beat either way.
      expect(s.beat - prev.beat).toBeGreaterThan(-0.5);
      expect(s.beat - prev.beat).toBeLessThan(1.5 * DT / prev.period + 1e-6);
      expect(s.beatsPerBar).toBe(prev.beatsPerBar);
      prev = s;
    }
    expect(prev.state).toBe('hold');
    expect(prev.beat).toBeCloseTo(blend.oscillator.state().beat, 9);
    // The preparatory beat restarts on the next whole beat of the SAME count.
    blend.update(anchor(last + 3.2));
    const restarted = blend.state();
    expect(restarted.state).toBe('running');
    expect(Math.abs(restarted.beat - Math.round(prev.beat))).toBeLessThan(0.1);
  });

  it('the beat count is the oscillator\'s, continuous, with the phase slid toward the trend', () => {
    const times = accelerando();
    const blend = createBlendPrior();
    let prevBeat = 0;
    for (let k = 0; k < times.length; k++) {
      blend.advance(times[k] - ASK_BEFORE);
      blend.update(anchor(times[k]));
      const s = blend.state();
      expect(Math.abs(s.beat - blend.oscillator.state().beat)).toBeLessThan(0.5);
      expect(s.phase).toBeGreaterThanOrEqual(0);
      expect(s.phase).toBeLessThan(1);
      expect(s.nextBeatAt).toBeGreaterThan(s.t);
      expect(s.nextBeatAt).toBeLessThanOrEqual(s.t + s.period + 1e-9);
      if (k > 2) expect(s.beat).toBeGreaterThan(prevBeat - 0.5);
      prevBeat = s.beat;
    }
  });
});

describe('the prior factory and the facade default', () => {
  it('builds each prior by name; the blend is the default and takes the oscillator and trend options for its halves', () => {
    expect(DEFAULT_RHYTHM_PRIOR).toBe('blend');
    const osc = createRhythmPrior('oscillator', { oscillator: { initialTempo: 90 } });
    expect(osc.state().tempo).toBe(90);
    const trend = createRhythmPrior('trend', { trend: { initialTempo: 80 } });
    expect(trend.state().tempo).toBe(80);
    const blend = createRhythmPrior('blend', { oscillator: { initialTempo: 70 }, trend: { initialTempo: 70 } }) as ReturnType<typeof createBlendPrior>;
    expect(blend.weight).toBeTypeOf('function');
    expect(blend.oscillator.state().tempo).toBe(70);
    expect(blend.trend.state().tempo).toBe(70);
  });

  it('the facade defaults to the blend, and `prior: \'oscillator\'` is the pre-#232 follower', () => {
    const ictus = createIctus({ oscillator: { initialTempo: 95 } });
    expect((ictus.prior as ReturnType<typeof createBlendPrior>).weight).toBeTypeOf('function');
    expect(ictus.prior.state().tempo).toBe(95);
    const old = createIctus({ prior: 'oscillator', oscillator: { initialTempo: 95 } });
    expect((old.prior as Partial<ReturnType<typeof createBlendPrior>>).weight).toBeUndefined();
    expect(old.prior.state()).toEqual(createAdaptiveOscillator({ initialTempo: 95 }).state());
    const instance = createTrendPrior();
    expect(createIctus({ prior: instance }).prior).toBe(instance);
  });
});
