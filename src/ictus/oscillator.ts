/**
 * The adaptive oscillator — v1 {@link RhythmPrior}.
 *
 * A Large-Kolen circle map (research map §2.1) with Antescofo's adaptive attentional
 * focus (§2.5) and Pardo's running-mean period (§2.1). State: phase `φ` in the beat,
 * period `p`, a continuous beat count, and the concentration `κ` of a von Mises
 * attentional pulse. Between anchors the phase free-runs at the current period. On an
 * anchor at time `t` with confidence `c`:
 *
 *   e     = wrap(φ(t))                     phase error in (-0.5, 0.5]; a LATE anchor → e > 0
 *   g     = exp(κ (cos 2πe − 1))           the attentional gate, 1 on the beat, → 0 off it
 *   φ    -= η_φ · c · e · g                phase correction (pull the beat onto the anchor)
 *   pAvg += m · c · (iai − pAvg)           running mean of accepted inter-anchor intervals
 *   p     = pAvg · (1 + η_p · c · e · g)   period: corrected FROM the mean, not compounded
 *   r    += η_r (cos 2πe − r)              circular dispersion of recent errors
 *   κ     = A⁻¹(r)                          ML von Mises concentration for that dispersion
 *
 * The two gains default to the values fitted to human synchronisation (McAuley & Jones:
 * about half the phase error and a bit less than half the period error corrected per
 * event); correcting the period from a running mean rather than compounding it is what
 * lets a conductor whose inner beats are uneven (a long downbeat stroke, short inner
 * beats) be followed at the bar-level tempo instead of chased beat by beat; and the
 * gate is what makes confidence weighting need no further knob: once anchors have been
 * landing where predicted, `κ` is high, the pulse is narrow, and a stray anchor far
 * from the beat moves nothing; after a tempo jump the errors disperse, `κ` collapses,
 * and the coupling opens up again.
 *
 * Three guards, each the escape from a failure mode the research map catalogued and an
 * adversarial review reproduced:
 *
 * - **Confidence floor.** An anchor below `confidenceFloor` is not an observation at
 *   all (Raphael: "better to remain silent than provide bad information"): it touches
 *   no state, not even the inter-anchor clock — a weak anchor that advanced the clock
 *   would make the next real beat's interval read short and drag the period down.
 * - **Lost lock.** Two consecutive anchors outside the attentional window drop the
 *   lock and re-seed from those two anchors (Pardo's single hypothesis never re-locks
 *   after a jump; this one does).
 * - **Octave guard.** After a jump to double tempo every SECOND anchor still lands near
 *   a modelled beat, so the phase-error rule alone settles at half tempo. Three
 *   consecutive intervals near HALF or DOUBLE the period that agree with each other
 *   re-seed the period from them. Three, not two, because a single rebound firing
 *   mid-beat produces exactly two agreeing half-intervals (before it and after it) and
 *   must not re-seed; a real doubling keeps producing them. No strength requirement:
 *   real conductors' strokes vary too much for a confidence gate to be reliable.
 *
 * The follower state machine (§6.3): `ready` until two anchors give a plausible
 * period; `running` while anchors keep arriving; `hold` when the expected beat is
 * missed by `holdAfterPeriods` (a fermata, a stop, a lost hand): the beat freezes and
 * confidence decays. The next anchor in `hold` is a preparatory beat: it restarts the
 * phase at 0 with the kept period. A dropped beat (an anchor at about two periods)
 * stays below the hold threshold and free-runs through. If the conductor has really
 * halved the tempo, the hold restarts recur at the same long interval, and the second
 * one re-seeds the period from it.
 *
 * Timing: the detector's anchor time is refined below the frame period and always
 * precedes the sample that confirmed it, so `update` rewinds the free-run to the
 * anchor's own time before measuring the phase error, then re-advances. Without that
 * every prediction carries a systematic one-frame lag. Nothing here schedules audio;
 * the scheduler reads {@link MusicalTime}.
 */
import type { MusicalTime, Prediction, RhythmPrior } from './types';
import { wrapPhase } from './types';

