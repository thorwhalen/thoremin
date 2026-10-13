/**
 * The blend prior — the default {@link RhythmPrior} since #232: the adaptive
 * oscillator while the beat holds its tempo, the trend prior while the tempo moves.
 *
 * Why two. The oscillator (`oscillator.ts`) corrects half of each phase error and
 * takes its period from a running mean of past intervals, which is what makes it
 * robust to a stray anchor (its attentional gate) and is also why, under a steady
 * accelerando, it settles a constant distance BEHIND the beat: 65 to 75 ms late at
 * 1.5 % per beat (`docs/research/subframe-impact-prediction.md` §3.7). The trend
 * prior (`trend_prior.ts`) has a tempo rate and no lag there, but a fit over twelve
 * anchors is pulled by one bad anchor for twelve beats. Neither is right alone; the
 * blend keeps the oscillator's grid as long as it is unbiased and hands over to the
 * trend's as soon as it is not.
 *
 * The rule, the simplest the data supports (the 30 fps red-team simulated the
 * candidates, 400 runs each; `_agent_work/thoremin/2026-10-05-timing/design.md` step
 * 2): each anchor's INNOVATION is where it landed relative to the oscillator's
 * nearest expected beat, measured on the grid the oscillator emits BEFORE the anchor
 * is folded in (`nearestExpectedBeat`, the same question the magnet asks; never the
 * oscillator's internal, gated error). At a steady tempo the innovations are noise
 * and their signs flip (the half-gain correction anti-correlates them, so three in a
 * row of one sign happen on about 12 % of anchors, under the 25 % of coin flips);
 * under a tempo change they share a sign for as long as the oscillator lags. So:
 * when the last `sameSignRun` innovations share a sign the trend's weight `w` rises
 * by `weightStep` per anchor toward 1, otherwise it falls by the same step toward 0.
 * A magnitude floor on the three was tried and rejected: it cuts the false triggers
 * from 12 % to under 0.3 % but slows the accelerando response (grid MAE 18.4 → 23.8
 * ms), and the false triggers are cheap, because with the ±1/3 ramp the mean weight
 * at a steady tempo is 0.05 to 0.07 and the grid moves by 0.2 ms.
 *
 * What is blended: the two priors see the same anchors and advance together; the
 * published state is the oscillator's with its next expected beat, period and
 * confidence moved `w` of the way toward the trend's (the trend's next beat taken on
 * the branch nearest the oscillator's, so a prior that thinks the beat is still due
 * is never averaged with one that has moved on). The beat count stays the
 * oscillator's: a consumer keyed to whole beats sees one continuous count whose
 * phase slides, not two. `hold` and `ready` are not blended either: while either
 * half is not running the oscillator's state is published whole, whatever the
 * weight, because its state machine is the one the consumer sees and the trend's
 * beat count is its own fit index (publishing the trend whole for the stretch
 * between the two halves' hold thresholds would swap the score's beat for that
 * index and back). So entering hold drops the slide: the published beat steps back
 * by at most the oscillator's lag, a fraction of a beat, which the conductor's
 * servo (it never rewinds) absorbs, and the next anchor restarts on a whole beat of
 * the oscillator's count as it always did. At `w = 0` the state IS the
 * oscillator's, so `prior: 'oscillator'` and the blend at rest agree to the bit. Two more things the published count
 * promises: it never steps back over a whole beat it has already crossed (the slide
 * can shrink at an anchor by a hundredth of a beat in a ritardando, and crossing a
 * whole beat backwards would fire a whole-beat consumer twice), and the trend's beat
 * numbering is never trusted across a tempo jump (below).
 *
 * The trend half is reset whenever the oscillator re-seeds its lock. The trend
 * numbers each anchor by rounding the gap against its own period, so after a sudden
 * slowdown (0.5 to 0.75 s, or to 1.0 s) every real beat gets two numbers and the fit
 * settles at double tempo for good, while the oscillator loses its lock and re-seeds
 * at the new tempo within three anchors; the review of #232 found the blend stuck at
 * double tempo in 53 and 100 of 100 such runs. The oscillator's `restarts()` count
 * is the signal: a restart (lost lock, octave re-seed, restart out of hold) resets the
 * trend, the weight and the sign history, and the restart anchor is the trend's first
 * (a restart ON a stray anchor is the same case: the sign history was about a grid
 * that no longer exists). A slowdown the oscillator rides out by correction alone
 * (0.5 to 0.75 s: no re-seed, the trend's double-tempo fit would stay for good) is
 * caught by the periods: a trend half whose period disagrees with the oscillator's by
 * more than `PERIOD_DISAGREEMENT` is not describing the same beat, and starts over
 * from that anchor with the weight at 0, exactly as after a restart.
 *
 * The oscillator's gate survives the blend. A stray anchor (a rebound firing
 * mid-beat) barely moves the oscillator, whose attentional pulse is narrow once
 * locked, but a least-squares fit has no gate: trend12q carries one for twelve beats.
 * So an anchor further than `strayPhaseError` of a period from the oscillator's
 * nearest expected beat is withheld from the trend half and from the sign history
 * (it is not evidence about the grid's bias either). A dropped beat is not stray (the
 * next anchor lands on a beat, two periods on) and the trend bridges it by index.
 * While the oscillator is re-seeding after a tempo jump the trend is starved for a
 * beat or two and the weight is at rest, which is the right order: the oscillator
 * re-locks first, the trend's fit catches up, the rule decides again.
 *
 * Pure and causal like the rest of the package: no clock, nothing read from outside
 * the anchors it is given.
 */
