/**
 * The impact predictor — samples of one striking point in, impact events out, BEFORE
 * the frame that shows the impact has been captured.
 *
 * The problem (`docs/research/intent-and-subframe-timing.md` §5.2, §5.3): a camera at
 * 24-60 fps observes a strike only after it happened, up to a frame late, and the
 * reactive chain behind it adds 50-100 ms more. A drum hit has to sound *at* the hit.
 * So the sound must be committed from the approach, which is prediction under a
 * movement model — the same thing a player does when they anticipate a beat.
 *
 * The movement model is the stereotyped stroke: the approach to an impact is, to a
 * good approximation, constant acceleration (a stick or a hand falling, a wrist
 * snapping down: a quadratic in time), and a surface impact happens where that
 * trajectory reaches a PLANE. The plane is the constraint that makes the surface case
 * well-posed: a least-squares quadratic through the last few approach samples,
 * extrapolated to the plane, gives the impact time while the stick is still tens of
 * milliseconds above the table, and every new sample sharpens it. An "air" impact
 * (a stroke that reverses in mid-air, the air-drum critique) has no plane. What it
 * has instead is the player's own repetition: the depth the strokes turn at is
 * consistent, so the plane can be LEARNED from confirmed reversals, and the time
 * between the extrapolated crossing and the observed turning point (the braking the
 * extrapolation cannot see) is a per-player constant that is learned with it.
 *
 * The two kinds differ in what the frames show after the bottom, and the predictor
 * uses that to learn under the right rule (`mode: 'auto'`): a surface stroke rebounds
 * at about its approach speed (a kink: the plane is where the approach and departure
 * fits intersect, and the kink time is the unbiased post-hoc impact time); an air
 * stroke leaves slowly (a smooth turn: the three-sample parabola's vertex is the
 * turning point, and its depth the floor). A known plane (`level`) skips the
 * learning for a calibrated surface.
 *
 * One stroke, two events:
 *
 * 1. **`predict`** — emitted ONCE per stroke, as late as it can be while still at
 *    least `minLead` seconds ahead of the predicted impact (the lead the consumer
 *    needs to schedule sound: audio output latency plus a margin), given the sample
 *    period: at the first sample where waiting for the next one would leave too
 *    little lead. Requires enough approach samples, a stroke big enough to be a
 *    stroke, and a prediction that agrees with the previous sample's. Committed
 *    events are never moved (the scheduler's rule): a better estimate corrects the
 *    NEXT stroke, not the sound already scheduled.
 * 2. **`confirm`** — at the first sample on the far side of the bottom, carrying the
 *    refined post-hoc time (`t`: the approach crossing of the floor plus the learned
 *    lag), the prediction it confirms and the correction between them. A stroke too
 *    fast to predict is confirmed without a prediction: the reactive, always-late
 *    case. Then, two samples later, the departure is fitted and the floor and lag are
 *    updated for the next stroke.
 *
 * Two things the slow column of the timing plan (2026-10-05, step 1b) made explicit.
 * The commit deadline — "would waiting for the next sample leave too little lead?" —
 * needs the NEXT gap, and the last gap is a poor guess for it when inference paces
 * the samples (a slow laptop stamps 33 then 67 ms, alternating): waiting on a 33 ms
 * guess for a sample that comes 67 ms later commits short, or finds the bottom
 * already past and the stroke a ghost. So the deadline uses a high quantile of the
 * recent gaps. And the departure that teaches the floor was a COUNT of samples (3),
 * which at 15 fps is 200 ms of settling: at 150 bpm the next descent starts first,
 * the learning is abandoned every stroke, the floor never exists, and since a commit
 * needs a floor the predictor never commits while the panel keeps asking the player
 * to strike once. The departure is now a span of time as well, so two samples 67 ms
 * apart teach what three at 33 ms did; a consumer that still sees no floor after a
 * few confirmations can say "camera too slow for prediction"
 * ({@link ImpactPredictor.unlearnedConfirmations}).
 *
 * One floor or several (#353). The learned floor is one depth, the right model for
 * strokes that stop at one place. A consumer whose strokes stop at several (an air
 * drum's pads at different heights) names the floor of each stroke in progress
 * (`setFloor`): the prediction and the confirmation's crossing are taken against it, the
 * events carry it (`floor`) and the stroke's top (`top`), and while one is named a point
 * that stops descending before its descent is a stroke starts the stroke there (an arm
 * that carried the stick down to a lower pad and waits), not at the least depth since
 * the last confirmation. Named nothing, the predictor is unchanged bit for bit.
 *
 * What it does NOT do: decide where the beat is, or snap anything to a grid. Those
 * are the rhythm prior's job (`oscillator.ts`) and the magnet's (`magnet.ts`); a
 * confirmation is an {@link Anchor} for the prior, a prediction is what the magnet
 * pulls toward the grid.
 *
 * Coordinates: the "depth" `d` grows toward the impact (image `y` grows downward, so
 * a downward strike has increasing `d`; `yDown: false` for a y-up frame). Units are
 * the caller's: every gate is relative to the player's own recent strokes and to the
 * online jitter estimate, as in `detector.ts`. Pure, causal, no clock.
 */
