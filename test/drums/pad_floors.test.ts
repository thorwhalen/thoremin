/**
 * The air drum's per-pad floors (#353), the pure half (`packages/ext-air/src/lib/pad_floors.ts`):
 * what each pad's strokes did is followed per pad, and a stroke is matched to the pad whose
 * strokes start nearest where it did, among the pads its way down crosses at their floor.
 * The production-graph takes are in `landing_arc.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { MIN_FLOOR_PADS, PAD_FLOOR_GAIN, learnPadFloor, padFloorFor, priorPadFloor, type PadFloors } from '@thoremin/ext-air/lib/pad_floors';
import { DEFAULT_PADS, DEFAULT_PADS_SET, type Pads } from '@thoremin/sdk/nodes/music/drum_pads';

/** The snare (p1, 0.5, 0.72) and the kick stacked under it (p6, 0.5, 0.80), and the crash (p4). */
const pads: Pads = {
  ...DEFAULT_PADS_SET,
  p1: { ...DEFAULT_PADS.p1, on: true },
  p6: { ...DEFAULT_PADS.p6, on: true },
  p4: { ...DEFAULT_PADS.p4, on: true },
};
const straightDown = (x: number) => () => x;

describe('per-pad floors (#353)', () => {
  it('follows each pad at the predictor\'s own gain, and a non-finite reading teaches nothing', () => {
    let f: PadFloors = {};
    f = learnPadFloor(f, 'p1', { floor: 0.72, top: 0.48 });
    expect(f.p1).toEqual({ floor: 0.72, top: 0.48, grip: NaN });
    f = learnPadFloor(f, 'p1', { floor: 0.74, top: 0.5 });
    expect(f.p1!.floor).toBeCloseTo(0.72 + PAD_FLOOR_GAIN * 0.02, 12);
    expect(learnPadFloor(f, 'p6', { floor: NaN, top: 0.5 })).toBe(f);
  });

  it('names nothing before a pad has a floor, or for a stroke whose way crosses no learned pad at its floor', () => {
    expect(MIN_FLOOR_PADS).toBe(1);
    expect(padFloorFor({}, pads, { top: 0.5, xAt: straightDown(0.5) })).toBeNaN();
    const f = learnPadFloor({}, 'p1', { floor: 0.72, top: 0.48 });
    expect(padFloorFor(f, pads, { top: 0.48, xAt: straightDown(0.5) })).toBe(0.72);
    // A stroke whose way crosses no pad at all: the predictor's own floor.
    expect(padFloorFor(f, pads, { top: 0.1, xAt: straightDown(0.99) })).toBeNaN();
    // A switched-off pad is no candidate, whatever it learned.
    expect(padFloorFor(f, { ...pads, p1: { ...pads.p1, on: false } }, { top: 0.48, xAt: straightDown(0.5) })).toBeNaN();
  });

  it('tells the stacked snare and kick apart by where the stroke started', () => {
    let f: PadFloors = {};
    f = learnPadFloor(f, 'p1', { floor: 0.72, top: 0.48 });
    f = learnPadFloor(f, 'p6', { floor: 0.8, top: 0.56 });
    // Both are under the stroke's way at their floors: the start decides.
    expect(padFloorFor(f, pads, { top: 0.49, xAt: straightDown(0.5) })).toBe(0.72);
    expect(padFloorFor(f, pads, { top: 0.55, xAt: straightDown(0.5) })).toBe(0.8);
    // A stroke whose way leaves the snare's width before its floor goes to the wider kick.
    expect(padFloorFor(f, pads, { top: 0.49, xAt: straightDown(0.37) })).toBe(0.8);
  });

  it('reads a pad never struck from its geometry and the player\'s habits on the others, where no learned pad is on the way (#530)', () => {
    // The player's snare strokes stop 0.02 below its centre and fall 0.24, the hand 0.1 above the floor.
    const f = learnPadFloor({}, 'p1', { floor: 0.74, top: 0.5, grip: 0.64 });
    expect(priorPadFloor({}, pads, 'p6')).toBeUndefined();
    const kick = priorPadFloor(f, pads, 'p6')!;
    expect(kick.floor).toBeCloseTo(0.8 + 0.02, 12);
    expect(kick.top).toBeCloseTo(0.82 - 0.24, 12);
    expect(kick.grip).toBeCloseTo(0.82 - 0.1, 12);
    // Only switched-on pads teach the prior.
    expect(priorPadFloor(f, { ...pads, p1: { ...pads.p1, on: false } }, 'p6')).toBeUndefined();
    // The crash, high and to the left with no learned pad on the way: its expected depth.
    expect(padFloorFor(f, pads, { top: 0.08, grip: 0.22, xAt: straightDown(0.14) })).toBeCloseTo(0.32, 12);
    expect(padFloorFor(f, pads, { top: 0.08, xAt: straightDown(0.14) })).toBeCloseTo(0.32, 12);
    // The kick, stacked under the learned snare: never named over it, however the stroke
    // starts (a varied snare stroke looks just like a first kick).
    expect(padFloorFor(f, pads, { top: kick.top, grip: kick.grip, xAt: straightDown(0.5) })).toBe(0.74);
    // Once struck, the kick's learned floor competes like any other.
    expect(padFloorFor(learnPadFloor(f, 'p6', { floor: 0.79, top: 0.6, grip: 0.72 }), pads, { top: 0.6, grip: 0.72, xAt: straightDown(0.5) })).toBe(0.79);
  });

  it('tells stacked pads apart by where the stroke starts, top and hand, for a stick tip (#533)', () => {
    let f: PadFloors = {};
    f = learnPadFloor(f, 'p1', { floor: 0.72, top: 0.48, grip: 0.62 });
    f = learnPadFloor(f, 'p6', { floor: 0.8, top: 0.56, grip: 0.7 });
    // A snare stroke swung lower (its top 0.06 down, nearer the kick's than the snare's)
    // is still the snare's: the hand is where the snare's strokes hold it.
    expect(padFloorFor(f, pads, { top: 0.54, grip: 0.62, xAt: straightDown(0.5) })).toBe(0.72);
    expect(padFloorFor(f, pads, { top: 0.54, xAt: straightDown(0.5) })).toBe(0.8);
    expect(padFloorFor(f, pads, { top: 0.56, grip: 0.7, xAt: straightDown(0.5) })).toBe(0.8);
    // A grip missing from one reading keeps the pad's own (it never turns the cue off).
    expect(learnPadFloor(f, 'p1', { floor: 0.72, top: 0.48 }).p1!.grip).toBeCloseTo(0.62, 12);
  });

});
