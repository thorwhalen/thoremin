/**
 * The input stage: how long a sound takes from the air at the microphone to its sample on the
 * AudioContext clock (`docs/design/audio-input.md`, "two clocks").
 *
 * The output stage (`./output_stage.ts`) is what the timing resource already tracks: from a
 * context time to the speaker. An instrument that LISTENS needs the other half: an event the
 * audio thread stamps at context frame `f` happened in the room `inputStage` seconds earlier.
 * Browsers barely report it (Chromium's `MediaStreamTrack.getSettings().latency`, often 0.01 s
 * and not measured), so the number comes, in order of trust, from:
 *
 * - `measured`: a take that knows both ends (the latency probe's strike test, #227);
 * - `loopback`: the microphone hearing the app's own click (the round trip, minus the output stage);
 * - `tap`: the player tapping along to a click (includes the player's own anticipation; the
 *   rhythm literature's negative mean asynchrony, so it is the least trusted measurement);
 * - `reported`: the track's own `latency` setting;
 * - `prior`: a stated default, flagged, never 0 (a 0 would claim a precision nobody measured).
 *
 * A loopback take (#881) measures the stage it CORRECTS: its heard times were already moved back
 * by the stage in force, so what it finds is a residual, and {@link inputStageFromLoopback} adds
 * that residual to the stage in force after taking out the output stage the browser reports.
 */

export type InputStageSource = 'measured' | 'loopback' | 'tap' | 'reported' | 'prior';

export interface InputStage {
  seconds: number;
  source: InputStageSource;
}

/** The largest input stage a device may keep, seconds: the stored record's bound (longer is a fault
 *  in the take, never a microphone). */
export const MAX_INPUT_STAGE_S = 1;

/** Trust order, most trusted first. */
export const INPUT_STAGE_TRUST: readonly InputStageSource[] = ['measured', 'loopback', 'tap', 'reported', 'prior'];

/**
 * The stated prior: a built-in microphone on a desktop browser with processing off, typically
 * one or two device buffers (`docs/research/audio-trigger-latency.md` §2).
 */
export const INPUT_STAGE_PRIOR_S = 0.01;

/** The most trusted of the candidates given (a reported 0 or a non-finite value is ignored). */
export function chooseInputStage(candidates: readonly (InputStage | null | undefined)[]): InputStage {
  let best: InputStage | null = null;
  for (const c of candidates) {
    if (!c || !Number.isFinite(c.seconds) || c.seconds < 0) continue;
    if (c.source === 'reported' && c.seconds === 0) continue;
    if (!best || INPUT_STAGE_TRUST.indexOf(c.source) < INPUT_STAGE_TRUST.indexOf(best.source)) best = c;
  }
  return best ?? { seconds: INPUT_STAGE_PRIOR_S, source: 'prior' };
}

/**
 * When, on the context clock, a sound stamped at `frame` actually reached the microphone:
 * `frame / sampleRate - inputStage`.
 */
export function heardAtContextTime(frame: number, sampleRate: number, stage: InputStage): number {
  return frame / sampleRate - stage.seconds;
}

export interface LoopbackStageInputs {
  /** The take's median of heard minus scheduled, seconds, its heard times already moved back by `current`. */
  residual: number;
  /** The input stage in force during the take (what the heard times were corrected by). */
  current: InputStage;
  /** The output stage the browser reports, seconds (scheduled to speaker), or null when it reports
   *  none: then nothing is taken out, and the new stage carries the output stage with it. */
  outputStage: number | null;
}

/** What a loopback take sets: a stage, or why it sets none (the stage in force is kept). */
export type LoopbackStage = { stage: InputStage; refusal: null } | { stage: null; refusal: string };

/**
 * The input stage a loopback take measured. A click scheduled at `t` leaves the speaker at
 * `t + output`, reaches the input stamped at `t + output + input`, and was read at that stamp
 * minus `current`; so `input = current + residual - output`. Refused when that is negative (the
 * reported output stage is longer than the round trip heard) or past {@link MAX_INPUT_STAGE_S}.
 */
export function inputStageFromLoopback({ residual, current, outputStage }: LoopbackStageInputs): LoopbackStage {
  if (!Number.isFinite(residual)) return { stage: null, refusal: 'no residual was measured' };
  const seconds = current.seconds + residual - (outputStage ?? 0);
  const ms = (x: number) => `${Math.round(x * 1000)} ms`;
  if (seconds < 0) return { stage: null, refusal: `the round trip heard (${ms(current.seconds + residual)}) is shorter than the output stage reported (${ms(outputStage ?? 0)})` };
  if (seconds > MAX_INPUT_STAGE_S) return { stage: null, refusal: `an input stage of ${ms(seconds)} is past the ${ms(MAX_INPUT_STAGE_S)} a device may keep` };
  return { stage: { seconds, source: 'loopback' }, refusal: null };
}
