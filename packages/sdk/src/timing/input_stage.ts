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
 */

export type InputStageSource = 'measured' | 'loopback' | 'tap' | 'reported' | 'prior';

export interface InputStage {
  seconds: number;
  source: InputStageSource;
}

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
