/**
 * The adaptive oscillator — v1 {@link RhythmPrior}.
 *
 * A Large-Kolen circle map (research map §2.1) with Antescofo's adaptive attentional
 * focus (§2.5). State: phase `φ` in the beat, period `p`, a continuous beat count, and
 * the concentration `κ` of a von Mises attentional pulse. Between anchors the phase
 * free-runs at the current period. On an anchor at time `t`:
 *
 *   e   = wrap(φ(t))                       phase error in (-0.5, 0.5]; late anchor → e > 0
 *   g   = exp(κ (cos 2πe − 1))             the attentional gate, 1 on the beat, → 0 off it
 *   φ  -= η_φ · c · e · g                  phase correction (pull the beat onto the anchor)
 *   p  *= 1 + η_p · c · e · g              period correction, multiplicative (relative tempo)
 *   r  += η_r (cos 2πe − r)                circular dispersion of recent errors
 *   κ   = A⁻¹(r)                            ML von Mises concentration for that dispersion
 *
 * with `c` the anchor's confidence. The two gains default to the values fitted to human
 * synchronisation (McAuley & Jones: about half the phase error and a bit less than half
 * the period error corrected per event), and the gate is what makes confidence weighting
 * need no further knob: once anchors have been landing where predicted, `κ` is high,
 * the pulse is narrow, and a stray anchor far from the beat moves nothing; after a
 * tempo jump the errors disperse, `κ` collapses, and the coupling opens up again.
 *
 * The follower state machine (research map §6.3): `ready` until two anchors give a
 * plausible period; `running` while anchors keep arriving; `hold` when the expected
 * beat is missed by `holdAfterPeriods` — the beat freezes (a fermata, a stop, a lost
 * hand) and confidence decays. The next anchor in `hold` is a preparatory beat: it
 * resets the phase to 0 and keeps the last period, and the one after it confirms the
 * lock. Nothing here schedules audio; the scheduler reads {@link MusicalTime}.
 */
import type { MusicalTime, Prediction, RhythmPrior } from './types';
import { wrapPhase } from './types';

export interface OscillatorOptions {
  /** Phase coupling strength, 0..1 (1 = full reset onto every anchor). */
  phaseGain?: number;
  /** Period coupling strength, 0..1. */
  periodGain?: number;
  /** How fast the running mean of accepted inter-anchor intervals follows new ones,
   *  0..1 per anchor. The period is corrected FROM this mean (Pardo's `p_avg`), not
   *  compounded anchor by anchor, so a conductor whose inner beats are uneven (a long
   *  downbeat stroke, short inner beats) is followed at the bar-level tempo rather
   *  than chased beat by beat. */
  periodMemory?: number;
  /** How fast the dispersion estimate (and so κ) follows recent errors, 0..1 per anchor. */
  dispersionGain?: number;
  /** κ bounds. The lower bound keeps the gate from ever closing completely at cold
   *  start; the upper bound keeps a perfectly regular player from making the gate so
   *  narrow that a real tempo change is rejected forever. */
  kappaMin?: number;
  kappaMax?: number;
  /** Plausible period range, seconds (30..300 bpm by default). An initial inter-anchor
   *  interval outside it does not seed a lock. */
  minPeriod?: number;
  maxPeriod?: number;
  /** Missing the expected beat by this many periods enters `hold`. */
  holdAfterPeriods?: number;
  /** Confidence decays by this factor per period while no anchor arrives. */
  confidenceDecayPerPeriod?: number;
  /** Consecutive anchors landing outside the attentional window (|phase error| above
   *  `lostPhaseError`) that drop the lock: the state returns to `ready` and re-seeds
   *  from those anchors. This is the escape from Pardo's failure mode (a single
   *  hypothesis that can never re-lock after a jump) and from a lock seeded by the
   *  small bounces of hands being raised into position. */
  lostAfterMisses?: number;
  lostPhaseError?: number;
  /** An inter-anchor interval within this tolerance of HALF or DOUBLE the period is
   *  "odd": a rebound that fired, a dropped beat, or the anchors arriving at a different
   *  density than the model expects. Odd intervals are not folded into the running
   *  mean, and two consecutive odd intervals that agree with each other re-seed the
   *  period from them. This is the octave guard: after a jump to double tempo every
   *  SECOND anchor still lands near a modelled beat, so the phase-error rule alone never
   *  fires and the oscillator would settle at half tempo. Intervals that are merely
   *  uneven (a long downbeat stroke at 1.6× the inner beats) are NOT odd: they are how
   *  a human conductor beats, and they belong in the mean. */
  octaveTolerance?: number;
  /** Initial tempo assumption until the first lock (bpm). */
  initialTempo?: number;
  beatsPerBar?: number;
}

