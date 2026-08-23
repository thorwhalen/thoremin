/**
 * Sufficiency (#163) — how the runner knows it has ENOUGH for a cue.
 *
 * This is what makes the trainer more than a script. The runner does not step through
 * cues on a timer; it steps when the data says so, and in between it can ask for more,
 * ask for something different, or give up on a cue the player cannot produce and move
 * on — rather than looping forever on "a bit further".
 *
 * ## The seam
 *
 * {@link SufficiencyEvaluator} is a strategy: `(input) => Verdict`. The default,
 * {@link defaultSufficiency}, dispatches on the cue's declared `sufficiency.kind` and
 * needs nothing beyond what the sampler and the session already produce — by design
 * constraint, every verdict must be reachable from captured data; an evaluator that
 * needs something not captured is a spec bug, not a TODO. A smarter evaluator (one
 * that looks at the growing model, say) replaces the function without touching the
 * runner.
 *
 * ## The four verdicts
 *
 * - `need-more` — keep going; the meter shows progress and nothing is said.
 * - `need-variation` — say something: the cue's next variation, or a built-in nudge.
 * - `enough` — the runner ends the cue and moves on.
 * - `cannot` — patience ran out: say why, and move on. A player who physically
 *   cannot produce what a cue asks for must not be trapped by it.
 *
 * All distances are in noise units (see `noise.ts`): a `minExcursion` of 8 means "eight
 * times this feature's own jitter, RMS over the cue's features", the same for a
 * blendshape and for an angle.
 */
import type { Cue } from './cue';
import { noiseDistance } from './sampler';
import type { FeatureVector, StillPoint } from './types';

export type Verdict =
  | { verdict: 'need-more' }
  | {
      verdict: 'need-variation';
      /** What to say. */
      say: string;
      /**
       * What KIND of ask this is (`'further'`, `'different'`, `'hold'`, …). The runner
       * de-duplicates speech on this, not on the text: the default evaluator cycles a
       * cue's variations, and two wordings of the same ask must not both be said 250 ms
       * apart. Omitted → the text itself is the key.
       */
      key?: string;
    }
  | { verdict: 'enough' }
  | {
      verdict: 'cannot';
      /** Why, in a sentence. Drawn from {@link CANNOT_REASONS} — a FINITE set, so the
       *  voice layer can cache it like any other utterance. */
      why: string;
    };

/** Everything an evaluator may look at. All of it is already captured by the session. */
export interface SufficiencyInput {
  cue: Cue;
  /** The cue's attention features (resolved ids), in registry order. */
  features: readonly string[];
  /** Still-points captured for this cue so far (vocabulary cues). */
  points: readonly StillPoint[];
  /** Frames captured for this cue so far (continuous cues) — only frames that carried
   *  at least one attention feature count. */
  frames: number;
  /** Milliseconds since the cue started. */
  elapsedMs: number;
  /** Milliseconds since the last sample (still-point or counted frame), or `elapsedMs`
   *  when there has been none. */
  sinceLastSampleMs: number;
  /** Whether the player has moved at all since the cue began (the sampler's held
   *  threshold was crossed). Tells "sat still" apart from "moved but never held". */
  moved: boolean;
  /** Whether the vector is currently HELD (the sampler is accumulating a dwell, or
   *  sitting on an already-captured pose). Tells "holding" apart from "sweeping". */
  settling: boolean;
  /** The resting baseline (mean of the baseline cue's frames), if one has run. */
  baseline?: FeatureVector;
  /** The session's noise unit for a feature (NaN if unseen). */
  sigma: (id: string) => number;
  /** How many variations the runner has already SAID during this cue (for cycling
   *  through the cue's list). Saying is the runner's decision, not the evaluator's:
   *  the evaluator reports the situation every time it is asked. */
  askedVariations: number;
}

export type SufficiencyEvaluator = (input: SufficiencyInput) => Verdict;

/** Built-in nudges used when a cue declares no variations of its own. */
export const DEFAULT_NUDGES = {
  further: 'A bit further, if you can.',
  different: 'Try one you have not done yet.',
  hold: 'Hold it still for a moment.',
} as const;

/**
 * Every reason a cue can end in `cannot`. A closed set, without interpolated counts,
 * because it is SPOKEN as well as written: the runner follows it with its own
 * "Moving on." so none of these says so itself.
 */