import { clamp01, ewUpdate, median3 } from '@thoremin/stats';
import { crossingTau, evalQ, fitLine, fitQuadratic, intersectionTau, vertexOf, type Quadratic } from './impact_fit';
import { GAP_WINDOW, JITTER_WINDOW, JitterEstimator, expectedGap } from './impact_sampling';
import { DEFAULTS, type ImpactConfirmation, type ImpactEvent, type ImpactPrediction, type ImpactPredictor, type ImpactPredictorOptions } from './impact_types';

export { fitQuadratic, fitLine, crossingTau, intersectionTau } from './impact_fit';
export type { Quadratic } from './impact_fit';
export { expectedGap } from './impact_sampling';
export type { ImpactMode, ImpactPredictorOptions, ImpactPrediction, ImpactConfirmation, ImpactEvent, ImpactPredictor } from './impact_types';

/** The fewest departure samples a floor can be learned from (a line fit). */
const MIN_DEPARTURE_SAMPLES = 2;

/** A confirmed stroke waiting for its departure samples so the floor can be learned. */
interface Learning {
  /** Approach fit with origin at the bottom sample's time. */
  approach: Quadratic | null;
  bottomT: number;
  bottomD: number;
  vertexT: number;
  vertexD: number;
  /** The approach crossing of the floor in effect at confirmation (absolute). */
  crossing: number;
  /** Approach speed at the crossing (depth units / s). */
  approachSpeed: number;
  departT: number[];
  departD: number[];
}