const DEFAULTS: Required<OscillatorOptions> = {
  phaseGain: 0.5,
  periodGain: 0.4,
  periodMemory: 0.3,
  dispersionGain: 0.3,
  kappaMin: 0.5,
  kappaMax: 12,
  minPeriod: 0.2,
  maxPeriod: 2.0,
  holdAfterPeriods: 1.75,
  confidenceDecayPerPeriod: 0.5,
  lostAfterMisses: 2,
  lostPhaseError: 0.4,
  octaveTolerance: 0.15,
  initialTempo: 100,
  beatsPerBar: 4,
};

/**
 * Inverse of A(κ) = I1(κ)/I0(κ) — the maximum-likelihood von Mises concentration for a
 * mean resultant length r. The standard piecewise approximation (Best & Fisher 1981,
 * as used by Fisher's "Statistical Analysis of Circular Data"). Monotone in r.
 */
export function kappaFromResultant(r: number): number {
  if (!(r > 0)) return 0;
  if (r >= 0.9999) return 1e4;
  if (r < 0.53) return 2 * r + r ** 3 + (5 * r ** 5) / 6;
  if (r < 0.85) return -0.4 + 1.39 * r + 0.43 / (1 - r);
  return 1 / (r ** 3 - 4 * r ** 2 + 3 * r);
}

