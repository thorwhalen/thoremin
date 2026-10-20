/**
 * When a frame was captured (#226): the stamp a live source puts on a frame, its sources,
 * and `frameTime`, the one reader of it. Part of the domain types (`../domain.ts`
 * re-exports it); a leaf every frame kind extends.
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

/** Runtime shape of {@link FrameTiming}, spread into each frame schema. */
export const FrameTimingSchema = {
  t: z.number().optional(),
  tSource: z.enum(FRAME_TIME_SOURCES).optional(),
  tOrigin: z.number().optional(),
  lag: z.number().optional(),
  skipped: z.number().int().min(0).optional(),
};