export interface OscillatorOptions {
  /** Phase coupling strength, 0..1 (1 = full reset onto every anchor). */
  phaseGain?: number;
  /** Period coupling strength, 0..1. */
  periodGain?: number;
  /** How fast the running mean of accepted inter-anchor intervals follows new ones,
   *  0..1 per anchor (Pardo's memory). */
  periodMemory?: number;
  /** How fast the dispersion estimate (and so κ) follows recent errors, 0..1 per anchor. */
  dispersionGain?: number;
  /** κ bounds. The lower bound keeps the gate from ever closing completely at cold
   *  start; the upper bound keeps a perfectly regular player from making the gate so
   *  narrow that a real tempo change is rejected forever. */
  kappaMin?: number;
  kappaMax?: number;
  /** Plausible period range, seconds (30..300 bpm by default). An inter-anchor interval
   *  outside it never seeds a lock. */
  minPeriod?: number;
  maxPeriod?: number;
  /** An anchor below this confidence is ignored entirely (no state change). */
  confidenceFloor?: number;
  /** Consecutive agreeing odd intervals that re-seed the period (the octave guard).
   *  Three: a single rebound yields two. */
  octaveAfterOdd?: number;
  /** Missing the expected beat by this many periods enters `hold`. Above 2 so that a
   *  single dropped detection (an anchor at about two periods) free-runs through. */
  holdAfterPeriods?: number;
  /** Confidence decays by this factor per period once the expected beat is overdue. */
  confidenceDecayPerPeriod?: number;
  /** Consecutive anchors outside the attentional window (|phase error| above
   *  `lostPhaseError`) that drop the lock and re-seed from those anchors. */
  lostAfterMisses?: number;
  lostPhaseError?: number;
  /** An interval within this relative tolerance of half or double the period is
   *  "odd" (see the header). */
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
  confidenceFloor: 0.2,
  octaveAfterOdd: 3,
  holdAfterPeriods: 2.25,
  confidenceDecayPerPeriod: 0.5,
  lostAfterMisses: 2,
  lostPhaseError: 0.4,
  octaveTolerance: 0.15,
  initialTempo: 100,
  beatsPerBar: 4,
};

