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

/** Where one tick sits on the two clocks: the context clock commands land on (or a
 *  stand-in carrying the engine's time, headless), the engine time now (the tick's time,
 *  or `performance.now() / 1000`), and the output stage the map subtracts, seconds. A
 *  scheduler builds it once per tick and places every event it sends by it. */
export interface TickClock {
  clock: ClockMapAudioLike;
  nowEngine: number;
  stage: number;
}

/** The two call forms, normalised: `(tEngine, at)` or the positional
 *  `(ac, tEngine, nowEngine, outputStageS)` the first callers were written against. */
type ClockMapArgs = [tEngine: number, at: TickClock] | [ac: ClockMapAudioLike, tEngine: number, nowEngine: number, outputStageS: number];

function tickArgs(args: ClockMapArgs): [number, TickClock] {
  if (typeof args[0] === 'number') return [args[0], args[1] as TickClock];
  const [clock, tEngine, nowEngine, stage] = args as [ClockMapAudioLike, number, number, number];
  return [tEngine, { clock, nowEngine, stage }];
}

/** Context time for engine time `tEngine` at the tick `at`. */
export function engineToContextTime(tEngine: number, at: TickClock): number;
/** The positional form: `ac`, then the engine's `nowEngine` and the output stage, seconds. */
export function engineToContextTime(ac: ClockMapAudioLike, tEngine: number, nowEngine: number, outputStageS: number): number;
export function engineToContextTime(...args: ClockMapArgs): number {
  const [tEngine, { clock, nowEngine, stage }] = tickArgs(args);
  return clock.currentTime + (tEngine - nowEngine) - stage;
}

/** The context time an event is scheduled at: the mapped time, or now if that is past. */
export function scheduleAt(tEngine: number, at: TickClock): number;
/** The positional form of {@link scheduleAt}, as {@link engineToContextTime}'s. */
export function scheduleAt(ac: ClockMapAudioLike, tEngine: number, nowEngine: number, outputStageS: number): number;
export function scheduleAt(...args: ClockMapArgs): number {
  const [tEngine, at] = tickArgs(args);
  return Math.max(at.clock.currentTime + MIN_SCHEDULE_AHEAD_S, engineToContextTime(tEngine, at));
}
