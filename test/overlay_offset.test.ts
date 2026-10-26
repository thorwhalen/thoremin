import { describe, expect, it } from 'vitest';
import { speed, tipAt, trailOffset, type TipSample } from '../scripts/lib_overlay_offset';

const line = (n: number, vx: number): TipSample[] => Array.from({ length: n }, (_, i) => ({ t: i / 30, x: vx * (i / 30), y: 0 }));

describe('trail offset', () => {
  it('interpolates and clamps', () => {
    const s = line(3, 30); // x = 30 t
    expect(tipAt(s, 1 / 60).x).toBeCloseTo(0.5, 9);
    expect(tipAt(s, -1).x).toBe(0);
    expect(tipAt(s, 99).x).toBeCloseTo(2, 9);
  });

  it('a constant-speed sweep trails by speed x lag, in scaled units', () => {
    const s = line(60, 300); // 300 px/s
    const o = trailOffset(s, 0.025, 2);
    expect(o.p50).toBeCloseTo(300 * 0.025 * 2, 6);
    expect(o.max).toBeCloseTo(300 * 0.025 * 2, 6);
    expect(speed(s).p50).toBeCloseTo(300, 6);
  });

  it('a still hand does not trail; a recording shorter than the lag is refused', () => {
    expect(trailOffset(line(30, 0), 0.05).max).toBe(0);
    expect(() => trailOffset(line(2, 10), 5)).toThrow(/shorter than the lag/);
  });
});
