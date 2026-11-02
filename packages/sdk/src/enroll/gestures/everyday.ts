/**
 * The everyday check for dynamic gestures (#753, design section 4): how often a gesture fires by
 * accident over ordinary movement.
 *
 * Not a second check: the held categories' (`everyday.ts`) takes a gesture's fires through
 * `EverydayCheck.fire`, keeps them in the same `EverydayResult` and flags them with the same
 * `everydayFlags` at the same rate. Live, the host calls `fire` on each of the matcher's fires
 * while the player talks, looks around and plays for a minute. This module is the offline half:
 * it replays a recorded stream of ordinary movement through a matcher into a check, feeding the
 * matcher's noise estimate with the frames that are not a gesture's, exactly as a live caller does
 * (`WindowMatcher.inGesture`).
 *
 * Pure: frames in, a result out, on the frames' own clock.
 */
import { createEverydayCheck, everydayResult, EVERYDAY_DEFAULTS, type EverydayResult } from '../everyday';
import type { NoiseEstimator } from '../noise';
import type { FeatureVector } from '../types';
import type { WindowMatcher } from './matcher';

export interface GestureEverydayOptions {
  /** The matcher under test, built on `noise`. */
  matcher: WindowMatcher;
  /** The noise estimate the matcher segments in; fed here with the frames between gestures. */
  noise: NoiseEstimator;
  /** When the result was made (ISO time; the caller's, since this module has no clock). */
  at: string;
  /** Each gesture's name, by id. */
  labels?: ReadonlyMap<string, string>;
  /** How long the check runs; frames past it are not read. */
  durationMs?: number;
}

/** Replay `frames` (ordinary movement) through the matcher and count its fires per gesture. */
export function gestureEveryday(frames: readonly { v: FeatureVector; t: number }[], options: GestureEverydayOptions): EverydayResult {
  const { matcher, noise, at, labels = new Map(), durationMs = EVERYDAY_DEFAULTS.durationMs } = options;
  const check = createEverydayCheck({ durationMs });
  const t0 = frames[0]?.t ?? 0;
  check.start(t0);
  let last = t0;
  for (const f of frames) {
    if (check.done(f.t)) break;
    const r = matcher.push(f.v, f.t);
    if (r.fired) check.fire(r.fired.gesture, f.t);
    if (!matcher.inGesture()) noise.push(f.v, f.t);
    last = f.t;
  }
  return everydayResult(check, last, labels, at);
}
