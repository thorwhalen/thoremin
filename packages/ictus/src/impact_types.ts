/**
 * The impact predictor's contract: its options and their defaults, the prediction and
 * confirmation events it emits, and the predictor interface. Moved out of `impact.ts`,
 * which re-exports what it exported; the predictor itself stays there.
 */
import type { Sample } from './types';

export type ImpactMode = 'surface' | 'air' | 'auto';

export interface ImpactPredictorOptions {
  /** Image coordinates: depth grows with `y`. False for a y-up frame. */
  yDown?: boolean;
  /** A KNOWN impact plane (depth, caller's units). When absent the floor is learned. */
  level?: number;
  /** How the floor and lag are learned from a confirmed stroke: `surface` (the kink
   *  of approach and departure), `air` (the turning parabola's vertex), or `auto`
   *  (per stroke, by the rebound ratio). */
  mode?: ImpactMode;
  /** A stroke whose rebound — the speed over the first sample past the bottom, over
   *  the approach speed at the crossing — is below this fraction is an air stroke
   *  (`auto`). A surface stroke leaves at about its arrival speed; an air stroke,
   *  from rest. The kind in force is the majority of the last three strokes. */
  airBelowRebound?: number;
  /** The post-hoc reference an air stroke's floor and lag are learned from: the
   *  vertex of the three-sample parabola around the bottom (`vertex`, default; the
   *  shipped ictus detector's estimate, 2 to 4 ms late on a sharp-arrival
   *  slow-departure turn) or the vertex of the quadratic through the DEPARTURE samples
   *  (`departure`: its velocity is zero at the turn, so its vertex is the turn when
   *  the samples are dense). At 24 and 30 fps three departure samples span 70 to
   *  125 ms, past where a departure is still one quadratic: where its fit is accepted
   *  it lands 10 to 35 ms early with a 21 to 28 ms spread, against the parabola's 5
   *  to 7, and the lag learned from it carried that spread into every prediction
   *  (#234, `docs/research/subframe-impact-prediction.md` §2.2 and §3.1.1). */
  airReference?: 'departure' | 'vertex';
  /** The lead the consumer needs, seconds, measured from the SAMPLE's time: a
   *  prediction is committed at the last sample that still leaves at least this
   *  much, given the sample period. 0 = as late as possible. A consumer that sees a
   *  sample later than it was captured (a camera pipeline) adds that age through
   *  {@link ImpactPredictor.setMinLead} before each push, so the lead is real at the
   *  moment of the decision. */
  minLead?: number;
  /** The slowest approach that is a stroke, in the caller's depth units per second
   *  (0 = no gate): a slow drift down and up spans as much depth as a stroke but
   *  never at a stroke's speed. */
  minApproachSpeed?: number;
  /** Approach samples needed before a prediction is trusted (3 = an exact quadratic). */
  minApproachSamples?: number;
  /** The approach fit uses the samples of the last this many seconds before the
   *  impact (at most `maxApproachSamples`): long enough to average tracker noise at
   *  60 fps, short enough that the early stroke, which is not yet a quadratic, stays
   *  out. */
  approachWindow?: number;
  /** A cap on the approach samples the fit uses. */
  maxApproachSamples?: number;
  /** A prediction is trusted once consecutive samples agree within this (seconds);
   *  NaN disables the check. */
  stabilityTolerance?: number;
  /** A prediction needs the point to have come down from its top by at least this
   *  fraction of the predicted stroke — and by the noise-unit and absolute floors —
   *  because the observed descent, not the predicted amplitude, is what says a stroke
   *  is under way (a fit through a few noise samples at rest can "reach" a floor a
   *  stroke away). It caps the achievable lead: a quadratic fall covers fraction f of
   *  its extent (1 − √f) of its duration before the impact, so 0.15 leaves about
   *  60 % of the fall (110 ms of a 180 ms stroke) for the prediction. */
  minDescentFraction?: number;
  /** Departure samples the kink fit uses (after the bottom), when they come fast. */
  departureSamples?: number;
  /** When the next descent starts before `departureSamples` have arrived (a slow
   *  camera at a fast tempo), the departure still teaches the floor if its samples
   *  (at least two) span this long after the bottom, seconds. Three samples are
   *  always preferred when they come: two fit a line, and a line learns a worse
   *  floor (the irregular-stamp air-drum test is the case). */
  departureWindow?: number;
  /** A stroke smaller than this fraction of the recent envelope is not a stroke. */
  minAmplitudeFraction?: number;
  /** A stroke must also exceed this many noise units (multiples of the online jitter). */
  minAmplitudeNoiseUnits?: number;
  /** An absolute amplitude floor in the caller's units (0 = relative gates only). A
   *  consumer that knows its units (pixels of a frame) sets it, because a clean,
   *  tiny oscillation before any real stroke has no envelope and no jitter to be
   *  small against. */
  minAmplitude?: number;
  /** Envelope decay per second (a player who starts beating smaller re-normalises). */
  envelopeDecayPerSecond?: number;
  /** How fast the learned floor follows, 0..1 per stroke (ignored with `level`). */
  levelGain?: number;
  /** How fast the learned lag follows, 0..1 per stroke. 0 = the crossing IS the estimate. */
  lagGain?: number;
  /** The reversal is confirmed when depth comes back from the running maximum by more
   *  than this many noise units (0 = any decrease). */
  reversalNoiseUnits?: number;
  /** A gap between samples longer than this restarts the history (the point was lost). */
  maxGap?: number;
  /** Initial period guess for the refractory window, seconds (`setPeriod` updates it). */
  initialPeriod?: number;
  /** Refractory window after a confirmation, as a fraction of the period. */
  refractoryFraction?: number;
}

