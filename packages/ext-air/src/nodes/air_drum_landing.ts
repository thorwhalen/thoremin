/**
 * Where an air-drum stroke lands and how hard it sounds: the landing point and time read
 * off the falling segment's shape, the speed term and the velocity. Moved out of
 * `air_drum.ts`, which re-exports what it exported.
 */
import { clamp01 } from '@thoremin/stats';
import { fitLine, fitQuadratic, type Quadratic } from '@thoremin/ictus';
import type { FallPath } from '@thoremin/sdk/nodes/music/drum_pads';
import { fallingSegment, type TrackSample } from './air_drum_track';

/** The softest a counted stroke sounds, as a fraction of full velocity: a stroke that
 *  passed the amplitude and speed gates is a hit, and a hit is never inaudible. */
export const SOFTEST_HIT = 0.15;

/** A landing point is never extrapolated further than this past the last sample, seconds. */
const MAX_EXTRAPOLATION = 0.12;

/** The displayed frame's bottom edge, display fractions: as far as a landing path runs. */
const FRAME_BOTTOM = 1;

export interface Landing {
  /** Where the stroke lands, display fractions. */
  x: number;
  y: number;
  /** How fast: the fall's mean downward speed so far, frame heights per second. */
  speed: number;
  /** The fall as a curve in the frame, latest sample to the depth the fit reaches
   *  (`drum_pads.ts`'s `hitPad` picks a pad along it). */
  path: FallPath;
}

/** The heel's drift is read from the lower part of the fall: the samples within this
 *  fraction of the fall's depth above the latest one (at least the fewest a line needs).
 *  The top of a fall, where the depth has barely started, says little about where the
 *  hand is heading. */
const SHAPE_DEPTH_FRACTION = 0.5;

/** The fewest samples the heel's drift is a line through. */
const SHAPE_MIN_SAMPLES = 2;

/** The stick's reach may vary by this factor (as a log ratio) over the fall and still be
 *  an image-plane swing; beyond it the stick is foreshortening and the arc is not its
 *  path. A 0.7 rad swing in the image plane keeps its reach exactly. */
const REACH_TOLERANCE = Math.log(1.15);

/** The lower part of the fall the shape is read from (at least the last `atLeast`). */
function lowerPart(seg: readonly TrackSample[], last: TrackSample, atLeast: number): TrackSample[] {
  const floor = last.y - SHAPE_DEPTH_FRACTION * (last.y - seg[0].y);
  const from = Math.min(seg.length - atLeast, seg.findIndex((s) => s.y >= floor));
  return seg.slice(Math.max(0, from));
}

/**
 * The fall's shape (#261), x at each depth, free of the fall's timing. A stick tip is one
 * reach from the heel of the hand by construction, so its path is an ARC about the heel:
 * the heel's own drift is a line in the tip's depth over the lower part of the fall, and
 * the tip sits on the circle of the stick's reach about it (`aspect`, the frame's width
 * over its height, makes the display fractions isotropic). Exact for a swung stick,
 * whatever the brake; nothing is fitted that landmark noise could bend. The near-vertical
 * stick (the tip under the heel) is where a depth has no x, and there the tip stays
 * under the heel.
 */
