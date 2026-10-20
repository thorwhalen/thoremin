/** The torus view (#717): K7's three cycles, the rotation and the projection are pure geometry. */
import { describe, expect, it } from 'vitest';
import {
  TORUS_CYCLES, TORUS_DEGREES, DEFAULT_TORUS, flatPosition, torusPoint, rotate, project, loopPoints, torusView,
} from '../../packages/ext-harmony/src/views/torus';

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('the torus view', () => {
  it('puts seven distinct chords on the flat torus, wrapping by degree', () => {
    const keys = new Set(Array.from({ length: TORUS_DEGREES }, (_, d) => JSON.stringify(flatPosition(d))));
    expect(keys.size).toBe(7);
    expect(flatPosition(9)).toEqual(flatPosition(2));
    expect(flatPosition(-1)).toEqual(flatPosition(6));
  });

  it('the three cycles together are all 21 edges of K7, once each', () => {
    const edges = new Set<string>();
    for (const { step } of TORUS_CYCLES) {
      for (let d = 0; d < TORUS_DEGREES; d++) edges.add([d, (d + step) % TORUS_DEGREES].sort().join('-'));
    }
    expect(edges.size).toBe(21);
  });

  it('each cycle is a closed line through all seven chords', () => {
    for (const { step } of TORUS_CYCLES) {
      const pts = loopPoints(step, DEFAULT_TORUS, 8);
      expect(dist(pts[0], pts[pts.length - 1])).toBeLessThan(1e-9);
      for (let d = 0; d < TORUS_DEGREES; d++) {
        const { u, v } = flatPosition(d);
        const chord = torusPoint(u, v, DEFAULT_TORUS);
        expect(Math.min(...pts.map((p) => dist(p, chord)))).toBeLessThan(1e-9);
      }
    }
  });

  it('a cycle step lands exactly on the next chord of that cycle', () => {
    for (const { step } of TORUS_CYCLES) {
      const pts = loopPoints(step, DEFAULT_TORUS, 8);
      for (let k = 0; k < TORUS_DEGREES; k++) {
        const { u, v } = flatPosition((k * step) % TORUS_DEGREES);
        expect(dist(pts[k * 8], torusPoint(u, v, DEFAULT_TORUS))).toBeLessThan(1e-9);
      }
    }
  });

  it('rotation keeps distances from the centre and zero is the identity', () => {
    const p = torusPoint(0.3, 0.2);
    const r = rotate(p, { yaw: 0.7, pitch: -0.4 });
    expect(Math.hypot(r.x, r.y, r.z)).toBeCloseTo(Math.hypot(p.x, p.y, p.z), 9);
    expect(rotate(p, { yaw: 0, pitch: 0 })).toEqual({ x: p.x, y: p.y, z: p.z });
  });

  it('projection makes the nearer point larger', () => {
    expect(project({ x: 1, y: 1, z: 0 }).scale).toBeGreaterThan(project({ x: 1, y: -1, z: 0 }).scale);
  });

  it('torusView returns seven nodes and three loops, and a turn moves the nodes', () => {
    const a = torusView({ rotation: { yaw: 0, pitch: 0.5 } });
    const b = torusView({ rotation: { yaw: 1, pitch: 0.5 } });
    expect(a.nodes.map((n) => n.degree)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(a.loops.map((l) => l.name)).toEqual(['seconds', 'thirds', 'fourths']);
    expect(a.nodes[1].x).not.toBeCloseTo(b.nodes[1].x, 3);
  });
});