export const DEFAULTS: Required<Omit<ImpactPredictorOptions, 'level'>> = {
  yDown: true,
  mode: 'auto',
  airBelowRebound: 0.5,
  airReference: 'vertex',
  minLead: 0.03,
  minApproachSpeed: 0,
  minApproachSamples: 3,
  approachWindow: 0.15,
  maxApproachSamples: 12,
  stabilityTolerance: 0.012,
  minDescentFraction: 0.15,
  departureSamples: 3,
  departureWindow: 0.1,
  minAmplitudeFraction: 0.2,
  minAmplitudeNoiseUnits: 20,
  minAmplitude: 0,
  envelopeDecayPerSecond: 0.9,
  levelGain: 0.5,
  lagGain: 0.3,
  reversalNoiseUnits: 2,
  maxGap: 0.5,
  initialPeriod: 0.6,
  refractoryFraction: 0.25,
};

export interface ImpactPrediction {
  kind: 'predict';
  /** The predicted impact time, seconds. */
  t: number;
  /** The sample time at which the prediction was committed. */
  at: number;
  /** `t - at`: how early the commitment came (negative = the stroke was already past). */
  lead: number;
  /** The predicted stroke amplitude relative to the recent envelope, 0..1+ (Dahl: the
   *  preparatory height predicts the dynamic). */
  strength: number;
  /** 0..1. */
  confidence: number;
  /** The extrapolated crossing before the learned lag was added. */
  crossing: number;
  /** Committed on its first usable fit, because waiting for a second to agree would
   *  have left too little lead (the stability check's bypass). A slow camera makes
   *  most predictions provisional; the harness counts them. */
  provisional: boolean;
  /** The floor the prediction was extrapolated to: the stroke's own when the consumer
   *  named one ({@link ImpactPredictor.setFloor}), else the learned or given one. */
  floor: number;
}

export interface ImpactConfirmation {
  kind: 'confirm';
  /** The refined post-hoc impact time, seconds. */
  t: number;
  /** The sample time that confirmed it (the first sample past the bottom). */
  at: number;
  /** The prediction this confirms, or null when the stroke was confirmed unpredicted. */
  predicted: number | null;
  /** `t - predicted` (null without a prediction): what a scheduler would have absorbed. */
  correction: number | null;
  strength: number;
  confidence: number;
  /** The three-sample parabola's vertex time (the existing ictus detector's estimate). */
  vertex: number;
  /** The approach's extrapolated crossing of the floor (NaN without a usable approach). */
  crossing: number;
  /** The floor that crossing was taken against: the stroke's own
   *  ({@link ImpactPredictor.setFloor}), else the learned or given one, else (before any)
   *  the stroke's own depth. */
  floor: number;
  /** The depth the stroke reached (the vertex depth, caller's units). */
  depth: number;
  /** The depth it started from ({@link ImpactPredictor.top}). */
  top: number;
  /** Diagnostics of the approach fit at confirmation: how many samples it used, the
   *  velocity it extrapolated at the bottom, and the crossing offset it found (τ from
   *  the bottom sample; `reaches` false = it turned above the floor). Null when
   *  there were too few approach samples. */
  fit: { samples: number; b: number; tau: number; reaches: boolean } | null;
}

export type ImpactEvent = ImpactPrediction | ImpactConfirmation;

export interface ImpactPredictor {
  /** Feed one sample; returns the events this sample produced (usually none). */
  push(sample: Sample): ImpactEvent[];
  /** The current period estimate for the refractory window (the prior calls this). */
  setPeriod(period: number): void;
  /** The lead the next prediction must leave from its sample's time, seconds (see
   *  the option): a consumer whose samples are older than "now" adds their age. */
  setMinLead(lead: number): void;
  /** The floor the stroke in progress is heading for (depth, caller's units), when the
   *  consumer knows more than one depth strokes stop at (an air drum's pads, #353): the
   *  prediction extrapolates to it and the confirmation's crossing is taken against it,
   *  in place of the one learned floor. NaN (the default) = the learned or given floor.
   *  It stays until changed, so a consumer sets it before each push, as with
   *  {@link setMinLead}. The learned floor keeps learning from every stroke: a consumer
   *  that names floors learns its own from the confirmations' `depth` and `top`. While
   *  one is named, a stroke also starts where the point stops descending short of a
   *  stroke (an arm carrying the stick down to a lower pad and waiting there), not only
   *  at the least depth since the last confirmation. */
  setFloor(floor: number): void;
  /** The depth the stroke in progress started from (caller's units): the least depth
   *  since the last confirmation, or, while a floor is named ({@link setFloor}), where
   *  the point last stopped descending before its descent was a stroke. NaN between
   *  strokes. */
  top(): number;
  /** The learned floor (depth, caller's units); NaN until learned. */
  level(): number;
  /** The learned lag (seconds). */
  lag(): number;
  /** The amplitude envelope (caller's units). */
  envelope(): number;
  /** The kind the last learned stroke was classified as (`auto`). */
  lastKind(): 'surface' | 'air' | null;
  /** Forget the descent in progress, prediction included: the consumer knows something
   *  the depth alone cannot (the stick was carried down, not swung: #261) and has
   *  refused it. The next sample is the top of a new stroke; the learned floor, lag and
   *  envelope stay, so the refusal costs nothing the next stroke needs. */
  dropStroke(): void;
  /** Strokes confirmed while the floor is still unlearned (0 once it is, or when it
   *  is given). A consumer that sees this climb past a few knows the departures are
   *  being abandoned — the camera is too slow for prediction at this tempo — and can
   *  say so instead of asking for one more stroke. */
  unlearnedConfirmations(): number;
  reset(): void;
}
