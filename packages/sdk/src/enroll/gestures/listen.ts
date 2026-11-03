/**
 * Listening for a player's gestures in a live stream (#754, phase 4 of
 * `docs/design/dynamic-gestures.md`): what a host runs to make a saved gesture DO something. The
 * pure half of a gesture binding, as `createCategoryEdge` (`../bind.ts`) is a category's.
 *
 * A held category binds to an ENTRY (a state the player moves into and holds); a gesture binds to
 * an EVENT: the matcher's `fired`, once per repetition (design section 3). So there is no tracker
 * and no hold here, only what turns a stream of read vectors into fires:
 *
 * - **Its own noise estimate.** The matcher segments in noise units, measured on frames that are
 *   NOT a gesture's (`WindowMatcher.inGesture`), exactly as the session fed its estimate while
 *   the take was recorded. A fresh listener warms up on the first frames it sees.
 * - **No reading, no frame.** A frame carrying under `minPresent` of the matched features (the
 *   hand left the shot) is not pushed; the matcher's own gap rule then abandons a repetition
 *   under way, as a hole in a trace must.
 * - **A refractory period** after a fire (`refractoryMs`): the hand settling after a wave is not
 *   a second gesture. A device's live tuning, never in the file (design section 5).
 *
 * ## The seam for the causal matcher (#755)
 *
 * The matcher is made by `matcher` (default: `createDtwMatcher`, rung 1, per segment), the
 * design's "a matcher from traces" injection point: the Gesture Variation Follower of phase 5
 * replaces it here without the host changing. A fire carries its `variation` (speed, scale); what
 * a binding does with it is phase 5's too.
 *
 * Pure: vectors and times in, fires out; no clock of its own.
 */
import { hasReading } from '../bind';
import { createNoiseEstimator, type NoiseEstimator } from '../noise';
import type { FeatureVector } from '../types';
import { definedOnly } from '../../util/options';
import { createDtwMatcher, MATCHER_DEFAULTS, type GestureFire, type GestureModel, type WindowMatcher } from './matcher';

export const GESTURE_LISTEN_DEFAULTS = {
  /** After a fire, no other for this long (ms): longer than a hand takes to settle after a
   *  repetition, shorter than the pause the take asks for between two. */
  refractoryMs: 500,
  /** The share of the matched features a frame must carry to be read at all. Half: a hand at the
   *  edge of the frame loses a fingertip or two, not its path. */
  minPresent: 0.5,
  /** The matcher's acceptance, in radii (`MATCHER_DEFAULTS.tolerance`). */
  tolerance: MATCHER_DEFAULTS.tolerance,
} as const;

/** Makes the matcher a listener runs (the #755 seam). */
export type MatcherFactory = (model: GestureModel, options: { noise: NoiseEstimator; tolerance: number; refractoryMs: number }) => WindowMatcher;

export interface GestureListenerOptions {
  refractoryMs?: number;
  minPresent?: number;
  tolerance?: number;
  /** The noise estimate to segment in (a fresh one by default). */
  noise?: NoiseEstimator;
  /** The matcher (default: rung 1, `createDtwMatcher`). */
  matcher?: MatcherFactory;
}

export interface GestureListener {
  /** One frame (null: none). Returns the gesture recognised on this frame, or null. */
  push(vector: FeatureVector | null | undefined, tMs: number): GestureFire | null;
  /** Forget the stream (the noise estimate too): the next frames warm up again. */
  reset(): void;
  /** Whether the frames are a gesture's now. */
  inGesture(): boolean;
}

const dtwMatcher: MatcherFactory = (model, o) => createDtwMatcher({ model, ...o });

/** A listener for `model`'s gestures (see the module header). */
export function createGestureListener(model: GestureModel, options: GestureListenerOptions = {}): GestureListener {
  const o = { ...GESTURE_LISTEN_DEFAULTS, ...definedOnly(options) };
  const noise = options.noise ?? createNoiseEstimator();
  const matcher = (options.matcher ?? dtwMatcher)(model, { noise, tolerance: o.tolerance, refractoryMs: o.refractoryMs });
  const features = { features: [...model.series.features] };
  return {
    push(vector, tMs) {
      if (!hasReading(features, vector, o.minPresent)) return null;
      const r = matcher.push(vector!, tMs);
      if (!matcher.inGesture()) noise.push(vector!, tMs);
      return r.fired;
    },
    reset() {
      matcher.reset();
      noise.reset();
    },
    inGesture: () => matcher.inGesture(),
  };
}