export function createImpactPredictor(options: ImpactPredictorOptions = {}): ImpactPredictor {
  const o = { ...DEFAULTS, ...options };
  const sign = o.yDown ? 1 : -1;
  let minLead = o.minLead;
  const levelKnown = typeof options.level === 'number' && Number.isFinite(options.level);

  // The stroke in progress: samples since the top (the least depth since the last
  // confirmation), bounded.
  const ts: number[] = [];
  const ds: number[] = [];
  let prevD = NaN;
  let prev2D = NaN;
  let prevT = NaN;
  let lastT = -Infinity;
  let topD = Infinity;
  let maxD = -Infinity;
  let maxT = NaN;
  /** The fastest downward step of the stroke in progress (depth units per second). */
  let peakSpeed = 0;
  let level = levelKnown ? (options.level as number) : NaN;
  /** The consumer's floor for the stroke in progress (`setFloor`), NaN for none. */
  let strokeFloor = NaN;
  /** The floor a stroke is predicted against and confirmed against. */
  const floorNow = () => (Number.isFinite(strokeFloor) ? strokeFloor : level);
  let lag = 0;
  let lagN = 0;
  let envelope = 0;
  let envelopeT = NaN;
  const jitterEst = new JitterEstimator();
  let period = o.initialPeriod;
  let lastConfirmT = -Infinity;
  let committed: ImpactPrediction | null = null;
  let tentative = NaN;
  let learning: Learning | null = null;
  /** The refractory clock and the envelope as they were before the stroke now awaiting
   *  its departure was confirmed (null once it has been learned or dropped). */
  let confirmed: { lastConfirmT: number; envelope: number } | null = null;
  let lastKind: 'surface' | 'air' | null = null;
  const votes: ('surface' | 'air')[] = [];
  /** The last few sample gaps (the deadline's expectation of the next one). */
  const gaps: number[] = [];
  let unlearned = 0;

  const clearStroke = () => {
    ts.length = 0;
    ds.length = 0;
    topD = Infinity;
    maxD = -Infinity;
    maxT = NaN;
    peakSpeed = 0;
    committed = null;
    tentative = NaN;
  };
  const clearHistory = () => {
    clearStroke();
    prevD = NaN;
    prev2D = NaN;
    prevT = NaN;
    learning = null;
    gaps.length = 0;
  };

  const decayEnvelope = (t: number) => {
    if (Number.isFinite(envelopeT) && t > envelopeT) envelope *= Math.pow(o.envelopeDecayPerSecond, t - envelopeT);
    envelopeT = t;
  };

  const passesAmplitude = (amplitude: number): boolean => {
    if (!(amplitude > 0)) return false;
    if (amplitude < o.minAmplitude) return false;
    // Warm-up: until the jitter estimate has enough residuals to mean anything, a
    // stroke must be big against something — the envelope or the absolute floor.
    if (jitterEst.count() < JITTER_WINDOW / 2 && envelope <= 0 && !(o.minAmplitude > 0)) return false;
    const jitter = jitterEst.value();
    if (Number.isFinite(jitter) && amplitude < o.minAmplitudeNoiseUnits * jitter) return false;
    if (envelope > 0 && amplitude < o.minAmplitudeFraction * envelope) return false;
    return true;
  };
  /** While the consumer names the stroke's floor (strokes stop at more than one depth),
   *  the point stopping its descent (still or rising, against the last sample) before
   *  that descent was a stroke, nothing committed, starts the stroke here, whatever the
   *  least depth since the last confirmation was. With one floor every stroke starts
   *  from about the same top and the least depth is it; with several it is not: an arm
   *  that carried the stick DOWN to a lower pad and waits there (#353) begins its stroke
   *  at the wait, not at the last pad's top, so the approach fit holds this stroke's fall
   *  and not the carry, and the top (`top()`, and so the stroke's amplitude) is its own.
   *  A stroke's dwell at its bottom comes after a stroke-sized, stroke-fast descent and
   *  never restarts. */
  const restartsHere = (d: number): boolean => {
    if (!Number.isFinite(strokeFloor) || committed || !Number.isFinite(prevD) || d > prevD) return false;
    const strokeLike = passesAmplitude(maxD - topD) && (!(o.minApproachSpeed > 0) || peakSpeed >= o.minApproachSpeed);
    return !strokeLike;
  };
  const strengthOf = (amplitude: number) => (envelope > 0 ? amplitude / envelope : 1);

  /** The first history index of the approach fit ending just before `end`: the samples
   *  within `approachWindow` of the last one, at least `minApproachSamples` when the
   *  history has them, at most `maxApproachSamples`. */
  const approachStart = (end: number): number => {
    const last = ts[end - 1];
    let from = end;
    while (from > 0 && end - from < o.maxApproachSamples && (last - ts[from - 1] <= o.approachWindow || end - from < o.minApproachSamples)) from--;
    return from;
  };

  const learnLag = (observed: number) => {
    if (!(o.lagGain > 0) || !Number.isFinite(observed)) return;
    lag = lagN === 0 ? observed : lag + o.lagGain * (observed - lag);
    lagN++;
  };
  const learnLevel = (observed: number) => {
    if (levelKnown || !Number.isFinite(observed)) return;
    level = ewUpdate(level, observed, o.levelGain);
    unlearned = 0;
  };

  /** The departure is in: classify the stroke and learn the floor and lag. */
  const finishLearning = (L: Learning) => {
    learning = null;
    confirmed = null;
    const { approach } = L;
    if (!approach) {
      // No usable approach: learn what the vertex says, under the air rule.
      learnLevel(L.vertexD);
      return;
    }
    const departure = L.departT.length >= 3 ? fitQuadratic(L.departT, L.departD, L.bottomT) : fitLine(L.departT, L.departD, L.bottomT);
    let kind: 'surface' | 'air' = o.mode === 'auto' ? 'air' : o.mode;
    let kinkTau = NaN;
    if (departure) kinkTau = intersectionTau(approach, departure, 0);
    if (o.mode === 'auto') {
      // The rebound: the speed over the first step past the bottom, over the approach
      // speed at the crossing. Voted over the last three strokes.
      const step = (L.bottomD - L.departD[0]) / Math.max(1e-6, L.departT[0] - L.bottomT);
      const ratio = L.approachSpeed > 0 ? Math.abs(step) / L.approachSpeed : 0;
      votes.push(ratio < o.airBelowRebound ? 'air' : 'surface');
      if (votes.length > 3) votes.shift();
      const airVotes = votes.filter((v) => v === 'air').length;
      kind = airVotes * 2 > votes.length ? 'air' : airVotes * 2 === votes.length ? votes[votes.length - 1] : 'surface';
    }
    lastKind = kind;
    const dtDep = L.departT[0] - L.bottomT;
    if (kind === 'surface' && Number.isFinite(kinkTau) && Math.abs(kinkTau) < 2 * dtDep) {
      const kinkT = L.bottomT + kinkTau;
      learnLevel(evalQ(approach, kinkTau));
      learnLag(kinkT - L.crossing);
      return;
    }
    // Air: the turn is where the departure's velocity is zero — its quadratic's
    // vertex, when the fit is a cap with its vertex near the bottom sample.
    let refT = L.vertexT;
    let refD = L.vertexD;
    if (o.airReference === 'departure' && departure && departure.c < 0) {
      const tv = -departure.b / (2 * departure.c);
      const dt = L.departT[0] - L.bottomT;
      if (tv > -2 * dt && tv < 2 * dt) {
        refT = L.bottomT + tv;
        refD = evalQ(departure, tv);
      }
    }
    learnLevel(refD);
    learnLag(refT - L.crossing);
  };

  return {
    push(s) {
      const events: ImpactEvent[] = [];
      const t = s.t;
      const d = sign * s.y;
      if (t < lastT || t - lastT > o.maxGap) clearHistory();
      const dt = Number.isFinite(prevT) ? t - prevT : NaN;
      lastT = t;
      if (dt > 0) {
        gaps.push(dt);
        if (gaps.length > GAP_WINDOW) gaps.shift();
      }
      decayEnvelope(t);

      // Online jitter: the residual of the previous sample against the median of its
      // neighbours (the `enroll/noise.ts` convention), in the caller's units.
      if (Number.isFinite(prev2D) && Number.isFinite(prevD)) jitterEst.push(Math.abs(prevD - median3(prev2D, prevD, d)));
      const jitter = jitterEst.value();
      const margin = Number.isFinite(jitter) ? o.reversalNoiseUnits * jitter : 0;

      // 0. A stroke waiting for its departure: collect samples while moving away from
      //    the floor; a new descent before enough arrived abandons the learning.
      if (learning) {
        const L = learning;
        const lastDep = L.departD.length ? L.departD[L.departD.length - 1] : L.bottomD;
        if (d < lastDep + margin) {
          L.departT.push(t);
          L.departD.push(d);
          if (L.departT.length >= o.departureSamples) finishLearning(L);
        } else if (L.departT.length >= MIN_DEPARTURE_SAMPLES && L.departT[L.departT.length - 1] - L.bottomT >= o.departureWindow) {
          // The next descent came before the third departure sample (a slow camera at
          // a fast tempo): what the departure did span teaches the floor, as a line.
          finishLearning(L);
        } else {
          learning = null;
          confirmed = null;
        }
      }

      // 1. The reversal: depth came back up from the running maximum by more than the
      //    noise margin, and the stroke was big enough. Confirm at THIS sample.
      // A stroke whose fastest step never reached the speed floor is a drift (a slow
      // sweep spans a stroke's depth but never at a stroke's speed): no event; the
      // history simply carries on, and nothing here delays the next real stroke.
      const fastEnough = !(o.minApproachSpeed > 0) || peakSpeed >= o.minApproachSpeed;
      if (ts.length >= 1 && d < maxD - margin && fastEnough && t - lastConfirmT >= o.refractoryFraction * period) {
        const amplitude = maxD - topD;
        if (passesAmplitude(amplitude)) {
          const iMax = ts.lastIndexOf(maxT);
          const aT = iMax > 0 ? ts[iMax - 1] : NaN;
          const aD = iMax > 0 ? ds[iMax - 1] : NaN;
          const v = Number.isFinite(aT) ? vertexOf(aT, aD, maxT, maxD, t, d) : { t: maxT, d: maxD };
          // The approach fit over the samples BEFORE the bottom (the bottom sample may
          // sit on the surface or be blurred across it), origin at the bottom.
          const from = approachStart(iMax);
          const approach = iMax - from >= o.minApproachSamples ? fitQuadratic(ts.slice(from, iMax), ds.slice(from, iMax), maxT) : null;
          const floor = Number.isFinite(floorNow()) ? floorNow() : v.d;
          let crossing = NaN;
          let approachSpeed = NaN;
          let fit: ImpactConfirmation['fit'] = null;
          if (approach) {
            const x = crossingTau(approach, floor, true);
            fit = { samples: iMax - from, b: approach.b, tau: x.tau, reaches: x.reaches };
            // Only a crossing near the bottom is the impact (the fit is local).
            if (approach.b > 0 && Number.isFinite(x.tau) && Math.abs(x.tau) < 2 * (Number.isFinite(dt) ? dt : 0.05)) {
              crossing = maxT + x.tau;
              approachSpeed = Math.abs(approach.b + 2 * approach.c * x.tau);
            }
          }
          // The post-hoc estimate: for a surface stroke the approach crossing plus
          // the learned lag (the crossing is exact where the plane is); for an air
          // stroke the three-sample vertex (the smooth turn is what a parabola fits,
          // and the crossing sits a brake's length early). The kind is the last
          // learned one — strokes repeat — until this stroke's departure is seen.
          const airLike = o.mode === 'air' || (o.mode === 'auto' && lastKind === 'air');
          const refined = Number.isFinite(crossing) && !airLike ? crossing + lag : v.t;
          const strength = strengthOf(amplitude);
          events.push({
            kind: 'confirm',
            t: refined,
            at: t,
            predicted: committed ? committed.t : null,
            correction: committed ? refined - committed.t : null,
            strength,
            confidence: clamp01(strength),
            vertex: v.t,
            crossing,
            floor,
            depth: v.d,
            top: topD,
            fit,
          });
          learning = {
            approach: Number.isFinite(crossing) ? approach : null,
            bottomT: maxT,
            bottomD: maxD,
            vertexT: v.t,
            vertexD: v.d,
            crossing,
            approachSpeed,
            departT: [t],
            departD: [d],
          };
          // What the confirmation changed, so a consumer refusing this stroke
          // (`dropStroke`) can put it back.
          confirmed = { lastConfirmT, envelope };
          envelope = Math.max(envelope, amplitude);
          lastConfirmT = t;
          if (!Number.isFinite(level)) unlearned++;
          clearStroke();
        }
      }

      // 2. Track the stroke: at (or within noise of) the least depth since the last
      //    confirmation, the approach has not started — the history begins here.
      const fresh = d <= topD + margin;
      if (fresh || restartsHere(d)) {
        ts.length = 0;
        ds.length = 0;
        topD = fresh ? Math.min(topD, d) : d;
        maxD = -Infinity;
        maxT = NaN;
        peakSpeed = 0;
        committed = null;
        tentative = NaN;
      }
      ts.push(t);
      ds.push(d);
      if (Number.isFinite(prevD) && Number.isFinite(dt) && dt > 0 && d > prevD) peakSpeed = Math.max(peakSpeed, (d - prevD) / dt);
      if (d > maxD) {
        maxD = d;
        maxT = t;
      }
      const keep = o.maxApproachSamples + 3;
      if (ts.length > keep) {
        ts.splice(0, ts.length - keep);
        ds.splice(0, ds.length - keep);
      }

      // 3. Predict, while descending toward a known or learned floor and not yet
      //    committed for this stroke.
      const floor = floorNow();
      if (!committed && Number.isFinite(floor) && d > prevD && ts.length >= o.minApproachSamples) {
        const from = approachStart(ts.length);
        const f = ts.length - from >= o.minApproachSamples ? fitQuadratic(ts.slice(from), ds.slice(from), t) : null;
        if (f && f.b > 0) {
          const x = crossingTau(f, floor);
          // The speed gate for a prediction is the speed the fit EXPECTS at the crossing
          // (a stroke speeds up into its hit; gating on the speed now would wait until
          // the hand is already fast, and cost a soft stroke its lead).
          const expectedSpeed = Number.isFinite(x.tau) ? Math.abs(f.b + 2 * f.c * x.tau) : 0;
          if (Number.isFinite(x.tau) && Math.max(expectedSpeed, peakSpeed) >= o.minApproachSpeed) {
            const crossing = t + x.tau;
            const tPred = crossing + lag;
            const amplitude = floor - topD;
            // The point must have actually come part of the way down: a fit through a
            // few noise samples at rest can "reach" a floor a stroke away. The
            // tentative prediction only starts counting once it has (a fit from before
            // is not one this one has to agree with).
            const jit = jitterEst.value();
            const descent = d - topD;
            const descended =
              descent >= o.minDescentFraction * amplitude &&
              descent >= o.minAmplitude * 0.5 &&
              (!Number.isFinite(jit) || descent >= o.minAmplitudeNoiseUnits * jit);
            const agrees = descended && Number.isFinite(tentative) && Math.abs(tPred - tentative) <= o.stabilityTolerance;
            const first = descended && !Number.isFinite(tentative);
            if (descended) tentative = tPred;
            const lead = tPred - t;
            // As late as possible: commit now if the next sample — expected no sooner
            // than most recent gaps, not merely the last one — would leave less than
            // the needed lead, allowing for the prediction still moving by its
            // tolerance; a stroke whose first usable fit is already the last chance
            // commits on it rather than a frame late.
            const gap = expectedGap(gaps);
            const lastChance = !Number.isFinite(gap) || lead - gap - o.stabilityTolerance < minLead;
            const provisional = !agrees && first && lastChance;
            const stable = !Number.isFinite(o.stabilityTolerance) || agrees || provisional;
            if (stable && lastChance && descended && passesAmplitude(amplitude) && t - lastConfirmT >= o.refractoryFraction * period) {
              const strength = strengthOf(amplitude);
              committed = { kind: 'predict', t: tPred, at: t, lead, strength, confidence: clamp01(strength), crossing, provisional, floor };
              events.push(committed);
            }
          }
        }
      }

      prev2D = prevD;
      prevD = d;
      prevT = t;
      return events;
    },
    setPeriod(p) {
      if (Number.isFinite(p) && p > 0) period = p;
    },
    setMinLead(lead) {
      if (Number.isFinite(lead)) minLead = Math.max(0, lead);
    },
    setFloor(floor) {
      strokeFloor = Number.isFinite(floor) ? floor : NaN;
    },
    top: () => (Number.isFinite(topD) ? topD : NaN),
    level: () => level,
    lag: () => lag,
    envelope: () => envelope,
    lastKind: () => lastKind,
    dropStroke() {
      // The stroke's history goes; `topD = Infinity` makes the next sample a new top.
      clearStroke();
      // A stroke already confirmed (the consumer refused it on confirmation) must not
      // teach the floor or the lag, start the refractory period, or grow the envelope.
      if (learning && confirmed) {
        lastConfirmT = confirmed.lastConfirmT;
        envelope = confirmed.envelope;
      }
      learning = null;
      confirmed = null;
    },
    unlearnedConfirmations: () => unlearned,
    reset() {
      clearHistory();
      unlearned = 0;
      lastT = -Infinity;
      level = levelKnown ? (options.level as number) : NaN;
      strokeFloor = NaN;
      lag = 0;
      lagN = 0;
      envelope = 0;
      envelopeT = NaN;
      jitterEst.reset();
      period = o.initialPeriod;
      lastConfirmT = -Infinity;
      lastKind = null;
      votes.length = 0;
    },
  };
}
