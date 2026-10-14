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
 * its strokes stop at, the depth they start from (the top of the fall) and, for a stick
 * tip, the depth of the hand holding the stick there; the stroke in progress is matched
 * to the pad whose strokes start nearest where it did, among the pads its way down
 * crosses at their own floor. A player positions the hand over the pad before the stroke
 * (the arm carries the stick there; the stroke is the swing), so the start says where the
 * stroke is going before the fall can. For a stick tip the start is a point, top and hand
 * (#533): the swing's height varies stroke to stroke (an accent, a soft stroke) and the
 * hand's depth over a pad much less, so two stacked pads whose strokes start at the same
 * top (a snare swung low, a kick swung high) are told apart by the hand, and a lower pad
 * reached by tilting the stick, the hand where it was, by the top. A point with no grip
 * (the wrist, a fingertip) is read by its top, so a swing raised much higher or lower
 * than usual can still be sent to the stacked neighbour.
 *
 * A pad never struck has nothing learned, so it gets a prior (#530): its centre's depth
 * moved by how far the player's strokes stop from a pad's centre, a top one usual fall
 * above that and a hand one usual hand-to-floor drop above it. Without it the first
 * stroke on a new pad was named the floor of whatever learned pad it crossed (the kick's
 * first stroke read as the snare). It competes only where no learned pad is on the
 * stroke's way: under a learned stacked pad a prior's start is one pad gap from the
 * learned pad's, and a stroke whose start varies by that much is the same picture as a
 * first stroke on the other pad (see {@link padFloorFor}).
 *
 * A floor is named from the first pad that has one (the stroke's own top, not the least
 * depth since the last pad, is what the rule and the predictor's restart need from the
 * first change of pad on). With no pad on, nothing is named: the predictor is bit for bit
 * what it was (the bench and the anchor scorer, which run without pads, do not move).
 */
import type { PadId, Pads } from '@thoremin/sdk/nodes/music/drum_pads';
import { padDistance } from '@thoremin/sdk/nodes/music/drum_pads';
import { ewUpdate } from '@thoremin/stats';

/** What one pad's strokes did: the depth they stopped at, the depth they started from,
 *  and, for a stick tip, the depth of the hand gripping it at the start (display
 *  fractions, y down; NaN for a point with no grip), each followed exponentially. */
export interface PadFloor {
  floor: number;
  top: number;
  grip?: number;
}

export type PadFloors = Partial<Record<PadId, PadFloor>>;

/** How fast a pad's floor and top follow its strokes, per stroke: the predictor's own
 *  `levelGain`, so a pad's floor moves exactly as the one shared floor did. */
export const PAD_FLOOR_GAIN = 0.5;
/** Pads with a learned floor before one is named to the predictor. */
export const MIN_FLOOR_PADS = 1;

/** The table with one confirmed stroke on `pad` learned: it stopped at `floor`, started
 *  from `top`, the hand at `grip`. A non-finite floor or top teaches nothing; a
 *  non-finite grip leaves the pad's grip as it was. */
export function learnPadFloor(floors: PadFloors, pad: PadId, { floor, top, grip = NaN }: PadFloor, gain: number = PAD_FLOOR_GAIN): PadFloors {
  if (!Number.isFinite(floor) || !Number.isFinite(top)) return floors;
  const was = floors[pad];
  const g = Number.isFinite(grip) ? ewUpdate(was?.grip ?? NaN, grip, gain) : (was?.grip ?? NaN);
  return { ...floors, [pad]: { floor: ewUpdate(was?.floor ?? NaN, floor, gain), top: ewUpdate(was?.top ?? NaN, top, gain), grip: g } };
}

/** The stroke in progress, as the floor rule reads it. */
export interface StrokeSoFar {
  /** Where the fall started (its top), display depth. */
  top: number;
  /** The hand's depth where the fall started, for a stick tip (#533); NaN or absent for a
   *  point with no grip. */
  grip?: number;
  /** The fall's way down: x at each depth (the landing path's shape). */
  xAt: (y: number) => number;
}

/** The switched-on pads with a learned floor. */
const learnedOn = (floors: PadFloors, pads: Pads): PadId[] => (Object.keys(floors) as PadId[]).filter((id) => pads[id]?.on && floors[id]);

/**
 * What a pad never struck is expected to do (#530), from the switched-on pads that have
 * been struck: its floor at its centre's depth moved by how far the player's strokes stop
 * from a pad's centre, its top one mean fall above that floor and its grip one mean
 * hand-to-floor drop above it. All are the player's own habits read on the other pads,
 * so the prior carries no constant of its own. Undefined with no such pad.
 */
export function priorPadFloor(floors: PadFloors, pads: Pads, pad: PadId): PadFloor | undefined {
  const learned = learnedOn(floors, pads);
  if (!learned.length) return undefined;
  const mean = (f: (l: PadFloor, id: PadId) => number) => learned.reduce((a, id) => a + f(floors[id]!, id), 0) / learned.length;
  const floor = pads[pad].y + mean((l, id) => l.floor - pads[id].y);
  return { floor, top: floor - mean((l) => l.floor - l.top), grip: floor - mean((l) => l.floor - (l.grip ?? NaN)) };
}

/**
 * The floor the stroke in progress is heading for, or NaN for "the predictor's own"
 * (fewer than {@link MIN_FLOOR_PADS} pads learned, or no pad on the stroke's way).
 * A candidate is a switched-on pad whose shape the stroke's way crosses AT that pad's
 * floor (the point the stroke would stop at is on the pad). The one chosen is the
 * candidate whose strokes start nearest where this one did: for a stick tip the start
 * is a point, the fall's top and the hand's depth there (#533: the swing's height varies
 * stroke to stroke and the hand's depth over a pad much less, so the hand tells stacked
 * pads apart where the top cannot; a lower pad reached by tilting the stick, the hand
 * where it was, is still told apart by the top), else the top alone.
 *
 * A pad never struck competes through its {@link priorPadFloor} (#530: its first stroke
 * was read against a learned pad's floor) only where no learned pad is on the stroke's
 * way. Where one is (a stacked pad), a stroke whose start varies by about the pads' gap
 * reads exactly like a first stroke on the unstruck pad, and the three #530 reviews found
 * every margin breakable: a hand raised 0.07 over the kick sent every fourth stroke to the
 * snare never struck, and what it then learned there kept it wrong. A first stroke on a
 * stacked pad read against the learned one happens once (it turns on its own pad and
 * teaches it); a varied stroke read against an unstruck one recurs.
 */
export function padFloorFor(floors: PadFloors, pads: Pads, stroke: StrokeSoFar): number {
  const learned = learnedOn(floors, pads);
  if (learned.length < MIN_FLOOR_PADS || !Number.isFinite(stroke.top)) return NaN;
  const byGrip = Number.isFinite(stroke.grip ?? NaN) && learned.every((id) => Number.isFinite(floors[id]!.grip ?? NaN));
  const cost = (e: PadFloor) => (byGrip ? Math.hypot(stroke.top - e.top, stroke.grip! - e.grip!) : Math.abs(stroke.top - e.top));
  const onWay = (id: PadId, e: PadFloor) => padDistance(pads[id], { x: stroke.xAt(e.floor), y: e.floor }) <= 1;
  /** The nearest candidate among `ids`: its floor, NaN for none. */
  const nearest = (ids: PadId[], expected: (id: PadId) => PadFloor | undefined) => {
    let best = NaN;
    let bestCost = Infinity;
    for (const id of ids) {
      const e = expected(id);
      if (!e || !onWay(id, e)) continue;
      const c = cost(e);
      if (c < bestCost) {
        bestCost = c;
        best = e.floor;
      }
    }
    return best;
  };
  const known = nearest(learned, (id) => floors[id]);
  if (Number.isFinite(known)) return known;
  return nearest((Object.keys(pads) as PadId[]).filter((id) => pads[id].on && !floors[id]), (id) => priorPadFloor(floors, pads, id));
}
