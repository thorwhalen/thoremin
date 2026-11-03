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
 *   the take was recorded. A fresh listener warms up on the first frames it sees, and judges that
 *   warm-up as the session does (#913, `restCeiling`: the catalog's `restCeilingOf` by default),
 *   so a set made active while the hand moves, or a listener reset mid-gesture, redoes a warm-up
 *   that learned motion as jitter instead of going deaf.
 * - **Frames, not ticks.** `tMs` must be the camera frame's stamp: a frame re-offered on a later
 *   tick (a 60 Hz loop over a 30 fps camera) carries the same stamp and is read once (the
 *   estimator skips a zero step, the segmenter a repeated stamp), never as a still second frame.
 * - **No reading, no frame.** A frame carrying under `minPresent` of the matched features (the
 *   hand left the shot) is not pushed; the matcher's own gap rule then abandons a repetition
 *   under way, as a hole in a trace must.
 * - **It says when it cannot hear yet** (`warming()`, #954): while a matched feature in view has
 *   no warm noise unit (a fresh listener, the first frames after a reset or a hush, a warm-up
 *   redone because it learned motion), no repetition can be judged, so nothing fires. A host shows
 *   it, so a gesture made then is not simply lost without a word.
 * - **A refractory period** after a fire (`refractoryMs`, the matcher's default): the hand
 *   settling after a wave is not a second gesture. With `tolerance`, a device's live tuning,
 *   never in the file (design section 5), and with no pref yet (a follow-up with #755).
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
import { createNoiseEstimator, warmingOn, type NoiseEstimator, type NoiseOptions } from '../noise';
import type { FeatureVector } from '../types';
import { restCeilingOf } from '../../features/catalog';
import { definedOnly } from '../../util/options';
import { createDtwMatcher, MATCHER_DEFAULTS, type GestureFire, type GestureModel, type WindowMatcher } from './matcher';

export const GESTURE_LISTEN_DEFAULTS = {
  /** The matcher's hold-off after a fire (`MATCHER_DEFAULTS.refractoryMs`, the one default). */
  refractoryMs: MATCHER_DEFAULTS.refractoryMs,
  /** The share of the matched features a frame must carry to be read at all. Half: a hand at the
   *  edge of the frame loses a fingertip or two, not its path. */
  minPresent: 0.5,
  /** The matcher's acceptance, in radii (`MATCHER_DEFAULTS.tolerance`). */
  tolerance: MATCHER_DEFAULTS.tolerance,
} as const;

/** What a host says while a listener is `warming()` (#954): the carve tool's Trying and the
 *  Gestures tool's Your categories say the same. */
export const LISTEN_WARMING_SAY = 'Getting ready to listen: hold still for a moment. A gesture made before then is not heard.';

/** Makes the matcher a listener runs (the #755 seam). */
export type MatcherFactory = (model: GestureModel, options: { noise: NoiseEstimator; tolerance: number; refractoryMs: number }) => WindowMatcher;

export interface GestureListenerOptions {
  refractoryMs?: number;
  minPresent?: number;
  tolerance?: number;
  /** The noise estimate to segment in (by default a fresh one, made with `noiseOptions`). */
  noise?: NoiseEstimator;
  /** The fresh estimate's options. Its `restCeiling` defaults to the catalog's (`restCeilingOf`,
   *  #913), as a session's does, also when passed as undefined; pass one that returns undefined to
   *  judge no warm-up. Ignored when `noise` is given. */
  noiseOptions?: NoiseOptions;
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
  /** Whether the last frame read found a matched feature with no warm noise unit yet: nothing
   *  can fire until it warms (hold still). False before any frame, after a reset, and on a frame
   *  with no reading. */
  warming(): boolean;
}

const dtwMatcher: MatcherFactory = (model, o) => createDtwMatcher({ model, ...o });

/** A listener for `model`'s gestures (see the module header). */
export function createGestureListener(model: GestureModel, options: GestureListenerOptions = {}): GestureListener {
  const o = { ...GESTURE_LISTEN_DEFAULTS, ...definedOnly(options) };
  const noise = options.noise ?? createNoiseEstimator({ ...options.noiseOptions, restCeiling: options.noiseOptions?.restCeiling ?? restCeilingOf });
  const matcher = (options.matcher ?? dtwMatcher)(model, { noise, tolerance: o.tolerance, refractoryMs: o.refractoryMs });
  const features = { features: [...model.series.features] };
  let warming = false;
  return {
    push(vector, tMs) {
      if (!hasReading(features, vector, o.minPresent)) {
        warming = false;
        return null;
      }
      const r = matcher.push(vector!, tMs);
      if (!matcher.inGesture()) noise.push(vector!, tMs);
      warming = warmingOn(noise, features.features, vector!);
      return r.fired;
    },
    reset() {
      matcher.reset();
      noise.reset();
      warming = false;
    },
    inGesture: () => matcher.inGesture(),
    warming: () => warming,
  };
}