/** Agreement test for two intervals (within 20%). */
const agrees = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) && b > 0 && Math.abs(a - b) / b < 0.2;

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
  let prevAnchorT = NaN;
  let beatsPerBar = o.beatsPerBar;
  /** Anchors accepted since the last (re)start, for the ready → running transition. */
  let consecutive = 0;
  /** Consecutive anchors outside the attentional window (the lost-lock counter). */
  let misses = 0;
  /** Consecutive agreeing odd intervals, and the previous odd interval (octave guard). */
  let oddCount = 0;
  let lastOdd = NaN;
  /** Consecutive hold restarts and the interval the previous one arrived at (the
   *  halved-tempo escape from hold). */
  let holdRestarts = 0;
  let holdRestartIai = NaN;

  const freeRun = (dt: number) => {
    const dBeats = dt / period;
    phase += dBeats;
    beat += dBeats;
    phase -= Math.floor(phase);
  };

  const advanceTo = (tNew: number) => {
    if (!(tNew > t)) return;
    const dt = tNew - t;
    t = tNew;
    if (state !== 'running') return;
    freeRun(dt);
    // Missed the expected beat: confidence decays only once the beat is OVERDUE (past
    // one period since the last anchor), not during the normal free-run between
    // anchors, so a steady player converges on r; past the hold threshold, freeze.
    const sinceAnchor = t - lastAnchorT;
    if (sinceAnchor > period) {
      confidence *= Math.pow(o.confidenceDecayPerPeriod, Math.min(dt / period, (sinceAnchor - period) / period));
    }
    if (sinceAnchor > o.holdAfterPeriods * period) {
      state = 'hold';
      consecutive = 0;
    }
  };

  const seed = (p: number) => {
    period = p;
    pAvg = p;
  };

  const restartLock = (seedPeriod: number | null, conf: number) => {
    r = 0;
    kappa = o.kappaMin;
    misses = 0;
    oddCount = 0;
    lastOdd = NaN;
    phase = 0;
    beat = Math.round(beat);
    if (seedPeriod !== null && seedPeriod >= o.minPeriod && seedPeriod <= o.maxPeriod) {
      seed(seedPeriod);
      state = 'running';
      consecutive = 2;
      confidence = conf;
    } else {
      state = 'ready';
      consecutive = 1;
      confidence = 0;
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
      const c = Math.max(0, Math.min(1, a.confidence));
      // A weak anchor is not an observation: it touches nothing, not even the clock.
      if (!(c >= o.confidenceFloor)) return;
      const tNow = Math.max(t, a.t);
      const iai = a.t - lastAnchorT;
      // Out-of-order anchor: not usable as an interval; ignore it.
      if (Number.isFinite(lastAnchorT) && !(iai > 0)) return;
      // Bring the state to the anchor's own (refined) time: catch up if it is ahead of
      // the last advance (the normal case for a free-running caller), or rewind the
      // free-run if it is behind (the detector delivers an anchor one frame after the
      // sample that confirmed it), so the phase error is measured where the beat was.
      // The end of `update` re-advances to where the caller had got to.
      if (a.t > t) advanceTo(a.t);
      else if (a.t < t) {
        if (state === 'running') freeRun(a.t - t);
        t = a.t;
      }
      anchors++;

      if (state === 'ready' || state === 'hold') {
        prevAnchorT = lastAnchorT;
        lastAnchorT = a.t;
        misses = 0;
        if (state === 'hold') {
          // A preparatory beat after a hold: restart the phase at 0 with the kept
          // period; the beat count continues (the score does not rewind on a fermata).
          // Recurring holds that end at the same long interval mean the tempo really
          // halved (or the anchors come at half density): re-seed from that interval.
          if (holdRestarts >= 1 && agrees(iai, holdRestartIai)) {
            restartLock(iai, 0.3);
          } else {
            restartLock(period, 0.5);
          }
          holdRestarts++;
          holdRestartIai = iai;
          advanceTo(tNow);
          return;
        }
        holdRestarts = 0;
        if (Number.isFinite(iai) && iai >= o.minPeriod && iai <= o.maxPeriod) {
          seed(iai);
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
        advanceTo(tNow);
        return;
      }

      // Running: the circle-map correction.
      holdRestarts = 0;
      const e = wrapPhase(phase);
      const ratio = iai / period;
      const odd = Math.abs(ratio - 0.5) < o.octaveTolerance * 0.5 || Math.abs(ratio - 2) < o.octaveTolerance * 2;
      if (odd && agrees(iai, lastOdd)) oddCount++;
      else oddCount = odd ? 1 : 0;
      lastOdd = odd ? iai : NaN;
      const lost = Math.abs(e) > o.lostPhaseError ? ++misses >= o.lostAfterMisses : ((misses = 0), false);
      const reseed = oddCount >= o.octaveAfterOdd && iai >= o.minPeriod && iai <= o.maxPeriod;
      if (lost || reseed) {
        // Lost (two anchors in a row where the beat was not) or re-seeded (three odd
        // intervals that agree): restart from the last two anchors.
        restartLock(reseed ? iai : a.t - prevAnchorT, 0.3);
        prevAnchorT = lastAnchorT;
        lastAnchorT = a.t;
        advanceTo(tNow);
        return;
      }

      const g = Math.exp(kappa * (Math.cos(2 * Math.PI * e) - 1));
      const step = c * e * g;
      const dPhase = o.phaseGain * step;
      phase -= dPhase;
      beat -= dPhase;
      // The period is corrected from the running mean of accepted intervals (odd ones —
      // octave candidates, rebounds and dropped beats — are not folded in).
      if (!odd) pAvg += o.periodMemory * c * (iai - pAvg);
      period = Math.max(o.minPeriod, Math.min(o.maxPeriod, pAvg * (1 + o.periodGain * step)));
      phase -= Math.floor(phase);
      if (phase > 1 - 1e-9) phase = 0; // numerical hygiene: an exact hit is 0, not 0.999…
      r += o.dispersionGain * (Math.cos(2 * Math.PI * e) - r);
      kappa = Math.max(o.kappaMin, Math.min(o.kappaMax, kappaFromResultant(Math.max(0, r))));
      // Confidence rises with agreement (r is the resultant length of recent errors).
      confidence = Math.max(0, Math.min(1, 0.5 * confidence + 0.5 * Math.max(0, r)));
      prevAnchorT = lastAnchorT;
      lastAnchorT = a.t;
      consecutive++;
      advanceTo(tNow);
    },
    predict(): Prediction {
      const s = snapshot();
      // Window half-width from the dispersion: the pulse's circular standard deviation,
      // in seconds, clamped to a sane range.
      const circSd = Math.sqrt(-2 * Math.log(Math.min(0.999, Math.max(1e-6, r))));
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
      holdRestarts = 0;
      holdRestartIai = NaN;
      beatsPerBar = o.beatsPerBar;
    },
  };
}
