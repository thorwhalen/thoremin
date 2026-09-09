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
 * rhythm prior (anchors → musical time) and a dynamics estimator (anchors → dynamics
 * and articulation). Each is also exported on its own so a consumer with its own
 * anchor source (an audio onset detector, say) can skip the detector.
 */
import { createIctusDetector, type DetectorOptions, type IctusDetector } from './detector';
import { createAdaptiveOscillator, type OscillatorOptions } from './oscillator';
import { createDynamicsEstimator, type DynamicsEstimate, type DynamicsOptions } from './dynamics';
import type { Anchor, MusicalTime, RhythmPrior, Sample } from './types';

export * from './types';
export { createIctusDetector, parabolicOffset } from './detector';
export type { DetectorOptions, IctusDetector } from './detector';
export { createAdaptiveOscillator, kappaFromResultant } from './oscillator';
export type { OscillatorOptions } from './oscillator';
export { createDynamicsEstimator } from './dynamics';
export type { DynamicsEstimate, DynamicsEstimator, DynamicsOptions } from './dynamics';
export { fMeasure, cemgil, continuity, fitGrid, medianInterval } from './metrics';
export type { GridFit } from './metrics';

export interface IctusOptions {
  detector?: DetectorOptions;
  oscillator?: OscillatorOptions;
  dynamics?: DynamicsOptions;
  /** Supply a different prior (a Kalman filter, a multi-agent tracker) behind the same
   *  interface. Defaults to the adaptive oscillator. */
  prior?: RhythmPrior;
}

/** The state the facade publishes each call: musical time plus the expressive axes. */
export interface IctusState extends MusicalTime {
  dynamics: number;
  articulation: number;
  /** The anchor this sample produced, if any. */
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
  const prior = options.prior ?? createAdaptiveOscillator(options.oscillator);
  const dynamics = createDynamicsEstimator(options.dynamics);
  let lastAnchor: Anchor | null = null;

  const compose = (anchor: Anchor | null): IctusState => {
    const s = prior.state();
    const d: DynamicsEstimate = dynamics.current();
    return { ...s, dynamics: d.dynamics, articulation: d.articulation, anchor };
  };

  const takeAnchor = (a: Anchor): IctusState => {
    prior.update(a);
    dynamics.update(a);
    detector.setPeriod(prior.state().period);
    lastAnchor = a;
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
    state: () => compose(lastAnchor),
    reset() {
      detector.reset();
      prior.reset();
      dynamics.reset();
      lastAnchor = null;
    },
  };
}
