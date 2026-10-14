/**
 * The lead offset's pure half (#427): the lag of a joint's anchors behind a click, the
 * offsets it passes, the per-joint shift, the corrector that holds a leading joint's
 * anchor until its time, and the calibration over frames.
 */
import { describe, expect, it } from 'vitest';
import { createLeadCalibration, createLeadCorrector, leadOffsetsFrom, measureLeadLag, shiftAnchor, type Anchor, type ChannelFrame } from '@thoremin/ictus';

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

describe('leadOffsetsFrom', () => {
  it('keeps a joint that keeps the click, refuses one that does not, or one at another level', () => {
    const offsets = leadOffsetsFrom(
      {
        trunk: { lagS: 0.09, r: 0.65, n: 16 },
        elbow: { lagS: -0.08, r: 0.3, n: 16 },
        head: { lagS: 0.05, r: 0.9, n: 4 },
        hips: { lagS: 0.35, r: 0.9, n: 16 },
      },
      P,
    );
    expect(offsets).toEqual({ trunk: 0.09 });
  });

  it('an option passed as undefined keeps its default', () => {
    expect(leadOffsetsFrom({ trunk: { lagS: 0.05, r: 0.9, n: 3 } }, P, { minAnchors: undefined })).toEqual({});
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

  it('a held anchor is delivered before a fresh one; a reset drops it', () => {
    const c = createLeadCorrector({ trunk: -0.1 });
    c.push(anchor(2, 'trunk'), 2.03);
    // A fresh, uncorrected anchor (another joint) on the frame the held one comes due.
    expect(c.push(anchor(2.11, 'wrist'), 2.12)!.t).toBeCloseTo(2.1, 9);
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
    expect(r.clickInterval).toBeCloseTo(P, 9);
    cal.reset();
    expect(cal.anchors()).toEqual({ wrist: [], trunk: [] });
  });
});
