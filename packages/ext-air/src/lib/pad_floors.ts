/**
 * Per-pad floors for the air drum (#353): the depth a player's strokes stop at on each
 * pad, so a change of pad is predicted against the new pad's floor and not the last one's.
 *
 * The impact predictor (`packages/ictus/src/impact.ts`) learns ONE floor per stick: the
 * depth its strokes turn at, followed at half a stroke per stroke. On one pad that is the
 * right model. Across pads at different depths it is not: a stroke after a change of pad
 * is extrapolated to the previous pad's floor, so its impact is predicted early or late
 * and its landing point read at the wrong depth, and where two pads are stacked at the
 * same x (the kick under the snare) the depth is the only thing that tells them apart.
 * The predictor's seam is `setFloor`: the consumer names the floor of the stroke in
 * progress. This module is the consumer's half, pure: a table of what each pad's strokes
 * did, and the rule that picks the pad a stroke is heading for.
 *
 * What a stroke is heading for is ambiguous until it stops (#261): a stroke that will
 * stop on the snare and one that will go on to the kick below it fall the same way until
 * the snare's depth. The rule reads where the stroke STARTED: each pad keeps the depth
 * its strokes stop at and the depth they start from (the top of the fall), the stroke in
 * progress is matched to the pad whose strokes start nearest where it did, among the
 * pads its way down crosses at their own floor. A player positions the hand over the
 * pad before the stroke (the arm carries the stick there; the stroke is the swing), so
 * the start says where the stroke is going before the fall can. A swing raised much
 * higher than usual on the same pad is the case this reads wrong (its start is nearer
 * a higher pad's), and it is the cost the test pins.
 *
 * Nothing changes until two pads have floors: with one pad, or none, the predictor's own
 * floor is used (NaN), bit for bit what it did before.
 */
import type { PadId, Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { padDistance } from '@thoremin/sdk/nodes/music/drum_pads';
import { ewUpdate } from '@thoremin/stats';

/** What one pad's strokes did: the depth they stopped at and the depth they started from
 *  (display fractions, y down), each followed exponentially. */
export interface PadFloor {
  floor: number;
  top: number;
}

export type PadFloors = Partial<Record<PadId, PadFloor>>;

/** How fast a pad's floor and top follow its strokes, per stroke: the predictor's own
 *  `levelGain`, so a pad's floor moves exactly as the one shared floor did. */
export const PAD_FLOOR_GAIN = 0.5;
/** Pads with a learned floor before any is named to the predictor. */
export const MIN_FLOOR_PADS = 2;

/** The table with one confirmed stroke on `pad` learned: it stopped at `floor` and started
 *  from `top`. A non-finite reading teaches nothing. */
export function learnPadFloor(floors: PadFloors, pad: PadId, { floor, top }: PadFloor, gain: number = PAD_FLOOR_GAIN): PadFloors {
  if (!Number.isFinite(floor) || !Number.isFinite(top)) return floors;
  const was = floors[pad];
  return { ...floors, [pad]: { floor: ewUpdate(was?.floor ?? NaN, floor, gain), top: ewUpdate(was?.top ?? NaN, top, gain) } };
}

/** The stroke in progress, as the floor rule reads it. */
export interface StrokeSoFar {
  /** Where the fall started (its top), display depth. */
  top: number;
  /** The fall's way down: x at each depth (the landing path's shape). */
  xAt: (y: number) => number;
}

/**
 * The floor the stroke in progress is heading for, or NaN for "the predictor's own"
 * (fewer than {@link MIN_FLOOR_PADS} pads learned, or no learned pad on the stroke's way).
 * A candidate is a switched-on pad with a learned floor whose shape the stroke's way
 * crosses AT that floor (the point the stroke would stop at is on the pad); the one
 * chosen is the candidate whose strokes start nearest where this one did.
 */
export function padFloorFor(floors: PadFloors, pads: Pads, stroke: StrokeSoFar): number {
  const learned = (Object.keys(floors) as PadId[]).filter((id) => pads[id]?.on && floors[id]);
  if (learned.length < MIN_FLOOR_PADS || !Number.isFinite(stroke.top)) return NaN;
  let best = NaN;
  let bestCost = Infinity;
  for (const id of learned) {
    const { floor, top } = floors[id]!;
    if (padDistance(pads[id], { x: stroke.xAt(floor), y: floor }) > 1) continue;
    const cost = Math.abs(stroke.top - top);
    if (cost < bestCost) {
      bestCost = cost;
      best = floor;
    }
  }
  return best;
}
