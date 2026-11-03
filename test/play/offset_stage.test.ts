/**
 * A player's offset is measured on heard times the runner already moved back by the input stage in
 * force, so it is kept with that stage and a game subtracts it relative to the stage in force NOW
 * (#881 review): a loopback take that changes the device's stage must not shift a judged onset.
 */
import { describe, expect, it } from 'vitest';
import { INPUT_STAGE_PRIOR_S } from '@thoremin/sdk/timing/input_stage';
import { offsetFor } from '../../play/src/offset';

describe('offsetFor', () => {
  it('is 0 with no offset measured, and the offset itself under the stage it was measured under', () => {
    expect(offsetFor(null, 0.02)).toBe(0);
    expect(offsetFor({ offset: 0.05, spread: 0, at: '', stage: 0.02 }, 0.02)).toBeCloseTo(0.05, 12);
  });

  it('keeps the time a game judges unchanged when the stage changes after the take', () => {
    const raw = 3.2; // the frame time of a tap, s
    const takeStage = 0.012;
    const kept = { offset: 0.045, spread: 0.004, at: '', stage: takeStage };
    const judged = (stageNow: number) => raw - stageNow - offsetFor(kept, stageNow);
    // A loopback take moves the stage from 12 ms to 31 ms: the judged tap does not move.
    expect(judged(0.031)).toBeCloseTo(judged(takeStage), 12);
  });

  it('counts an offset kept before it carried a stage as measured under the prior', () => {
    expect(offsetFor({ offset: 0.05, spread: 0, at: '' }, 0.03)).toBeCloseTo(0.05 + INPUT_STAGE_PRIOR_S - 0.03, 12);
  });
});
