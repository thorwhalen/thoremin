/**
 * A short ring of camera frames kept by capture time (#842), so the overlay can draw the frame
 * a hand result was INFERRED on instead of the live video.
 *
 * Why: the video element shows the newest frame while the landmarks come from the frame inferred
 * a few tens of ms earlier, so at speed a drawn dot trails the fingertip it marks. Drawing the
 * inferred frame registers them exactly, at the price of showing the video one inference late and
 * holding a few GPU bitmaps. Opt-in (the host installs this as `resources.frameHold`); the
 * overlay falls back to the live video for any time not held.
 *
 * Pure and Node-safe: it holds anything with `close()` (an `ImageBitmap`) and owns closing it.
 */

export interface Closable {
  close(): void;
}

export interface FrameHold<T extends Closable = Closable> {
  /** Keep `frame` for capture time `t` (seconds); the oldest beyond the capacity is closed. */
  put(t: number, frame: T): void;
  /** The frame held for exactly `t`, or undefined. */
  get(t: number): T | undefined;
  /**
   * The frame to draw for a result stamped `t`: the one held for `t`, else the newest held at or
   * before it and no more than {@link MAX_EARLIER_S} older (a snapshot resolves a moment after its result on the main thread; drawing the
   * live video in that gap would make the picture jump forward and back).
   */
  at(t: number): T | undefined;
  /** How often `at` found the exact frame, an earlier one, or nothing: a hold that never hits shows here. */
  stats(): { exact: number; earlier: number; none: number };
  /** Close and forget everything; later `put`s are closed at once. */
  dispose(): void;
}

/** How much older than the result an earlier held frame may be and still be drawn for it. */
export const MAX_EARLIER_S = 0.2;

/** One frame in flight plus the one before it; the runners hold only frames they infer. */
export const DEFAULT_HOLD_CAPACITY = 2;

export function createFrameHold<T extends Closable = Closable>(capacity: number = DEFAULT_HOLD_CAPACITY): FrameHold<T> {
  const frames = new Map<number, T>(); // insertion order = age
  let disposed = false;
  const counts = { exact: 0, earlier: 0, none: 0 };
  return {
    put(t, frame) {
      if (disposed) return frame.close();
      frames.get(t)?.close();
      frames.delete(t);
      frames.set(t, frame);
      while (frames.size > capacity) {
        const [oldest, old] = frames.entries().next().value as [number, T];
        frames.delete(oldest);
        old.close();
      }
    },
    get: (t) => frames.get(t),
    at(t) {
      const exact = frames.get(t);
      if (exact) {
        counts.exact += 1;
        return exact;
      }
      let best: number | undefined;
      for (const k of frames.keys()) if (k <= t && (best === undefined || k > best)) best = k;
      if (best === undefined || t - best > MAX_EARLIER_S) {
        counts.none += 1;
        return undefined;
      }
      counts.earlier += 1;
      return frames.get(best);
    },
    stats: () => ({ ...counts }),
    dispose() {
      disposed = true;
      for (const f of frames.values()) f.close();
      frames.clear();
    },
  };
}

/** The host resource key for the ring (`ctx.resources.frameHold`). */
export const FRAME_HOLD_RESOURCE_KEY = 'frameHold';
