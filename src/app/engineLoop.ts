/**
 * The live frame loop — one engine tick per frame, then the React status bridges.
 *
 * This is the app side of the Clock seam (Stream Applier M-B, `src/dag/clock.ts`).
 * `useEngine` used to hand-roll its own `requestAnimationFrame` recursion, which
 * meant the shipped `RealtimeClock` was exercised only by its own unit tests
 * while the code players actually run took a different path. Driving the live
 * loop from a `Clock` makes pacing one thing again: batch and paced runs differ
 * by which `Clock` they pass, not by which loop they wrote.
 *
 * It lives in its own module rather than inside the hook so the loop's real
 * behaviour — the tick, the report fan-out, the frame-drop guard, the stop
 * condition — is testable in plain Node with an injected clock, instead of
 * needing a browser, a camera and a loaded ML model.
 */
import { RealtimeClock, type Clock } from '@/dag';

/** Called once per frame with the frame's time in **milliseconds**. */
export type FrameReporter = (nowMs: number) => void;

export interface EngineLoopOptions {
  /** Pacing. Defaults to a wall-clock `RealtimeClock` at speed 1 (rAF-driven). */
  clock?: Clock;
  /** Where a dropped frame is reported. Defaults to `console.error`. */
  onError?: (err: unknown) => void;
  /** Wall-clock reader in **seconds**, used only if the clock omits the tick time. */
  now?: () => number;
}

/** The engine surface the loop needs — narrowed so tests can pass a stub. */
export interface Tickable {
  tick(time?: number): void;
}

/**
 * Drive `engine` from a {@link Clock} until `shouldStop()` returns true, calling
 * each reporter after every successful tick. Resolves when the loop stops.
 *
 * **One bad frame must never stop the instrument.** A node throwing on a single
 * frame (a degenerate value, a transient DOM/audio state) is caught here, that
 * frame is dropped, and the loop continues — so audio and video recover instead
 * of freezing permanently. Reporters run inside the same guard, matching the
 * previous inline loop: a throwing reporter costs the rest of that frame's
 * reports, not the session.
 */
export function runEngineLoop(
  engine: Tickable,
  reporters: readonly FrameReporter[],
  shouldStop: () => boolean,
  opts: EngineLoopOptions = {},
): Promise<void> {
  const clock = opts.clock ?? new RealtimeClock();
  const now = opts.now ?? (() => performance.now() / 1000);
  const onError =
    opts.onError ?? ((err: unknown) => console.error('[thoremin] engine tick error (frame dropped)', err));

  return clock.run((t) => {
    try {
      // A clock may drive the engine on synthesized time (BatchClock passes no
      // argument); the reporters still need a real millisecond stamp, so fall
      // back to the wall clock for them rather than inventing one.
      const seconds = t ?? now();
      engine.tick(seconds);
      const ms = seconds * 1000;
      for (const report of reporters) report(ms);
    } catch (err) {
      onError(err);
    }
  }, shouldStop);
}
