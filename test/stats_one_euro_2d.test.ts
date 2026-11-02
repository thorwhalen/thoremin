/**
 * The 2-D 1-euro filter (`@thoremin/stats` `createOneEuro2D`, #815): ONE cutoff for both axes, so
 * a diagonal stroke lags by the same TIME in x and y (two scalar filters do not: each raises its
 * cutoff by its own axis's speed); the optional `predicted` point leads the filtered one along
 * the motion; dt is the capture spacing, a repeated stamp changes nothing.
 */
import { describe, it, expect } from 'vitest';
import { createOneEuro, createOneEuro2D, ONE_EURO_2D_DEFAULTS } from '@thoremin/stats';

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
});
