/**
 * The lead offset's pure half (#427): the lag of a joint's anchors behind a click, the
 * offsets it passes, the per-joint shift, the corrector that holds a leading joint's
 * anchor until its time, and the calibration over frames.
 */
import { describe, expect, it } from 'vitest';
import { createLeadCalibration, createLeadCorrector, leadJointKey, leadOffsetsFrom, leadRefusal, measureLeadLag, shiftAnchor, type Anchor, type ChannelFrame } from '@thoremin/ictus';

const P = 0.75;
const clicks = Array.from({ length: 17 }, (_, i) => 1 + i * P);
/** A seeded, deterministic jitter in [-1, 1). */
const jitter = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
const anchor = (t: number, channel?: string): Anchor => ({ t, confidence: 1, strength: 1, sharpness: 1, lateral: 0, channel });

describe('measureLeadLag', () => {
  it('a steady lag behind the clicks, with jitter, is its mean', () => {
    const l = measureLeadLag(clicks.map((c, i) => c + 0.06 + 0.02 * jitter(i)), clicks);
    expect(l.lagS).toBeCloseTo(0.06, 2);
    expect(l.r).toBeGreaterThan(0.95);
    expect(l.n).toBe(clicks.length);
  });

  it('anchors either side of the click average to the click, not to half a beat', () => {
    // An even count: as many just before as just after.
    const l = measureLeadLag(clicks.slice(0, 16).map((c, i) => c + (i % 2 ? 0.05 : -0.05)), clicks);
    expect(Math.abs(l.lagS)).toBeLessThan(0.002);
  });

  it('a few strays half a beat off do not pull the lag (the trim)', () => {
    const steady = clicks.map((c) => c - 0.04);
    const strays = [clicks[3] + P / 2, clicks[8] + P / 2 + 0.03, clicks[12] + P / 2];
    expect(measureLeadLag([...steady, ...strays], clicks).lagS).toBeCloseTo(-0.04, 3);
  });

  it('anchors outside the clicked span are not read; no clicks, no lag', () => {
    expect(measureLeadLag([0, 100], clicks).n).toBe(0);
    expect(Number.isNaN(measureLeadLag([1], [1]).lagS)).toBe(true);
  });
});

describe('leadRefusal and leadOffsetsFrom', () => {
  const ok = { lagS: 0.09, r: 0.9, n: 16, seS: 0.01, kept: 16, halves: [0.08, 0.1] as const };
  it('keeps a joint the take measured; says why it refuses the others', () => {
    expect(leadRefusal(ok, P)).toBeNull();
    expect(leadRefusal({ ...ok, n: 4 }, P)).toBe('anchors');
    expect(leadRefusal({ ...ok, r: 0.3 }, P)).toBe('lock');
    expect(leadRefusal({ ...ok, lagS: 0.35 }, P)).toBe('level');
    expect(leadRefusal({ ...ok, seS: 0.025 }, P)).toBe('loose');
    // A quarter of the anchors cut by the trim: as loose as their spread would make it.
    expect(leadRefusal({ ...ok, kept: 11 }, P)).toBe('loose');
    expect(leadRefusal({ ...ok, halves: [0.05, 0.13] }, P)).toBe('drift');
    expect(leadRefusal({ ...ok, halves: [0.05, NaN] }, P)).toBe('drift');
  });

  it('by side-free key; of two sides, the one with more anchors (the arm that beat)', () => {
    const offsets = leadOffsetsFrom({ trunk: ok, 'wrist.left': { ...ok, lagS: 0.01, n: 9 }, 'wrist.right': { ...ok, lagS: 0.02, n: 15 }, elbow: { ...ok, r: 0.2 } }, P);
    expect(offsets).toEqual({ trunk: 0.09, wrist: 0.02 });
    expect(leadJointKey('elbow.right')).toBe('elbow');
  });

  it('an option passed as undefined keeps its default', () => {
    expect(leadOffsetsFrom({ trunk: { ...ok, n: 3 } }, P, { minAnchors: undefined })).toEqual({});
  });

  it('measures the spread and the halves: a joint whose lag moves mid-take drifts', () => {
    const moving = measureLeadLag(clicks.map((c, i) => c + (i < 8 ? 0.02 : 0.12)), clicks);
    expect(moving.halves[1] - moving.halves[0]).toBeCloseTo(0.1, 2);
    expect(leadRefusal(moving, P)).toBe('drift');
    const steady = measureLeadLag(clicks.map((c, i) => c + 0.05 + 0.01 * jitter(i)), clicks);
    expect(steady.seS).toBeLessThan(0.005);
    expect(leadRefusal(steady, P)).toBeNull();
  });
});

