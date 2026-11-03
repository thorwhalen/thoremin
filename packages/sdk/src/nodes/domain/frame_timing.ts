/**
 * When a frame was captured (#226): the stamp a live source puts on a frame, its sources,
 * and the stamp rules every consumer shares: `frameTime` (the time to sample a frame at),
 * `isFreshFrame` (whether a frame is a new observation) and `stampInterval` (the seconds
 * between two frames). Part of the domain types (`../domain.ts` re-exports it); a leaf
 * every frame kind extends.
 *
 * Why the freshness rule lives here (#964): the engine ticks at the display rate over a
 * slower camera, and a replayed recording stores every tick, so a node sees the same
 * camera frame again, as the same object or as a parsed copy with the same stamp. About
 * ten nodes had each written that test by hand; one predicate keeps them agreeing.
 */
import { z } from 'zod';

/**
 * When a frame was captured (#226). Stamped by the live webcam sources; absent on
 * synthetic frames and on recordings made before the stamp existed. A recording made
 * since carries the stamps of the session that made it, in THAT session's time base,
 * which is why a consumer never reads `t` directly: {@link frameTime} decides.
 */
export interface FrameTiming {
  /** Capture time in seconds, `performance.now()/1000` base (the engine's realtime
   *  base at speed 1). */
  t?: number;
  /** What `t` is: the camera's capture time, the compositor's presentation time, the
   *  clock minus the recent capture lag (a frame whose own metadata was missed), or
   *  the clock at the moment the source noticed the frame (the pre-#226 stamp). */
  tSource?: 'capture' | 'presentation' | 'estimated' | 'clock';
  /** The time base's origin, `performance.timeOrigin` (ms since the epoch) of the
   *  document that stamped the frame. A recording replayed in another session has
   *  another origin, which is how {@link frameTime} tells the two apart. */
  tOrigin?: number;
  /** Seconds from `t` to the start of inference, measured by the source (#226/#227). */
  lag?: number;
  /** Camera frames presented between the previous processed frame and this one that
   *  were not processed (inference was still busy; the pump takes the latest): absent
   *  or 0 when none, or when the browser cannot say (#226, the `presentedFrames` pump). */
  skipped?: number;
}

export const FRAME_TIME_SOURCES = ['capture', 'presentation', 'estimated', 'clock'] as const;

/** The stamp sources read off a clock rather than the camera's time (`clock`, and
 *  `estimated` = the clock minus a lag): the stamps that jitter with the page's delivery.
 *  One set for every reader (the timing tracker's share, the de-jitter, the air drum's
 *  standing, the frame pump). */
export const CLOCK_DERIVED_SOURCES = ['clock', 'estimated'] as const satisfies readonly (typeof FRAME_TIME_SOURCES)[number][];

/** Whether a stamp source is one of {@link CLOCK_DERIVED_SOURCES}. */
export function isClockDerived(source: string | null | undefined): boolean {
  return (CLOCK_DERIVED_SOURCES as readonly string[]).includes(source as string);
}

/**
 * The sample time a consumer should use for a frame: the frame's own stamp when the
 * engine runs in real time at speed 1 (the one case where the stamp and `ctx.time`
 * share a base — the Applier publishes the clock's scale under `resources.timeScale`)
 * AND the stamp was made by this document (its `tOrigin` is this document's
 * `performance.timeOrigin`), else `ctx.time`. A stamped frame under a batch or scaled
 * clock, or one replayed from a recording made in another session, is sampled at the
 * tick, as before #226.
 */
export function frameTime(frame: FrameTiming | undefined, ctx: { time: number; resources: Record<string, unknown> }): number {
  const t = frame?.t;
  if (
    typeof t === 'number' &&
    Number.isFinite(t) &&
    frame?.tSource !== undefined &&
    ctx.resources.timeScale === 1 &&
    typeof frame.tOrigin === 'number' &&
    typeof performance !== 'undefined' &&
    frame.tOrigin === performance.timeOrigin
  )
    return t;
  return ctx.time;
}

/** The camera frame period assumed where none is measured, seconds: a 30 fps camera. */
export const DEFAULT_FRAME_PERIOD_S = 1 / 30;

/** Whether two frames carry the same capture stamp in the same time base (both stamped). */
const sameStamp = (a: FrameTiming, b: FrameTiming): boolean => a.t !== undefined && a.t === b.t && a.tOrigin === b.tOrigin;

/**
 * Whether `next` is a new observation after `prev` (#964): a frame is, unless it is absent,
 * the very object seen last, or a copy carrying the same capture stamp and origin (a
 * replayed recording parses each tick's copy of a camera frame anew). An unstamped frame
 * is new whenever it is another object.
 */
export function isFreshFrame(prev: FrameTiming | undefined, next: FrameTiming | undefined): boolean {
  if (!next || next === prev) return false;
  return !(prev && sameStamp(prev, next));
}

/**
 * The seconds from `prev` to `next` by their capture stamps, when both are stamped in the
 * same time base (`tOrigin`) and `next` is later; else undefined, for the caller to assume
 * a period ({@link DEFAULT_FRAME_PERIOD_S}). Only the interval is read, so a recording
 * replayed from another session measures its own frame rate.
 */
export function stampInterval(prev: FrameTiming | undefined, next: FrameTiming | undefined): number | undefined {
  const a = prev?.t;
  const b = next?.t;
  if (typeof a !== 'number' || typeof b !== 'number' || prev?.tOrigin !== next?.tOrigin) return undefined;
  const dt = b - a;
  return Number.isFinite(dt) && dt > 0 ? dt : undefined;
}

/** Runtime shape of {@link FrameTiming}, spread into each frame schema. */
export const FrameTimingSchema = {
  t: z.number().optional(),
  tSource: z.enum(FRAME_TIME_SOURCES).optional(),
  tOrigin: z.number().optional(),
  lag: z.number().optional(),
  skipped: z.number().int().min(0).optional(),
};
