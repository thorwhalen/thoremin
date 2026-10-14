/**
 * The air drum's per-pad floors (#353), the pure half (`packages/ext-air/src/lib/pad_floors.ts`):
 * what each pad's strokes did is followed per pad, and a stroke is matched to the pad whose
 * strokes start nearest where it did, among the pads its way down crosses at their floor.
 * The production-graph takes are in `landing_arc.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { MIN_FLOOR_PADS, PAD_FLOOR_GAIN, learnPadFloor, padFloorFor, type PadFloors } from '@thoremin/ext-air/lib/pad_floors';
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
    expect(f.p1).toEqual({ floor: 0.72, top: 0.48 });
    f = learnPadFloor(f, 'p1', { floor: 0.74, top: 0.5 });
    expect(f.p1!.floor).toBeCloseTo(0.72 + PAD_FLOOR_GAIN * 0.02, 12);
    expect(learnPadFloor(f, 'p6', { floor: NaN, top: 0.5 })).toBe(f);
  });

  it('names nothing before a pad has a floor, or for a stroke whose way crosses no learned pad at its floor', () => {
    expect(MIN_FLOOR_PADS).toBe(1);
    expect(padFloorFor({}, pads, { top: 0.5, xAt: straightDown(0.5) })).toBeNaN();
    const f = learnPadFloor({}, 'p1', { floor: 0.72, top: 0.48 });
    expect(padFloorFor(f, pads, { top: 0.48, xAt: straightDown(0.5) })).toBe(0.72);
    // A stroke at the crash's x crosses no learned pad: the predictor's own floor.
    expect(padFloorFor(f, pads, { top: 0.1, xAt: straightDown(0.14) })).toBeNaN();
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
});