describe('shiftAnchor and the corrector', () => {
  it("moves an anchor by its joint's offset, and leaves the rest alone (the same object)", () => {
    const a = anchor(2, 'trunk');
    expect(shiftAnchor(a, { trunk: 0.05 }).t).toBeCloseTo(1.95, 9);
    expect(shiftAnchor(a, { wrist: 0.05 })).toBe(a);
    expect(shiftAnchor(anchor(2), { trunk: 0.05 }).t).toBe(2);
    expect(shiftAnchor(a, undefined)).toBe(a);
  });

  it('a late joint: delivered at once, earlier', () => {
    const c = createLeadCorrector({ trunk: 0.08 });
    expect(c.push(anchor(2, 'trunk'), 2.05)!.t).toBeCloseTo(1.92, 9);
  });

  it('an early joint: held until a frame reaches its corrected time, then delivered once', () => {
    const c = createLeadCorrector({ trunk: -0.1 });
    expect(c.push(anchor(2, 'trunk'), 2.03)).toBeNull();
    expect(c.push(null, 2.066)).toBeNull();
    expect(c.push(null, 2.1)!.t).toBeCloseTo(2.1, 9);
    expect(c.push(null, 2.2)).toBeNull();
  });

  it('two anchors due on one frame: the earlier now, the later on the next frame, in order', () => {
    const c = createLeadCorrector({ trunk: -0.1 });
    expect(c.push(anchor(2, 'trunk'), 2.03)).toBeNull();
    // A fresh, uncorrected anchor (another joint) on the frame the held one comes due.
    expect(c.push(anchor(2.11, 'wrist'), 2.12)!.t).toBeCloseTo(2.1, 9);
    expect(c.push(null, 2.15)!.t).toBeCloseTo(2.11, 9);
  });

  it('one stroke seen by two joints with different offsets is delivered once (the refractory)', () => {
    // The review's case: the detector switches from the elbow to the wrist mid-stroke.
    const c = createLeadCorrector({ elbow: -0.25 });
    const out = [c.push(anchor(2, 'elbow.right'), 2.03, 0.15), c.push(anchor(2.2, 'wrist.right'), 2.21, 0.15), c.push(null, 2.26, 0.15)].filter(Boolean);
    expect(out).toHaveLength(1);
    expect(out[0]!.t).toBeCloseTo(2.2, 9);
  });

  it('a reset drops a held anchor', () => {
    const c = createLeadCorrector({ trunk: -0.1 });
    c.push(anchor(3, 'trunk'), 3.01);
    c.reset();
    expect(c.push(null, 4)).toBeNull();
  });
});

describe('createLeadCalibration', () => {
  it("learns each joint's lag over frames: a wrist on the click, a trunk 90 ms behind it", () => {
    // Each channel bounces with a sharp bottom (|sin| cusp) at its own phase; y down.
    const bottom = (t: number, lag: number) => 100 + 40 * (1 - Math.abs(Math.sin((Math.PI * (t - 1 - lag)) / P)));
    const frames: ChannelFrame[] = [];
    for (let i = 0; i < 30 * 14; i++) {
      const t = i / 30;
      frames.push({
        t,
        scale: 150,
        channels: {
          wrist: { x: 300 + 0.3 * jitter(i), y: bottom(t, 0) + 0.3 * jitter(i + 1), visibility: 1 },
          trunk: { x: 320 + 0.3 * jitter(i + 2), y: 0.25 * bottom(t, 0.09) + 0.3 * jitter(i + 3), visibility: 1 },
        },
      });
    }
    const cal = createLeadCalibration({ joints: ['wrist', 'trunk'] });
    cal.setPeriod(P);
    for (const f of frames) cal.push(f);
    const r = cal.result(clicks);
    expect(Math.abs(r.offsets.wrist)).toBeLessThan(0.02);
    expect(r.offsets.trunk).toBeGreaterThan(0.07);
    expect(r.offsets.trunk).toBeLessThan(0.11);
    expect(r.refused).toEqual({});
    expect(r.clickInterval).toBeCloseTo(P, 9);
    cal.reset();
    expect(cal.anchors()).toEqual({ wrist: [], trunk: [] });
  });
});