function arcShape(seg: readonly TrackSample[], last: TrackSample, aspect: number): ((y: number) => number) | null {
  if (!last.grip || !seg.every((s) => s.grip)) return null;
  const reachOf = (s: TrackSample) => Math.hypot((s.x - s.grip!.x) * aspect, s.y - s.grip!.y);
  const reach = reachOf(last);
  if (!(reach > 0)) return null;
  const side = Math.sign((last.x - last.grip.x) * aspect) || 1;
  const lower = lowerPart(seg, last, SHAPE_MIN_SAMPLES);
  // A stick turning toward or away from the camera shortens or lengthens in the image:
  // its path is no circle in the frame, and the time line knows better.
  if (lower.some((s) => Math.abs(Math.log(reachOf(s) / reach)) > REACH_TOLERANCE)) return null;
  const ys = lower.map((s) => s.y);
  const heelX = lower.length >= SHAPE_MIN_SAMPLES ? fitLine(ys, lower.map((s) => s.grip!.x * aspect), last.y) : null;
  const heelY = lower.length >= SHAPE_MIN_SAMPLES ? fitLine(ys, lower.map((s) => s.grip!.y), last.y) : null;
  return (y) => {
    const d = y - last.y;
    const hx = heelX ? heelX.a + heelX.b * d : last.grip!.x * aspect;
    const hy = heelY ? heelY.a + heelY.b * d : last.grip!.y;
    const swingY = Math.min(reach, Math.max(-reach, y - hy));
    return (hx + side * Math.sqrt(reach * reach - swingY * swingY)) / aspect;
  };
}

/**
 * The fall's shape for a point with no lever (the wrist, a fingertip), which has no known
 * pivot: x stays the line in time of #245 (the sideways drift), read at the time the fall's
 * depth fit (`fy`, the quadratic in time; a line with two samples) reaches each depth. At
 * the landing point this is exactly #245's x; along the path it is the same curve by depth.
 */
function timeShape(seg: readonly TrackSample[], last: TrackSample, fy: Quadratic | null): (y: number) => number {
  const ts = seg.map((s) => s.t);
  const fx = seg.length >= 2 ? fitLine(ts, seg.map((s) => s.x), last.t) : null;
  if (!fx) return () => last.x;
  const depth = fy ?? (seg.length >= 2 ? fitLine(ts, seg.map((s) => s.y), last.t) : null);
  /** The first time at or after the latest sample the depth fit reaches `y`, or where
   *  it turns if it never does. */
  const tauOf = (y: number): number => {
    if (!depth) return 0;
    const { a, b, c } = depth;
    const d = y - a;
    if (Math.abs(c) < 1e-12) return b > 0 ? Math.max(0, d / b) : 0;
    const disc = b * b + 4 * c * d;
    if (disc < 0) return Math.max(0, -b / (2 * c));
    const r = Math.sqrt(disc);
    const roots = [(-b - r) / (2 * c), (-b + r) / (2 * c)].filter((t) => t >= 0);
    return roots.length ? Math.min(...roots) : 0;
  };
  return (y) => fx.a + fx.b * tauOf(y);
}

export interface LandingOptions {
  /** The learned floor (the impact predictor's plane, display depth): the landing point is
   *  never below it. Default none. */
  floor?: number;
  /** The stroke has already turned (a confirmed or frame-snapped impact): its path ends
   *  where it stopped. Default false. */
  turned?: boolean;
  /** The frame's width over its height, which makes display fractions isotropic for the
   *  stick's arc. Default 1. */
  aspect?: number;
  /** The depth the stroke turned at, when it has (the impact predictor's three-sample
   *  vertex): the landing point's depth in place of the fall's fit read at `t`, which
   *  overshoots the turn by the landmark noise. Default none. */
  depth?: number;
}

/**
 * Where a stroke lands at `t`, and how fast it came down (#245): a quadratic in time
 * through its falling segment ({@link fallingSegment}) gives the depth at `t` (never more
 * than {@link MAX_EXTRAPOLATION} past the last sample), never below the learned `floor`
 * (the impact predictor's plane, where a surface stroke meets it by definition); x is
 * read off the fall's shape at that depth (#261: the arc about the heel for a stick tip,
 * {@link arcShape}; #245's line in time for a point with no lever, {@link timeShape}). The
 * `path` carries the shape from the latest sample on down, past the depth the fit reaches
 * (a pad above the floor is still on the stroke's way), to the frame's bottom, or, once
 * the stroke has `turned`, only to where it stopped. The speed is the fall's mean
 * speed so far, departure to the latest sample, not a fitted derivative extrapolated to
 * the impact: that one is mostly landmark jitter. With a single falling sample, the last
 * sample and no speed.
 */
