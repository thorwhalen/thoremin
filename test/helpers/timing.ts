/**
 * A `timing` resource for headless replays (step 0 of the timing plan). Without one, a
 * node reads the stated prior (20 ms, flagged `unknown-output`), which is right for a
 * browser that cannot report its output stage and wrong for a test that pins the
 * PREDICTOR's behaviour: there the output stage is a known number, usually 0, so
 * `predicted` means what it meant before the output stage entered the rule (the lead
 * from the decision is not negative).
 */
import { TIMING_RESOURCE_KEY, ABSENT_TIMING, type TimingView } from '@thoremin/sdk/timing/tracker';
import type { OutputStageSource } from '@thoremin/sdk/timing/output_stage';

export type TimingResourceStub = TimingView;

/** The engine resources entry for a known output stage of `valueS` seconds; `over`
 *  replaces any other field of the view (the stamp source, its noise, the capture lag:
 *  #318), which otherwise read as no host would report them. */
export function knownOutputStage(valueS: number, source: OutputStageSource = 'measured', over: Partial<TimingView> = {}): Record<string, () => TimingResourceStub> {
  const reading: TimingResourceStub = { ...ABSENT_TIMING, outputStage: { value: valueS, source }, audioEpoch: 0, leadBudget: valueS, ...over };
  return { [TIMING_RESOURCE_KEY]: () => reading };
}

/** No output stage at all: the predictor's own lead is the whole story. */
export const NO_OUTPUT_STAGE = knownOutputStage(0);
