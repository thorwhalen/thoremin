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
 * A pad never struck has nothing learned, so it gets a prior (#530): its centre's depth
 * moved by how far the player's strokes stop from a pad's centre, and a top one usual
 * stroke above that. Without it the first stroke on a new pad was named the floor of
 * whatever learned pad it crossed (the kick's first stroke read as the snare).
 *
 * A floor is named from the first pad that has one (the stroke's own top, not the least
 * depth since the last pad, is what the rule and the predictor's restart need from the
 * first change of pad on). With no pad on, nothing is named: the predictor is bit for bit
 * what it was (the bench and the anchor scorer, which run without pads, do not move).
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
/** Pads with a learned floor before one is named to the predictor. */
export const MIN_FLOOR_PADS = 1;

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
 * What a pad never struck is expected to do (#530), from the pads that have been: its
 * floor at its centre's depth moved by how far the player's strokes stop from a pad's
 * centre, and its top one stroke above that floor (the mean of the learned pads' fall).
 * Both are the player's own habits read on the other pads, so the prior carries no
 * constant of its own. Undefined with no pad learned.
 */
export function priorPadFloor(floors: PadFloors, pads: Pads, pad: PadId): PadFloor | undefined {
  const learned = (Object.keys(floors) as PadId[]).filter((id) => floors[id]);
  if (!learned.length) return undefined;
  const mean = (f: (id: PadId) => number) => learned.reduce((a, id) => a + f(id), 0) / learned.length;
  const floor = pads[pad].y + mean((id) => floors[id]!.floor - pads[id].y);
  return { floor, top: floor - mean((id) => floors[id]!.floor - floors[id]!.top) };
}

/**
 * The floor the stroke in progress is heading for, or NaN for "the predictor's own"
 * (fewer than {@link MIN_FLOOR_PADS} pads learned, or no pad on the stroke's way).
 * A candidate is a switched-on pad whose shape the stroke's way crosses AT that pad's
 * floor (the point the stroke would stop at is on the pad): its learned floor, or for a
 * pad never struck its {@link priorPadFloor} (#530: the first stroke on a new pad was
 * read against the last pad's floor). The one chosen is the candidate whose strokes
 * start nearest where this one did.
 */
export function padFloorFor(floors: PadFloors, pads: Pads, stroke: StrokeSoFar): number {
  const learned = (Object.keys(floors) as PadId[]).filter((id) => pads[id]?.on && floors[id]);
  if (learned.length < MIN_FLOOR_PADS || !Number.isFinite(stroke.top)) return NaN;
  let best = NaN;
  let bestCost = Infinity;
  for (const id of Object.keys(pads) as PadId[]) {
    if (!pads[id].on) continue;
    const expected = floors[id] ?? priorPadFloor(floors, pads, id);
    if (!expected) continue;
    const { floor, top } = expected;
    if (padDistance(pads[id], { x: stroke.xAt(floor), y: floor }) > 1) continue;
    const cost = Math.abs(stroke.top - top);
    if (cost < bestCost) {
      bestCost = cost;
      best = floor;
    }
  }
  return best;
}