export function landingAt(samples: readonly TrackSample[], t: number, eps: number, { floor = Infinity, turned = false, aspect = 1, depth = NaN }: LandingOptions = {}): Landing {
  const seg = fallingSegment(samples, t, eps);
  const last = seg[seg.length - 1] ?? samples[samples.length - 1];
  const at = Math.min(t, last.t + MAX_EXTRAPOLATION);
  const tau = at - last.t;
  const ts = seg.map((s) => s.t);
  const fy = seg.length >= 3 ? fitQuadratic(ts, seg.map((s) => s.y), last.t) : null;
  // The depth the fit reaches: at `at` for the landing point; for the path, as far as
  // the fall is heading within MAX_EXTRAPOLATION whatever the predicted time (which
  // aims at a floor learned on another pad). A decelerating fit that turns first has
  // stopped at its vertex.
  const depthBy = (tEnd: number) => {
    if (!fy) return last.y;
    const tv = fy.c < 0 ? -fy.b / (2 * fy.c) : Infinity;
    const te = tv > 0 && tv < tEnd ? tv : tEnd;
    return Math.max(last.y, fy.a + fy.b * te + fy.c * te * te);
  };
  const reach = depthBy(tau);
  const xAt = arcShape(seg, last, aspect) ?? timeShape(seg, last, fy);
  const y = Number.isFinite(depth) ? depth : Math.min(reach, Math.max(floor, last.y));
  // How fast the fall came down so far: its mean speed, departure to the latest sample.
  // Not a fitted derivative: differentiating three noisy samples and extrapolating them
  // ahead makes the speed mostly jitter (an adversarial review measured it).
  const span = seg.length >= 2 ? last.t - seg[0].t : 0;
  const speed = span > 0 ? Math.max(0, (last.y - seg[0].y) / span) : 0;
  // The path runs past the fit's horizon: it is consulted only when the landing point is
  // on no pad, and then the pad is wherever the stroke's way meets one (a stroke from a
  // high pad to a low one commits against the high pad's floor, well short of the low
  // pad), so a falling stroke's runs to the frame's bottom. A stroke that turned ends
  // where it stopped (#355): one stopped in the air above a pad does not play it. A
  // predicted stroke cannot be told from one about to stop until it has; since #353 its
  // landing point is at the floor of the pad it is heading for, so the path matters only
  // for a pad no floor describes yet.
  const yTo = turned ? Math.max(last.y, y) : FRAME_BOTTOM;
  return { x: xAt(y), y, speed, path: { yFrom: last.y, yTo, xAt } };
}

/** How fast, 0..1: `ratio` is the stroke's speed over the slowest stroke's, `hardHit`
 *  the ratio that counts as a full-speed stroke. */
export function speedTerm(ratio: number, hardHit: number): number {
  return clamp01((ratio - 1) / (hardHit - 1));
}

/** How much of "how hard" is the stroke's size against the player's recent strokes (the
 *  accent), the rest its absolute speed. The accent ranks strokes robustly under
 *  landmark jitter (rank correlation with the true accent 0.78 to 0.85 on the synthetic
 *  stick clips at 0 to 0.05 grip lengths of noise, against 0.62 to 0.80 for the speed
 *  alone), but it is relative: a player who only ever plays softly would sound loud on
 *  it alone. Half and half keeps 0.75 to 0.84 and lets absolute speed set the level. */
export const ACCENT_WEIGHT = 0.5;

/** How hard, as a velocity before the volume dial, from the stroke's relative size
 *  (`strength`, 0..1) and its speed ratio over the slowest stroke. */
export function velocityOf(ratio: number, hardHit: number, strength: number = 1 - ACCENT_WEIGHT): number {
  const h = ACCENT_WEIGHT * clamp01(strength) + (1 - ACCENT_WEIGHT) * speedTerm(ratio, hardHit);
  return SOFTEST_HIT + (1 - SOFTEST_HIT) * clamp01(h);
}
