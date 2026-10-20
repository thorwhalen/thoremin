/**
 * The chord map's torus on the video (#745): the cycle a move runs along (seconds, thirds,
 * fourths, the harmonic map's three axes), the element's memo lighting the cycle of the move just
 * made, the element drawing only while the map is on and its torus is shown, and the composed
 * chord-map branch wiring the map's status to it.
 */
import { describe, it, expect } from 'vitest';
import { cycleOfMove, torusRotation } from '@thoremin/ext-harmony/lib/torus';
import { drawTorusElement, updateTorusMemo } from '@thoremin/ext-harmony/nodes/overlay/chord_torus';
import { HARMONY_BRANCHES, CHORD_TORUS_ELEMENT } from '@thoremin/ext-harmony/branches';
import { HARMONY_EXTENSION } from '@thoremin/ext-harmony';
import { DEFAULT_CHORD_MAP } from '@thoremin/ext-harmony/dials';
import { overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { HARMONY_EXTENSION_ID } from '@thoremin/ext-harmony/id';

/** A 2-D context that counts the calls a drawing makes. */
function countingContext() {
  const calls: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => (typeof k === 'string' ? (...args: unknown[]) => void calls.push(`${k}(${args.length})`) : undefined),
    set: () => true,
  });
  return { g: g as unknown as CanvasRenderingContext2D, calls };
}

describe('the torus element', () => {
  it('names the cycle of each move: a second, a third, a fourth, both ways', () => {
    expect(cycleOfMove(0, 1)).toBe(1);
    expect(cycleOfMove(1, 0)).toBe(1);
    expect(cycleOfMove(0, 5)).toBe(2); // I to vi: a third down
    expect(cycleOfMove(0, 3)).toBe(3); // I to IV: a fourth up
    expect(cycleOfMove(0, 4)).toBe(3); // I to V: a fourth down
    expect(cycleOfMove(2, 2)).toBeNull();
    expect(cycleOfMove(null, 2)).toBeNull();
  });

  it('turns at the dial speed and stands still at zero', () => {
    expect(torusRotation(30, 2).yaw).toBeCloseTo(2 * Math.PI);
    expect(torusRotation(30, 0).yaw).toBe(0);
  });

  it('lights the cycle of the move just made, and keeps it while no chord is in force', () => {
    const memo: { current?: number | null; lit?: number | null } = {};
    updateTorusMemo(memo, 0);
    expect(memo).toMatchObject({ current: 0 });
    expect(memo.lit ?? null).toBeNull();
    updateTorusMemo(memo, 3);
    expect(memo).toMatchObject({ current: 3, lit: 3 });
    updateTorusMemo(memo, null);
    expect(memo).toMatchObject({ current: 3, lit: 3 });
    updateTorusMemo(memo, 3);
    expect(memo).toMatchObject({ current: 3, lit: 3 });
  });

  it('draws only while the map is on and the torus is shown (off by default)', () => {
    const frame = { W: 640, H: 480, t: 1 };
    expect(DEFAULT_CHORD_MAP.torusOnVideo).toEqual({ show: false, turnsPerMinute: 3 });
    const off = countingContext();
    drawTorusElement(off.g, frame, { config: { ...DEFAULT_CHORD_MAP, enabled: true }, status: { degree: 0 } }, {});
    expect(off.calls).toHaveLength(0);
    const on = countingContext();
    drawTorusElement(on.g, frame, { config: { ...DEFAULT_CHORD_MAP, enabled: true, torusOnVideo: { show: true, turnsPerMinute: 3 } }, status: { degree: 0 } }, {});
    expect(on.calls.filter((c) => c.startsWith('arc'))).toHaveLength(7);
  });

  it('is declared, implemented and fed by the chord-map branch', () => {
    expect(HARMONY_EXTENSION.overlay?.some((e) => e.name === CHORD_TORUS_ELEMENT)).toBe(true);
    expect(HARMONY_EXTENSION.overlayElements?.some((e) => e.name === CHORD_TORUS_ELEMENT)).toBe(true);
    const branch = HARMONY_BRANCHES.find((b) => b.overlay?.includes(overlayElementId(HARMONY_EXTENSION_ID, CHORD_TORUS_ELEMENT)));
    expect(branch).toBeDefined();
    expect(JSON.stringify(branch)).toContain(overlayPortName(HARMONY_EXTENSION_ID, CHORD_TORUS_ELEMENT, 'status'));
  });
});
