/**
 * The `expression` slot's contract: what a node must declare to classify a face frame
 * into expression scores (the instruments-as-graphs ADR, §3.5 and seam 7).
 *
 * One candidate exists today, `face-expression`. The pointable second is the Trainer's
 * learned classifier over the face vector (`packages/sdk/src/enroll/classify.ts`), whose output shape
 * (a category plus memberships) needs one adapter to emit this port kind. Until then the
 * slot is declared, validated and has no dropdown, per the ">= 2 implementations" rule.
 */
import type { SlotContract } from '../slot_contract';

export const EXPRESSION_SLOT_OUTPUT = { name: 'expression', kind: 'face-expression' } as const;
export const EXPRESSION_SLOT_INPUTS = ['face'] as const;

export const EXPRESSION_SLOT_CONTRACT: SlotContract = {
  role: 'feature',
  requiredInputs: EXPRESSION_SLOT_INPUTS,
  output: EXPRESSION_SLOT_OUTPUT,
};