import type { Anchor, MusicalTime, Prediction, RhythmPrior } from './types';
import { wrapPhase } from './types';
import { createAdaptiveOscillator, type AdaptiveOscillator, type OscillatorOptions } from './oscillator';
import { createTrendPrior, type TrendPriorOptions } from './trend_prior';
import { nearestExpectedBeat } from './magnet';

export interface BlendPriorOptions {
  /** Options for the oscillator half (`initialTempo` and `beatsPerBar` here override
   *  the blend's own). */
  oscillator?: OscillatorOptions;
  /** Options for the trend half. Defaults to the bench's best, `trend12q`: twelve
   *  anchors, quadratic from the fifth. */
  trend?: TrendPriorOptions;
  /** Consecutive innovations of one sign that engage the trend. Three: the
   *  red-team's measured trade between response and false triggers. */
  sameSignRun?: number;
  /** How far the trend's weight moves toward its target per anchor, 0..1. One third:
   *  fully over in three anchors, back in three. */
  weightStep?: number;
  /** An anchor further than this fraction of a period from the oscillator's nearest
   *  expected beat is withheld from the trend half (the oscillator's own gate takes
   *  care of it there). Measured against the OSCILLATOR's grid, which lags a moving
   *  tempo by up to about 0.15 of a period (65 to 75 ms at 0.45 to 0.6 s), so a real
   *  beat reads up to 0.15 early and a mid-beat rebound reads 0.5 minus that lag, 0.35
   *  at the closest; 0.3 sits between the two with 0.05 of a period to spare on each
   *  side (the oscillator's 0.4 lost-lock window let the rebound through by 6 ms). */
  strayPhaseError?: number;
  /** Initial tempo assumption until the first lock (bpm), for both halves. */
  initialTempo?: number;
  beatsPerBar?: number;
}

/** The trend half's defaults, and what `createRhythmPrior('trend')` builds: the
 *  bench's `trend12q` (§3.7: MAE 16 / 17 ms under the accelerando, the best of six).
 *  The trend prior's own defaults (six anchors, quadratic from the fourth) react
 *  faster but are pulled further by one anchor. */
export const TREND_DEFAULTS: Required<Pick<TrendPriorOptions, 'memory' | 'quadraticAfter'>> = { memory: 12, quadraticAfter: 5 };

/** Relative difference between the two halves' periods beyond which they are not
 *  describing one beat and the trend is not blended in. A fifth: the humanised
 *  periods differ by a few per cent, a wrongly numbered trend by half or double. */
const PERIOD_DISAGREEMENT = 0.2;

const DEFAULTS: Required<Omit<BlendPriorOptions, 'oscillator' | 'trend'>> = {
  sameSignRun: 3,
  weightStep: 1 / 3,
  strayPhaseError: 0.3,
  initialTempo: 100,
  beatsPerBar: 4,
};

