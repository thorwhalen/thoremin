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
    expect(f.p1).toEqual({ floor: 0.72, top: 0.48, grip: NaN, spread: NaN });
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

  it('reads a pad never struck from its geometry and the player\'s habits on the others (#530)', () => {
    // The player's snare strokes stop 0.02 below its centre, fall 0.24, the hand 0.1 above the floor.
    const f = learnPadFloor({}, 'p1', { floor: 0.74, top: 0.5, grip: 0.64 });
    expect(priorPadFloor({}, pads, 'p6')).toBeUndefined();
    const kick = priorPadFloor(f, pads, 'p6')!;
    expect(kick.floor).toBeCloseTo(0.8 + 0.02, 12);
    expect(kick.top).toBeCloseTo(0.82 - 0.24, 12);
    expect(kick.grip).toBeCloseTo(0.82 - 0.1, 12);
    // Only switched-on pads teach the prior.
    expect(priorPadFloor(f, { ...pads, p1: { ...pads.p1, on: false } }, 'p6')).toBeUndefined();
    // With the hand read (a stick tip): the first stroke on the kick, the hand held at the
    // kick's expected grip, is named the kick's expected floor; a snare stroke keeps the
    // snare's, whatever its height.
    expect(padFloorFor(f, pads, { top: 0.58, grip: 0.72, xAt: straightDown(0.5) })).toBeCloseTo(0.82, 12);
    expect(padFloorFor(f, pads, { top: 0.58, grip: 0.64, xAt: straightDown(0.5) })).toBe(0.74);
    // The crash, high and to the left, is reached at its own expected depth.
    expect(padFloorFor(f, pads, { top: 0.08, grip: 0.22, xAt: straightDown(0.14) })).toBeCloseTo(0.32, 12);
    // Once struck, the learned floor replaces the prior.
    expect(padFloorFor(learnPadFloor(f, 'p6', { floor: 0.79, top: 0.6, grip: 0.7 }), pads, { top: 0.6, grip: 0.7, xAt: straightDown(0.5) })).toBe(0.79);
  });

  it('with no hand to read, a prior competes only where no learned pad is on the way (the #530 review)', () => {
    const f = learnPadFloor({}, 'p1', { floor: 0.74, top: 0.5 });
    // A snare stroke started low, near the kick's expected top: the learned snare keeps it.
    expect(padFloorFor(f, pads, { top: 0.58, xAt: straightDown(0.5) })).toBe(0.74);
    // At the crash's x no learned pad is on the way: the crash's expected floor.
    expect(padFloorFor(f, pads, { top: 0.08, xAt: straightDown(0.14) })).toBeCloseTo(0.32, 12);
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

  it('names a never-struck pad only by a margin, and only for a stroke unlike the learned pad\'s own (the #530 reviews)', () => {
    // The snare struck twice with the hand 0.04 apart: its strokes scatter.
    let f = learnPadFloor({}, 'p1', { floor: 0.72, top: 0.48, grip: 0.62 });
    f = learnPadFloor(f, 'p1', { floor: 0.72, top: 0.44, grip: 0.58 });
    expect(f.p1!.spread).toBeCloseTo(Math.hypot(0.04, 0.04), 12);
    // The kick (never struck) is expected 0.08 lower. A stroke 0.065 under the snare's usual
    // start is within the snare's scatter x PRIOR_SPREADS: the snare's.
    const usual = f.p1!;
    // (nearer the kick's expected start by the margin, but the snare's own strokes scatter that much)
    expect(padFloorFor(f, pads, { top: usual.top + 0.065, grip: usual.grip! + 0.065, xAt: straightDown(0.5) })).toBe(0.72);
    // A stroke started where the kick's strokes are expected, far from the snare's: the kick.
    const kick = priorPadFloor(f, pads, 'p6')!;
    expect(padFloorFor(f, pads, { top: kick.top, grip: kick.grip, xAt: straightDown(0.5) })).toBeCloseTo(kick.floor, 12);
  });
});
