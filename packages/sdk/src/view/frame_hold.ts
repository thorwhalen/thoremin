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
  /** Close and forget everything; later `put`s are closed at once. */
  dispose(): void;
}

/**
 * Four, not two: a frame offered while the worker is busy is held too (the runner does not say
 * which offers it drops), so a ring of two would evict the one in flight before its result lands.
 */
export const DEFAULT_HOLD_CAPACITY = 4;

export function createFrameHold<T extends Closable = Closable>(capacity: number = DEFAULT_HOLD_CAPACITY): FrameHold<T> {
  const frames = new Map<number, T>(); // insertion order = age
  let disposed = false;
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
    dispose() {
      disposed = true;
      for (const f of frames.values()) f.close();
      frames.clear();
    },
  };
}

/** The host resource key for the ring (`ctx.resources.frameHold`). */
export const FRAME_HOLD_RESOURCE_KEY = 'frameHold';