export function createAdaptiveOscillator(options: OscillatorOptions = {}): RhythmPrior {
  const o = { ...DEFAULTS, ...options };
  let t = 0;
  let phase = 0;
  let period = 60 / o.initialTempo;
  /** Running mean of accepted inter-anchor intervals (the tempo the period is corrected from). */
  let pAvg = period;
  let beat = 0;
  let r = 0;
  let kappa = o.kappaMin;
  let confidence = 0;
  let state: MusicalTime['state'] = 'ready';
  let anchors = 0;
  let lastAnchorT = NaN;
  let beatsPerBar = o.beatsPerBar;
  /** Anchors accepted since the last (re)start, for the ready → running transition. */
  let consecutive = 0;
  /** Consecutive anchors outside the attentional window (the lost-lock counter). */
  let misses = 0;
  /** Consecutive odd inter-anchor intervals, and the previous odd interval (octave guard). */
  let oddCount = 0;
  let lastOdd = NaN;
  /** The previous anchor's time while running, so a lost lock can re-seed from the
   *  last two anchors instead of waiting for two more. */
  let prevAnchorT = NaN;

  const advanceTo = (tNew: number) => {
    if (!(tNew > t)) {
      t = Math.max(t, tNew);
      return;
    }
    const dt = tNew - t;
    t = tNew;
    if (state === 'hold' || state === 'ready') return;
    const dBeats = dt / period;
    phase += dBeats;
    beat += dBeats;
    phase -= Math.floor(phase);
    // Missed the expected beat by more than the hold threshold: freeze. Confidence
    // decays only once the beat is OVERDUE (past one period since the last anchor), not
    // during the normal free-run between anchors, so a steady player converges on r.
    const sinceAnchor = t - lastAnchorT;
    if (sinceAnchor > period) {
      confidence *= Math.pow(o.confidenceDecayPerPeriod, Math.min(dBeats, (sinceAnchor - period) / period));
    }
    if (sinceAnchor > o.holdAfterPeriods * period) {
      state = 'hold';
      consecutive = 0;
    }
  };

  const snapshot = (): MusicalTime => {
    const wholeBeat = Math.floor(beat);
    return {
      t,
      beat,
      phase,
      tempo: 60 / period,
      period,
      confidence,
      nextBeatAt: state === 'hold' ? Infinity : t + (1 - phase) * period,
      beatsPerBar,
      beatInBar: ((wholeBeat % beatsPerBar) + beatsPerBar) % beatsPerBar,
      state,
      anchors,
    };
  };

  return {
    advance: advanceTo,
    update(a) {
      advanceTo(a.t);
      const c = Math.max(0, Math.min(1, a.confidence));
      anchors++;

      if (state === 'ready' || state === 'hold') {
        // Cold start / preparatory beat. The first anchor sets the phase origin; the
        // second sets (or, after a hold, checks) the period.
        const iai = a.t - lastAnchorT;
        prevAnchorT = lastAnchorT;
        lastAnchorT = a.t;
        misses = 0;
        if (state === 'hold') {
          // A preparatory beat after a hold: restart the phase at 0 with the kept period;
          // the beat count continues (the score does not rewind on a fermata).
          phase = 0;
          beat = Math.round(beat);
          state = 'running';
          consecutive = 1;
          confidence = 0.5;
          return;
        }
        if (Number.isFinite(iai) && iai >= o.minPeriod && iai <= o.maxPeriod) {
          period = iai;
          pAvg = iai;
          consecutive++;
        } else {
          consecutive = 1;
        }
        phase = 0;
        beat = anchors === 1 ? 0 : Math.round(beat) + (consecutive >= 2 ? 1 : 0);
        if (consecutive >= 2) {
          state = 'running';
          confidence = 0.5;
        }
        return;
      }

      // Running: the circle-map correction.
      const e = wrapPhase(phase);
      // Octave guard: anchors arriving consistently at a different density.
      const iai = a.t - lastAnchorT;
      const ratio = iai / period;
      const odd = Math.abs(ratio - 0.5) < o.octaveTolerance * 0.5 || Math.abs(ratio - 2) < o.octaveTolerance * 2;
      if (odd && Number.isFinite(lastOdd) && Math.abs(iai - lastOdd) / lastOdd < 0.2) oddCount++;
      else oddCount = odd ? 1 : 0;
      lastOdd = odd ? iai : NaN;
      const lost = Math.abs(e) > o.lostPhaseError ? ++misses >= o.lostAfterMisses : ((misses = 0), false);
      const reseed = oddCount >= 2 && iai >= o.minPeriod && iai <= o.maxPeriod;
      if (lost || reseed) {
        {
          // Lost (two anchors in a row where the beat was not) or re-seeded (two odd
          // intervals that agree): restart from the last two anchors.
          const seed = reseed ? iai : a.t - prevAnchorT;
          state = 'ready';
          r = 0;
          kappa = o.kappaMin;
          misses = 0;
          oddCount = 0;
          lastOdd = NaN;
          confidence = 0;
          phase = 0;
          beat = Math.round(beat);
          if (Number.isFinite(seed) && seed >= o.minPeriod && seed <= o.maxPeriod) {
            period = seed;
            pAvg = seed;
            state = 'running';
            consecutive = 2;
            confidence = 0.3;
          } else {
            consecutive = 1;
          }
          prevAnchorT = a.t;
          lastAnchorT = a.t;
          return;
        }
      }
      const g = Math.exp(kappa * (Math.cos(2 * Math.PI * e) - 1));
      const step = c * e * g;
      const dPhase = o.phaseGain * step;
      phase -= dPhase;
      beat -= dPhase;
      // The period is corrected from the running mean of accepted intervals (odd ones —
      // octave candidates and dropped beats — are not folded in).
      if (!odd) pAvg += o.periodMemory * c * (iai - pAvg);
      period = pAvg * (1 + o.periodGain * step);
      period = Math.max(o.minPeriod, Math.min(o.maxPeriod, period));
      phase -= Math.floor(phase);
      if (phase > 1 - 1e-9) phase = 0; // numerical hygiene: an exact hit is 0, not 0.999…
      r += o.dispersionGain * (Math.cos(2 * Math.PI * e) - r);
      kappa = Math.max(o.kappaMin, Math.min(o.kappaMax, kappaFromResultant(Math.max(0, r))));
      // Confidence rises with agreement (r is the resultant length of recent errors).
      confidence = Math.max(0, Math.min(1, 0.5 * confidence + 0.5 * Math.max(0, r)));
      prevAnchorT = lastAnchorT;
      lastAnchorT = a.t;
      consecutive++;
    },
    predict(): Prediction {
      const s = snapshot();
      // Window half-width from κ: the pulse's circular standard deviation, in seconds.
      const circSd = kappa > 0 ? Math.sqrt(-2 * Math.log(Math.min(0.999, Math.max(1e-6, r)))) : Math.PI;
      const window = Math.min(0.5, Math.max(0.05, circSd / (2 * Math.PI))) * period;
      return { expectedAt: s.nextBeatAt, window, phase };
    },
    state: snapshot,
    reset() {
      t = 0;
      phase = 0;
      period = 60 / o.initialTempo;
      pAvg = period;
      beat = 0;
      r = 0;
      kappa = o.kappaMin;
      confidence = 0;
      state = 'ready';
      anchors = 0;
      lastAnchorT = NaN;
      prevAnchorT = NaN;
      consecutive = 0;
      misses = 0;
      oddCount = 0;
      lastOdd = NaN;
      beatsPerBar = o.beatsPerBar;
    },
  };
}
