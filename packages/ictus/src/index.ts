/**
 * ictus — infer musical time (beat, phase, tempo, dynamics) from low-rate gesture.
 *
 * Pure, causal, framework-agnostic: no DAG, React, DOM or clock imports. The thoremin
 * `conductor` node and the body epic's pacer are its first two consumers; the plan is
 * to extract it as the `ictus` package (thoremin #178), so nothing in here may import
 * from outside this directory. See `README.md` here for the design, and
 * `docs/research/conducting-and-virtual-orchestra-research-map.md` §7 for why.
 *
 * {@link createIctus} composes the three parts: a detector (samples → anchors), a
 * rhythm prior (anchors → musical time; one of three by name, see
 * {@link createRhythmPrior}) and a dynamics estimator (anchors → dynamics and
 * articulation). Each is also exported on its own so a consumer with its own anchor
 * source (an audio onset detector, say) can skip the detector.
 */
import { createIctusDetector, type DetectorOptions, type IctusDetector } from './detector';
import { createRhythmPrior, type RhythmPriorKind, type RhythmPriorOptions } from './priors';
import { createDynamicsEstimator, type DynamicsEstimate, type DynamicsOptions } from './dynamics';
import type { Anchor, MusicalTime, RhythmPrior, Sample } from './types';

export * from './types';
export { createIctusDetector, parabolicOffset, excursion } from './detector';
export type { DetectorOptions, IctusDetector, Prefilter } from './detector';
export { createAdaptiveOscillator, kappaFromResultant } from './oscillator';
export type { AdaptiveOscillator, OscillatorOptions } from './oscillator';
export { createDynamicsEstimator } from './dynamics';
export type { DynamicsEstimate, DynamicsEstimator, DynamicsOptions } from './dynamics';
export { fMeasure, cemgil, continuity, fitGrid, medianInterval } from './metrics';
export type { GridFit } from './metrics';
export { createImpactPredictor, fitQuadratic, fitLine, crossingTau, intersectionTau, expectedGap } from './impact';
export type { ImpactPredictor, ImpactPredictorOptions, ImpactEvent, ImpactPrediction, ImpactConfirmation, ImpactMode, Quadratic } from './impact';
export { LAG_MIN_STROKES, LAG_STROKES, lagGate, magnetise, nearestExpectedBeat } from './magnet';
export type { LagGate, LagGateOptions, MagnetOptions, MagnetResult } from './magnet';
export { createTrendPrior } from './trend_prior';
export type { TrendPriorOptions } from './trend_prior';
export { createBlendPrior, TREND_DEFAULTS } from './blend_prior';
export type { BlendPrior, BlendPriorOptions } from './blend_prior';
export { createPulseFollower, acfPeaks, fitSine, refinePeriod, PULSE_DEFAULTS, PULSE_TRUSTED_CONFIDENCE, UNKNOWN_PULSE } from './pulse';
export type { PulseFollower, PulseLevel, PulseOptions, PulseState } from './pulse';
export { createPaceController, relatePeriods, paceRatios, PACE_DEFAULTS } from './pace';
export type { PaceController, PaceInput, PaceMode, PaceOptions, PaceState } from './pace';
export { createScheduler, SCHEDULER_DEFAULTS } from './scheduler';
export { trackSongGrid, songTimeAt, beatIndexAt, songTimeOfBeat, hasGrid, onsetEnvelopes, lsLine, toMono, EMPTY_SONG_GRID, SONG_GRID_DEFAULTS, SONG_GRID_SOURCE } from './song_grid';
export type { SongGrid, SongGridOptions } from './song_grid';
export type { Scheduler, SchedulerOptions, ScheduleCommand, ScheduleTick, ScoreEvent } from './scheduler';

export { createRhythmPrior, DEFAULT_RHYTHM_PRIOR, RHYTHM_PRIOR_KINDS } from './priors';
export type { RhythmPriorKind, RhythmPriorOptions } from './priors';

export interface IctusOptions extends RhythmPriorOptions {
  detector?: DetectorOptions;
  dynamics?: DynamicsOptions;
  /** The prior by name (see {@link RhythmPriorKind}; the blend by default), or an
   *  instance (a Kalman filter, a multi-agent tracker) behind the same interface. */
  prior?: RhythmPrior | RhythmPriorKind;
}

/** The state the facade publishes each call: musical time plus the expressive axes. */
export interface IctusState extends MusicalTime {
  dynamics: number;
  articulation: number;
  /** The anchor this call produced, if any (null from `state()` and `advance()`). */
  anchor: Anchor | null;
}

export interface Ictus {
  /** Feed one tracked-point sample; returns the state at `sample.t`. */
  feed(sample: Sample): IctusState;
  /** Feed an anchor from an external detector; returns the state at `anchor.t`. */
  feedAnchor(anchor: Anchor): IctusState;
  /** Free-run to `t` (no observation) and return the state. */
  advance(t: number): IctusState;
  state(): IctusState;
  /** The parts, for tests and for consumers that need one of them directly. */
  readonly detector: IctusDetector;
  readonly prior: RhythmPrior;
  reset(): void;
}

export function createIctus(options: IctusOptions = {}): Ictus {
  const detector = createIctusDetector(options.detector);
  const prior = typeof options.prior === 'object' ? options.prior : createRhythmPrior(options.prior, options);
  const dynamics = createDynamicsEstimator(options.dynamics);

  const compose = (anchor: Anchor | null): IctusState => {
    const s = prior.state();
    const d: DynamicsEstimate = dynamics.current();
    return { ...s, dynamics: d.dynamics, articulation: d.articulation, anchor };
  };

  const takeAnchor = (a: Anchor): IctusState => {
    prior.update(a);
    dynamics.update(a);
    detector.setPeriod(prior.state().period);
    return compose(a);
  };

  return {
    detector,
    prior,
    feed(sample) {
      const a = detector.push(sample);
      if (a) return takeAnchor(a);
      prior.advance(sample.t);
      return compose(null);
    },
    feedAnchor: takeAnchor,
    advance(t) {
      prior.advance(t);
      return compose(null);
    },
    state: () => compose(null),
    reset() {
      detector.reset();
      prior.reset();
      dynamics.reset();
    },
  };
}
