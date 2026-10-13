/**
 * The one engine-to-audio-clock map (step 0 of the timing plan).
 *
 * Engine time is `performance.now() / 1000` at speed 1. A context time written now is
 * rendering now and reaches the ear one output stage later, so a sound meant for engine
 * time `T` is scheduled at `currentTime + (T - now) - outputStage`. With a trustworthy
 * output timestamp pair this is exactly the pair's map (the pair is one sample of the
 * same relation); where the pair stops before the device (WebKit) or is absent, the
 * stage comes from `outputLatency` or the stated prior (`output_stage.ts`). Three
 * consumers used to carry three maps that disagreed by exactly the output latency on
 * Safari; now the drum, the click and the scheduler share this one.
 *
 * The map does not clamp. A result behind the context's clock means the event's time is
 * already past: a drum sounds such a hit at once (a late ghost note is still a note), a
 * click drops it and counts the drop (a click the player did not hear must never be one
 * the take says sounded). {@link MIN_SCHEDULE_AHEAD_S} is the smallest lead a scheduled
 * event is given so it is never behind the render quantum.
 */

/** The slice of an `AudioContext` the map reads. */
export interface ClockMapAudioLike {
  readonly currentTime: number;
}

/** A sound is never scheduled closer than this to the context's clock, seconds. */
export const MIN_SCHEDULE_AHEAD_S = 0.001;

/**
 * Context time for engine time `tEngine`, given the engine's `nowEngine` (the tick's
 * time, or `performance.now() / 1000`) and the output stage in seconds.
 */
export function engineToContextTime(ac: ClockMapAudioLike, tEngine: number, nowEngine: number, outputStageS: number): number {
  return ac.currentTime + (tEngine - nowEngine) - outputStageS;
}

/** The context time an event is scheduled at: the mapped time, or now if that is past. */
export function scheduleAt(ac: ClockMapAudioLike, tEngine: number, nowEngine: number, outputStageS: number): number {
  return Math.max(ac.currentTime + MIN_SCHEDULE_AHEAD_S, engineToContextTime(ac, tEngine, nowEngine, outputStageS));
}
