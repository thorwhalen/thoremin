/**
 * The `expression` slot's contract: what a node must declare to classify a face frame
 * into expression scores (the instruments-as-graphs ADR, §3.5 and seam 7).
 *
 * One candidate exists, `face-expression`. A player's own categorizer (#330 P4, the faces
 * extension's `face-categorizer`) does NOT fill this slot: a slot is chosen by URL and never
 * waits for a lazy type, while a categorizer is chosen per instrument by a dial, needs its model
 * as a transient and passes this slot's reading through as its fallback. It sits AFTER the slot
 * instead, by branch replacement (rule 5 of `composeGraph`), and emits this port's kind with the
 * player's categories on `ExpressionScores.personal`. So the slot keeps one candidate and no
 * dropdown, per the ">= 2 implementations" rule.
 */
import type { SlotContract } from '../slot_contract';

export const EXPRESSION_SLOT_OUTPUT = { name: 'expression', kind: 'face-expression' } as const;
export const EXPRESSION_SLOT_INPUTS = ['face'] as const;

export const EXPRESSION_SLOT_CONTRACT: SlotContract = {
  role: 'feature',
  requiredInputs: EXPRESSION_SLOT_INPUTS,
  output: EXPRESSION_SLOT_OUTPUT,
};
