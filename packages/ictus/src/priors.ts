/**
 * The rhythm priors by name: one module, so that every consumer inside the package
 * (the conductor's `createIctus` in `index.ts`, the pulse follower in `pulse.ts`)
 * imports the factory without importing the package's barrel.
 */
import { createAdaptiveOscillator, type OscillatorOptions } from './oscillator';
import { createTrendPrior, type TrendPriorOptions } from './trend_prior';
import { createBlendPrior, TREND_DEFAULTS, type BlendPriorOptions } from './blend_prior';
import type { RhythmPrior } from './types';

/** The priors a consumer selects by name: the adaptive oscillator (the v1 prior,
 *  robust to a stray anchor, 65 to 75 ms late under an accelerando), the trend prior
 *  (a tempo trend, no lag, pulled by a stray anchor for its whole memory) and the
 *  blend (the oscillator until its grid is biased, then the trend; the default since
 *  #232). */
export const RHYTHM_PRIOR_KINDS = ['oscillator', 'trend', 'blend'] as const;
export type RhythmPriorKind = (typeof RHYTHM_PRIOR_KINDS)[number];
export const DEFAULT_RHYTHM_PRIOR: RhythmPriorKind = 'blend';

export interface RhythmPriorOptions {
  oscillator?: OscillatorOptions;
  trend?: TrendPriorOptions;
  blend?: BlendPriorOptions;
}

/** Build a prior by name. The blend takes the oscillator and trend options too, for
 *  its two halves, so a consumer tuning the oscillator's gains need not know which
 *  prior is in use. `trend` by name is the bench's best, `trend12q` ({@link
 *  TREND_DEFAULTS}), the same fit the blend's trend half runs; `createTrendPrior`'s
 *  own, faster defaults stay what they are for a caller building one directly. */
export function createRhythmPrior(kind: RhythmPriorKind = DEFAULT_RHYTHM_PRIOR, options: RhythmPriorOptions = {}): RhythmPrior {
  switch (kind) {
    case 'oscillator':
      return createAdaptiveOscillator(options.oscillator);
    case 'trend':
      return createTrendPrior({ ...TREND_DEFAULTS, ...options.trend });
    case 'blend':
      return createBlendPrior({ ...options.blend, oscillator: { ...options.blend?.oscillator, ...options.oscillator }, trend: { ...options.blend?.trend, ...options.trend } });
  }
}
