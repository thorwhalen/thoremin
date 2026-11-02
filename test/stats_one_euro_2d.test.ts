/**
 * The 2-D 1-euro filter (`@thoremin/stats` `createOneEuro2D`, #815): ONE cutoff for both axes, so
 * a diagonal stroke lags by the same TIME in x and y (two scalar filters do not: each raises its
 * cutoff by its own axis's speed); the optional `predicted` point leads the filtered one along
 * the motion; dt is the capture spacing, a repeated stamp changes nothing.
 */
import { describe, it, expect } from 'vitest';
import { createOneEuro, createOneEuro2D, oneEuroAlpha, ONE_EURO_2D_DEFAULTS } from '@thoremin/stats';

const DT = 1 / 30;
const V = { x: 0.6, y: 0.2 };

/** A point at rest for 0.5 s, then moving at `V` frame units per second: [t, x, y] per frame. */
function diagonal(frames = 45): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < frames; i++) {
    const t = i * DT;
    const m = Math.max(0, t - 0.5);
    out.push([t, 0.2 + V.x * m, 0.3 + V.y * m]);
  }
  return out;
}

describe('createOneEuro2D', () => {
  it('lags x and y by the same time on a diagonal (one shared cutoff)', () => {
    const f = createOneEuro2D();
    let last = { x: 0, y: 0, rx: 0, ry: 0 };
    for (const [t, x, y] of diagonal()) {
      const o = f.push(t, x, y);
      last = { x: o.x, y: o.y, rx: x, ry: y };
    }
    const lagX = (last.rx - last.x) / V.x;
    const lagY = (last.ry - last.y) / V.y;
    expect(lagX).toBeGreaterThan(0.005);
    expect(lagX).toBeCloseTo(lagY, 9);
  });

  it('where two scalar filters with the same settings lag differently (the reason it exists)', () => {
    const fx = createOneEuro(ONE_EURO_2D_DEFAULTS);
    const fy = createOneEuro(ONE_EURO_2D_DEFAULTS);
    let lagX = 0;
    let lagY = 0;
    for (const [t, x, y] of diagonal()) {
      lagX = (x - fx.push(t, x)) / V.x;
      lagY = (y - fy.push(t, y)) / V.y;
    }
    expect(Math.abs(lagX - lagY)).toBeGreaterThan(0.005);
  });

  it('predicted leads the filtered point along the motion, and is absent unless asked for', () => {
    const f = createOneEuro2D({ predict: 0.05 });
    const plain = createOneEuro2D();
    let o = f.push(-1, 0.2, 0.3);
    for (const [t, x, y] of diagonal()) {
      o = f.push(t, x, y);
      expect(plain.push(t, x, y).predicted).toBeUndefined();
    }
    const p = o.predicted!;
    const ahead = (p.x - o.x) * V.x + (p.y - o.y) * V.y;
    expect(ahead).toBeGreaterThan(0);
    // By the smoothed velocity times the lead: about |V| x 0.05 once the speed estimate has settled.
    expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeCloseTo(Math.hypot(V.x, V.y) * 0.05, 2);
  });

  it('smooths jitter at rest, and a repeated capture stamp is not a new sample', () => {
    const f = createOneEuro2D();
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    let inVar = 0;
    let outVar = 0;
    for (let i = 0; i < 90; i++) {
      const nx = noise();
      const ny = noise();
      const o = f.push(i * DT, 0.5 + nx, 0.5 + ny);
      if (i > 30) {
        inVar += nx * nx + ny * ny;
        outVar += (o.x - 0.5) ** 2 + (o.y - 0.5) ** 2;
      }
    }
    expect(outVar).toBeLessThan(inVar / 4);
    const before = f.push(90 * DT, 0.5, 0.5);
    const again = f.push(90 * DT, 0.9, 0.9);
    expect(again).toEqual(before);
  });

  it('the predicted velocity is smoothed at dCutoff, not the raw step of the filtered point', () => {
    const lead = 0.05;
    const f = createOneEuro2D({ predict: lead });
    for (let i = 0; i < 30; i++) f.push(i * DT, 0.5, 0.5);
    // One step: the filtered point moves, and a raw (x - px) / dt would put the prediction a
    // whole step's speed ahead; the smoothed velocity moves only by the dCutoff gain of it.
    const o = f.push(30 * DT, 0.6, 0.5);
    const rawLead = ((o.x - 0.5) / DT) * lead;
    const gain = oneEuroAlpha(ONE_EURO_2D_DEFAULTS.dCutoff, DT);
    expect(o.predicted!.x - o.x).toBeCloseTo(gain * rawLead, 12);
    expect(o.predicted!.x - o.x).toBeLessThan(0.5 * rawLead);
  });

  it('skips a non-finite reading: the previous output again, and no re-seed snap after it', () => {
    const f = createOneEuro2D({ predict: 0.05 });
    const g = createOneEuro2D({ predict: 0.05 });
    for (let i = 0; i < 20; i++) {
      f.push(i * DT, 0.2 + 0.01 * i, 0.5);
      g.push(i * DT, 0.2 + 0.01 * i, 0.5);
    }
    const before = f.push(20 * DT, 0.4, 0.5);
    g.push(20 * DT, 0.4, 0.5);
    expect(f.push(21 * DT, NaN, 0.5)).toEqual(before);
    expect(f.push(22 * DT, 0.5, Infinity)).toEqual(before);
    expect(f.push(NaN, 0.5, 0.5)).toEqual(before);
    // The next finite point is filtered from the state kept, as if the bad ones never came.
    expect(f.push(23 * DT, 0.43, 0.5)).toEqual(g.push(23 * DT, 0.43, 0.5));
    // Before any finite point there is nothing to repeat: NaN, and the first finite one seeds.
    const h = createOneEuro2D();
    expect(Number.isNaN(h.push(0, NaN, NaN).x)).toBe(true);
    expect(h.push(DT, 0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 });
  });
});
