/**
 * The enrollment ritual (#160 §10) — the four steps, as DATA.
 *
 * A script, not control flow: the host renders whatever is in {@link ENROLLMENT_STEPS}
 * and the pipeline dispatches on `id`. Adding a step (a lighting-change nuisance, a
 * two-handed vocabulary pass) is appending an entry, which is the open-closed shape the
 * rest of this codebase uses for sounds, renderings and features.
 *
 * ## Where the four steps come from
 *
 * Modelled on Face ID's enrollment, but only the parts that actually transfer. Face ID
 * asks you to move your head in a circle twice, gathering the face from many angles
 * [#160 §10.1]. Two things about that design are worth copying:
 *
 * - **The ring is a coverage meter, not a progress bar.** It shows which parts of the
 *   space have been sampled and refuses to complete until the gaps are filled. That is
 *   active learning with a physical interface. See {@link stepCoverage}.
 * - **It is a bounded ritual that ENDS.** That is what makes a one-minute cost
 *   acceptable at all.
 *
 * What does *not* transfer is the goal. Face ID enrolls pose variation precisely so it
 * can factor pose OUT — it wants one template of a face as an object. Here pose is
 * frequently the signal, and the discrimination is within one person across expressions,
 * not between people. So: copy the ritual, not the objective.
 *
 * ## Two rules the wording encodes
 *
 * **Never show a target face to imitate.** Imitating a prescribed expression is the exact
 * failure mode this whole feature exists to escape — the maintainer's report was that the
 * shipped categories are the ones they cannot hit. The assistive-tech calibration
 * literature calls this the choice between a prescribed demonstration and
 * "user-interpretable instructions that users can subjectively interpret, allowing users
 * to actively participate in calibration by determining how to perform the gesture."
 * Every prompt below is the second kind.
 *
 * **Steps are independent.** A player's vocabulary is not stable the way an identity is —
 * they will want to add one face next week without redoing the other six, or redo the
 * nuisance step in new lighting. Each step declares what it produces, so re-running one
 * is coherent. Retrofitting partial re-enrollment onto a monolithic ritual is expensive;
 * this is the cheap moment to get it right.
 */
import type { Invariance } from '@/features/types';
import type { StepId } from './types';

/** What a step's samples are consumed as. */
export type StepProduct = 'reject-baseline' | 'range' | 'nuisance' | 'vocabulary';

export interface EnrollmentStep {
  id: StepId;
  /** Short title for the panel. */
  title: string;
  /** The instruction the player reads. Never "make THIS face". */
  prompt: string;
  /** One line on what it buys — shown so the ritual doesn't feel arbitrary. */
  rationale: string;
  /** What the captured samples are used for. */
  produces: StepProduct;
  /** Suggested duration in seconds; advisory, the coverage meter is the real gate. */
  seconds: number;
  /** For the nuisance step: which confound axes it demonstrates. */
  axes?: readonly Invariance[];
  /**
   * Whether this step samples CONTINUOUSLY (every frame) or only still-points.
   * Rest and nuisance want every frame — their whole content is the spread. Range and
   * vocabulary want held poses.
   */
  sampling: 'continuous' | 'still-points';
  /** How many samples make the step usable at all. */
  minSamples: number;
}

/** The shipped ritual. Roughly 60-90 seconds end to end. */
export const ENROLLMENT_STEPS: readonly EnrollmentStep[] = [
  {
    id: 'rest',
    title: 'Rest',
    prompt: 'Look at the camera and relax your face for a few seconds.',
    rationale:
      'Sets what "nothing" looks like, so the instrument can tell when you are not asking for anything.',
    produces: 'reject-baseline',
    seconds: 5,
    sampling: 'continuous',
    minSamples: 30,
  },
  {
    id: 'range',
    title: 'Range',
    prompt: 'Slowly look left, then right, then up, then down, then tilt your head each way.',
    rationale:
      'Learns how far you actually move, so the axes are scaled to you instead of to a fixed 30 degrees.',
    produces: 'range',
    seconds: 15,
    sampling: 'still-points',
    minSamples: 4,
  },
  {
    id: 'nuisance',
    title: 'What should not matter',
    prompt: 'Hold any one face, and move closer to the camera and then further away.',
    rationale:
      'Anything that changes while you do this is camera distance, not expression — the instrument learns to ignore it.',
    produces: 'nuisance',
    seconds: 12,
    axes: ['scale'],
    sampling: 'continuous',
    minSamples: 40,
  },
  {
    id: 'vocabulary',
    title: 'Your faces',
    prompt:
      'Now make faces you can make reliably — whichever ones you like. Hold each one for a moment, then move to the next.',
    rationale:
      'These become your categories. You choose how many afterwards, so do not count as you go.',
    produces: 'vocabulary',
    seconds: 45,
    sampling: 'still-points',
    minSamples: 6,
  },
] as const;

/** Look one up by id. */
export function stepById(id: StepId): EnrollmentStep | undefined {
  return ENROLLMENT_STEPS.find((s) => s.id === id);
}

/** How complete a step is, as a 0..1 fraction — the coverage meter's backing number. */
export function stepCoverage(step: EnrollmentStep, samples: number): number {
  if (step.minSamples <= 0) return 1;
  return Math.max(0, Math.min(1, samples / step.minSamples));
}

/**
 * Whether the ritual has enough to train. Rest and vocabulary are required; range and
 * nuisance are genuinely optional improvements, and saying so is what keeps enrollment
 * an offer rather than a gate.
 */
export function canTrain(counts: Partial<Record<StepId, number>>): boolean {
  const rest = counts.rest ?? 0;
  const vocab = counts.vocabulary ?? 0;
  return rest >= (stepById('rest')?.minSamples ?? 0) && vocab >= (stepById('vocabulary')?.minSamples ?? 0);
}
