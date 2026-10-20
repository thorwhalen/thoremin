/**
 * The air drum's tracked point and its fall: one sample of the point, the deepest sample
 * near a time, how much of a stroke is the stick's own swing, whether a stroke is carried,
 * the falling segment before a landing and the grip at its departure. Moved out of
 * `air_drum.ts`, which re-exports what it exported.
 */
import { median } from '@thoremin/stats';

/** How far back a stroke's approach is read, seconds (the impact predictor's own
 *  approach window plus a frame). */
export const APPROACH_WINDOW = 0.2;

/** One sample of the tracked point in the displayed frame's fractions. */
export interface TrackSample {
  t: number;
  x: number;
  y: number;
  /** The grip (the heel of the hand, where the stick's butt leaves the palm and near
   *  enough the wrist joint the stick turns about; display fractions) when the point is a
   *  stick tip. The tip is one reach from it by construction (the estimate extends the
   *  heel-to-fulcrum line), so the tip's depth over it is the stick's own swing, a change
   *  in it the hand's rotation, and the tip's path an arc about it. Absent for a point
   *  with no lever (the wrist, a fingertip). */
  grip?: { x: number; y: number };
}

/**
 * The frame-snapped onset of a stroke confirmed at about `near` (#318): the time of the
 * deepest sample (largest display `y`) within one and a half frame periods of it (the
 * period read from the samples' own spacing), so a fast roll's previous, deeper stroke is
 * never taken; `near` itself when no sample is there.
 */
export function deepestSampleTime(recent: readonly TrackSample[], near: number): number {
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) if (recent[i].t > recent[i - 1].t) gaps.push(recent[i].t - recent[i - 1].t);
  // The period: the upper median of the gaps (a real gap), 0 with none.
  const frame = gaps.length ? median(gaps, { even: 'upper' }) : 0;
  const reach = 1.5 * frame + 1e-9;
  let best: TrackSample | null = null;
  for (const s of recent) {
    if (Math.abs(s.t - near) > reach) continue;
    if (!best || s.y > best.y) best = s;
  }
  return best ? best.t : near;
}

/**
 * How much of the tip's descent over its fall is the stick's own swing, the rest the
 * hand carrying it: 1 for a wrist stroke, 0 for a raised stick carried down to a lower
 * pad, in between when the arm takes part (#261). NaN for a point with no grip.
 */
export function swingShare(seg: readonly TrackSample[]): number {
  if (seg.length < 2) return NaN;
  const first = seg[0];
  const last = seg[seg.length - 1];
  if (!first.grip || !last.grip) return NaN;
  const descent = last.y - first.y;
  if (!(descent > 0)) return NaN;
  return (last.y - last.grip.y - (first.y - first.grip.y)) / descent;
}

/**
 * Whether a fall is a carried stick rather than a stroke (#261): a grip was tracked and
 * the stick's OWN swing over the whole fall, `amplitude` deep (the fall so far at a
 * confirmation; at a prediction, the fall the predictor expects, down to its floor), is
 * under `minSwing`. A carried stick swings not at all (the demo take's arm moves) or a
 * little (a stick lowered while carried); a wrist stroke swings its whole amplitude, and
 * an arm carrying the hand on top of a full swing adds depth but takes no swing away, so
 * a stroke stays a stroke however much arm is in it. The swing so far is scaled to the
 * whole fall by its share of the descent ({@link swingShare}): at a prediction only part
 * of the fall has been seen. An absolute swing, not a share: see
 * {@link CARRY_SWING_FRACTION} for how small.
 */
export function isCarried(seg: readonly TrackSample[], { amplitude, minSwing }: { amplitude: number; minSwing: number }): boolean {
  const share = swingShare(seg);
  return Number.isFinite(share) && share * amplitude < minSwing;
}

/** A carried stick's swing, as a fraction of the point's smallest stroke (0.45 reach for
 *  the stick tip): under a quarter, about 6 degrees of the hand. Measured against the
 *  gate itself: the demo take's carries read 0.00 to 0.13 of it (the 0.13 under landmark
 *  noise), its strokes 0.84 to 3.2 (two real strokes under the full gate, at an early
 *  commit under noise), the recorded conducting beats on the stick tip 0.3 to 2.1 (a
 *  conductor's beat is mostly arm, and must stay a beat: `drum_anchor.test.ts`), and
 *  the jittered synthetic strokes 0.7 to 1.8. A quarter is between what a carry reads
 *  and what any stroke reads. */
export const CARRY_SWING_FRACTION = 0.25;

/**
 * The stroke's fall so far: the samples up to `tEnd`, walked back from the latest while
 * the point was still descending (y grows, down positive), tolerating `eps` of jitter, at
 * most {@link APPROACH_WINDOW} long, starting at the departure from the top. The top of
 * the swing, where the stick turns or waits, is not part of it, so a quadratic through
 * it is the stroke's own approach.
 */
export function fallingSegment(samples: readonly TrackSample[], tEnd: number, eps: number): TrackSample[] {
  let i = samples.length - 1;
  while (i > 0 && samples[i].t > tEnd + 1e-9) i--;
  if (i < 0) return [];
  let j = i;
  while (j > 0 && samples[j - 1].y < samples[j].y + eps && samples[i].t - samples[j - 1].t <= APPROACH_WINDOW) j--;
  // A stick held at the top (within the jitter of its highest point) has not started to
  // fall: keep only the last of those samples, the departure. The hand may move sideways
  // to the next pad while it waits there, and that is not the stroke's path.
  while (j < i - 2 && samples[j + 1].y <= samples[j].y + eps) j++;
  return samples.slice(j, i + 1);
}

/** Samples of the hold at the top a departure's hand depth is averaged over. */
const GRIP_HOLD_SAMPLES = 3;

/** The depth of the hand gripping the stick where the fall up to `tEnd` departed (#533:
 *  the pad a stroke heads for, by where the hand is held), averaged over the departure
 *  and the samples held at the top just before it (up to {@link GRIP_HOLD_SAMPLES}, so
 *  one frame's landmark noise does not decide); NaN for a point with no grip. The same
 *  read when a stroke is named and when it is learned, except that a slow fall longer
 *  than the approach window is read a little way down it at learning. */
export function gripAtDeparture(samples: readonly TrackSample[], tEnd: number, eps: number): number {
  const seg = fallingSegment(samples, tEnd, eps);
  const dep = seg[0];
  if (!dep?.grip) return NaN;
  let i = samples.indexOf(dep);
  let sum = 0;
  let n = 0;
  for (; i >= 0 && n < GRIP_HOLD_SAMPLES && samples[i].grip && Math.abs(samples[i].y - dep.y) <= eps; i--, n++) sum += samples[i].grip!.y;
  return n ? sum / n : dep.grip.y;
}
