/**
 * The one record this device keeps of its input stage, and the guard that reads it back. No Zod:
 * every standalone game page carries this, and Zod alone is several times a page's budget, so the
 * record is checked by hand (the store's exception to the zodal rule, named in CLAUDE.md).
 */
import { INPUT_STAGE_TRUST, MAX_INPUT_STAGE_S, type InputStage, type InputStageSource } from '@thoremin/sdk/timing/input_stage';

export const INPUT_STAGE_RECORD_ID = 'device';
export const INPUT_STAGE_STORAGE_KEY = 'thoremin.audio.inputStage';

/** This device's stage, and when it was measured (ISO), so a stale one can be shown as such. */
export interface InputStageRecord {
  id: typeof INPUT_STAGE_RECORD_ID;
  seconds: number;
  source: InputStageSource;
  at: string;
}

/** The record, or null when `v` is not one (a value written by an older or broken build reads as none). */
export function parseInputStageRecord(v: unknown): InputStageRecord | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Partial<InputStageRecord>;
  const ok =
    r.id === INPUT_STAGE_RECORD_ID &&
    typeof r.seconds === 'number' &&
    Number.isFinite(r.seconds) &&
    r.seconds >= 0 &&
    r.seconds <= MAX_INPUT_STAGE_S &&
    (INPUT_STAGE_TRUST as readonly unknown[]).includes(r.source) &&
    typeof r.at === 'string';
  return ok ? { id: r.id!, seconds: r.seconds!, source: r.source!, at: r.at! } : null;
}

/** The record for `stage` measured `at`; throws, saying what is wrong, for a stage no device may keep. */
export function inputStageRecord(stage: InputStage, at: string): InputStageRecord {
  const r = parseInputStageRecord({ id: INPUT_STAGE_RECORD_ID, seconds: stage.seconds, source: stage.source, at });
  if (!r) throw new RangeError(`not an input stage a device may keep: ${JSON.stringify(stage)} (seconds in 0..${MAX_INPUT_STAGE_S}, source one of ${INPUT_STAGE_TRUST.join(', ')})`);
  return r;
}