export interface BlendPrior extends RhythmPrior {
  /** The trend's current weight, 0 (the oscillator alone) to 1 (the trend alone). */
  weight(): number;
  /** The two halves, for tests and ablations. Read them; feed the blend. */
  readonly oscillator: AdaptiveOscillator;
  readonly trend: RhythmPrior;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createBlendPrior(options: BlendPriorOptions = {}): BlendPrior {
  const o = { ...DEFAULTS, ...options };
  const oscillator = createAdaptiveOscillator({ initialTempo: o.initialTempo, beatsPerBar: o.beatsPerBar, ...options.oscillator });
  const trend = createTrendPrior({ ...TREND_DEFAULTS, initialTempo: o.initialTempo, beatsPerBar: o.beatsPerBar, ...options.trend });
  /** The trend's weight. */
  let w = 0;
  /** Signs of the last `sameSignRun` innovations (+1 late, -1 early, 0 on the beat). */
  const signs: number[] = [];
  /** The whole beat the published count has crossed; the count never reads below it
   *  until the oscillator restarts (its own restart rounds its count, as it always
   *  did) or the blend is reset. Raised only by `advance` and `update` (`settle`),
   *  never by a read: `state()` is pure, so a consumer sees the same published state
   *  whether or not it polled between anchors. */
  let crossed = -Infinity;

  const disagree = (a: MusicalTime, b: MusicalTime) => Math.abs(a.period - b.period) > PERIOD_DISAGREEMENT * a.period;

  /** The state as published: the whole-beat floor applied. Pure. */
  const publish = (s: MusicalTime): MusicalTime => {
    if (!(s.beat < crossed)) return s;
    return {
      ...s,
      beat: crossed,
      phase: 0,
      nextBeatAt: s.state === 'hold' ? Infinity : s.t + s.period,
      beatInBar: ((crossed % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar,
    };
  };

  const snapshot = (): MusicalTime => {
    const so = oscillator.state();
    if (w <= 0) return publish(so);
    const st = trend.state();
    if (so.state !== 'running' || st.state !== 'running') return publish(so);
    if (!(so.period > 0) || !(st.period > 0) || !Number.isFinite(so.nextBeatAt) || !Number.isFinite(st.nextBeatAt)) return publish(so);
    if (disagree(so, st)) return publish(so);
    const t = so.t;
    const period = (1 - w) * so.period + w * st.period;
    // The trend's next beat on the branch nearest the oscillator's: right after an
    // early anchor the oscillator may still expect the beat it half-corrected toward
    // while the trend has moved a whole beat on.
    const trendNext = st.nextBeatAt + Math.round((so.nextBeatAt - st.nextBeatAt) / st.period) * st.period;
    const next = (1 - w) * so.nextBeatAt + w * trendNext;
    let phase = 1 - (next - t) / period;
    phase -= Math.floor(phase);
    const beat = so.beat + wrapPhase(phase - so.phase);
    const wholeBeat = Math.floor(beat);
    return publish({
      ...so,
      beat,
      phase,
      tempo: 60 / period,
      period,
      confidence: (1 - w) * so.confidence + w * st.confidence,
      nextBeatAt: t + (1 - phase) * period,
      beatInBar: ((wholeBeat % so.beatsPerBar) + so.beatsPerBar) % so.beatsPerBar,
    });
  };

  /** Back to the oscillator alone: no weight, no history. */
  const rest = () => {
    w = 0;
    signs.length = 0;
  };

  /** Remember the whole beat the published count has reached (after every advance
   *  and update, the only two things that move the count). */
  const settle = () => {
    crossed = Math.max(crossed, Math.floor(snapshot().beat));
  };

  const applyUpdate = (a: Anchor) => {
    const before = oscillator.state();
    const restartsBefore = oscillator.restarts();
    // The innovation: the anchor against the grid the oscillator was publishing, NaN
    // unless it was running.
    const grid = nearestExpectedBeat(before, a.t);
    const stray = Number.isFinite(grid) && Math.abs(a.t - grid) > o.strayPhaseError * before.period;
    oscillator.update(a);
    if (oscillator.restarts() !== restartsBefore) {
      // The oscillator re-seeded its lock: the trend's fit, the weight and the sign
      // history were about a grid that no longer exists. The trend starts over from
      // this anchor; the published count follows the oscillator's restart.
      trend.reset();
      trend.update(a);
      rest();
      crossed = -Infinity;
      return;
    }
    if (stray) return;
    trend.update(a);
    const after = oscillator.state();
    // Not an observation to the oscillator (below its floor, out of order): nothing
    // to learn about its grid from.
    if (after.anchors === before.anchors) return;
    const st = trend.state();
    if (after.state === 'running' && st.state === 'running' && disagree(after, st)) {
      // Two priors a fifth apart are not describing one beat: the trend numbered a
      // beat wrong (a slowdown the oscillator rode out by correction, without a
      // re-seed, leaves the trend's fit at double tempo for good). The trend starts
      // over from this anchor, as after a restart; the oscillator alone meanwhile.
      trend.reset();
      trend.update(a);
      rest();
      return;
    }
    if (Number.isFinite(grid) && after.state === 'running') {
      signs.push(Math.sign(a.t - grid));
      while (signs.length > o.sameSignRun) signs.shift();
    } else {
      // A restart (hold, lost lock, the first anchors): the history is about a grid
      // that no longer exists.
      signs.length = 0;
    }
    const run = signs.length >= o.sameSignRun && signs[0] !== 0 && signs.every((s) => s === signs[0]);
    w = clamp01(w + (run ? o.weightStep : -o.weightStep));
  };

  return {
    oscillator,
    trend,
    weight: () => w,
    advance(t) {
      oscillator.advance(t);
      trend.advance(t);
      settle();
    },
    update(a: Anchor) {
      applyUpdate(a);
      settle();
    },
    predict(): Prediction {
      const s = snapshot();
      const po = oscillator.predict();
      const pt = trend.predict();
      const window = w <= 0 ? po.window : (1 - w) * po.window + w * pt.window;
      return { expectedAt: s.nextBeatAt, window, phase: s.phase };
    },
    state: snapshot,
    reset() {
      oscillator.reset();
      trend.reset();
      rest();
      crossed = -Infinity;
    },
  };
}