export const CANNOT_REASONS = {
  unseen: 'I could not see you for this one.',
  tooFew: 'I did not get enough of that one.',
  noHold: 'I did not catch a held position for that one.',
  noMove: 'I did not see you move for that one.',
  tooClose: 'I could not see enough movement for that one.',
  notDistinct: 'I could not find enough different ones.',
} as const;

/** The cue's next variation, cycling; or the built-in nudge. */
function nextVariation(cue: Cue, asked: number, fallback: string): string {
  if (cue.variations.length === 0) return fallback;
  return cue.variations[asked % cue.variations.length];
}

/**
 * Greedily pick the mutually-distinct subset of `points`: a point is kept when it sits
 * at least `minSeparation` (noise RMS over `features`) from every point already kept.
 * Returns the indices kept, in order.
 */
export function distinctPoints(
  points: readonly StillPoint[],
  features: readonly string[],
  sigma: (id: string) => number,
  minSeparation: number,
): number[] {
  const kept: number[] = [];
  points.forEach((p, i) => {
    const far = kept.every((j) => noiseDistance(p.vector, points[j].vector, sigma, features) >= minSeparation);
    if (far) kept.push(i);
  });
  return kept;
}

/** Noise-unit distance of a point from the baseline over `features`; NaN without one. */
export function excursionOf(
  point: FeatureVector,
  baseline: FeatureVector | undefined,
  features: readonly string[],
  sigma: (id: string) => number,
): number {
  if (!baseline) return NaN;
  return noiseDistance(point, baseline, sigma, features);
}

/** The default evaluator: count + spread + coverage, per the cue's declared kind. */
export const defaultSufficiency: SufficiencyEvaluator = (input) => {
  const { cue } = input;
  const s = cue.sufficiency;
  const outOfPatience = input.elapsedMs > s.patienceMs;

  switch (s.kind) {
    case 'frames': {
      if (input.frames >= s.minFrames) return { verdict: 'enough' };
      if (outOfPatience) {
        return { verdict: 'cannot', why: input.frames === 0 ? CANNOT_REASONS.unseen : CANNOT_REASONS.tooFew };
      }
      return { verdict: 'need-more' };
    }

    case 'excursion': {
      // Without a baseline there is nothing to measure excursion against: count only.
      const excursions = input.points.map((p) => excursionOf(p.vector, input.baseline, input.features, input.sigma));
      const good = excursions.filter((e) => Number.isNaN(e) || e >= s.minExcursion).length;
      if (good >= s.minPoints) return { verdict: 'enough' };
      if (outOfPatience) {
        return {
          verdict: 'cannot',
          why: input.points.length > 0 ? CANNOT_REASONS.tooClose : input.moved ? CANNOT_REASONS.noHold : CANNOT_REASONS.noMove,
        };
      }
      // The latest point was held but did not go far enough: ask for more. (The runner
      // decides when to actually SAY it — once per new point, or after a pause.)
      const last = excursions[excursions.length - 1];
      if (input.points.length > 0 && Number.isFinite(last) && last < s.minExcursion) {
        return { verdict: 'need-variation', key: 'further', say: nextVariation(cue, input.askedVariations, DEFAULT_NUDGES.further) };
      }
      return { verdict: 'need-more' };
    }

    case 'variety': {
      const kept = distinctPoints(input.points, input.features, input.sigma, s.minSeparation);
      if (kept.length >= s.minPoints) return { verdict: 'enough' };
      if (outOfPatience) {
        return {
          verdict: 'cannot',
          why: kept.length > 0 ? CANNOT_REASONS.notDistinct : input.moved ? CANNOT_REASONS.noHold : CANNOT_REASONS.noMove,
        };
      }
      const quiet = input.sinceLastSampleMs > s.holdNudgeMs;
      // Nothing captured for a while AND the player is not holding: they are sweeping
      // (or sitting at a pose already taken, which reads as held — see below).
      if (quiet && !input.settling) {
        return { verdict: 'need-variation', key: 'hold', say: DEFAULT_NUDGES.hold };
      }
      // The latest point duplicated an earlier one: ask for something different.
      const lastIndex = input.points.length - 1;
      if (lastIndex >= 0 && !kept.includes(lastIndex)) {
        return { verdict: 'need-variation', key: 'different', say: nextVariation(cue, input.askedVariations, DEFAULT_NUDGES.different) };
      }
      // Holding a pose that has already been captured, for a while: move on to another.
      if (quiet && input.settling) {
        return { verdict: 'need-variation', key: 'different', say: nextVariation(cue, input.askedVariations, DEFAULT_NUDGES.different) };
      }
      return { verdict: 'need-more' };
    }
  }
};
