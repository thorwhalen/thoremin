/**
 * A camera stream the way a per-tick recording holds it (#973): the Record tool writes an edge
 * on every engine tick, so a 30 fps camera under 60 Hz ticks puts each camera frame on two
 * lines, and a replay parses each line into its own object. Only the capture stamp (`t`, with
 * the session's `tOrigin`) says the two objects are one observation. The committed video
 * fixtures were decoded offline and carry no stamp, so {@link stampFrames} gives them the one
 * a live session would have written; {@link perTickLines} then repeats each frame as parsed
 * copies. A consumer that decides a new frame by its object counts every copy; one that reads
 * `isFreshFrame` sees the de-duplicated stream.
 */
import type { FrameTiming } from '@thoremin/sdk/nodes/domain';

/** Another session's `performance.timeOrigin`: a replayed take is sampled at the tick. */
export const RECORDED_ORIGIN = 1_700_000_000_000;

/** Each frame with the capture stamp of frame `i` of a camera at `fps`, from another session. */
export function stampFrames<T extends object>(frames: readonly T[], fps: number): (T & FrameTiming)[] {
  return frames.map((f, i) => ({ ...f, t: i / fps, tSource: 'capture' as const, tOrigin: RECORDED_ORIGIN }));
}

/** Each frame on `copies` consecutive lines, each line parsed into its own object. */
export function perTickLines<T>(frames: readonly T[], copies = 2): T[] {
  return frames.flatMap((f) => {
    const line = JSON.stringify(f);
    return Array.from({ length: copies }, () => JSON.parse(line) as T);
  });
}

/** Every `copies`-th item from the first: what a per-tick run produced on each frame's first line. */
export function firstLines<T>(xs: readonly T[], copies = 2): T[] {
  return xs.filter((_, i) => i % copies === 0);
}
