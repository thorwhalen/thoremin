/**
 * The fast agglomeration (#420): the nearest-neighbour cache over a flat distance matrix builds
 * the SAME forest as the full scan per merge it replaced, merge for merge, heights bit for bit,
 * on inputs chosen to be hard for it (integer coordinates, so ties everywhere; non-finite
 * features; zero and non-unit weights; must-link groups whose cannot-link leaves `Infinity`
 * pairs). The medoid's pair matrix is checked the same way against the pairwise loop it replaced.
 */
import { describe, expect, it } from 'vitest';
import { buildConstrainedForest, buildHierarchy, weightedDistance, type Forest, type TreeNode } from '@thoremin/sdk/enroll/cluster';
import { selectExemplars } from '@thoremin/sdk/enroll/exemplars';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** A small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The forest as the full scan per merge built it before #420 (the reference). */
function referenceForest(vectors: readonly FeatureVector[], features: readonly string[], weights: Record<string, number>, mustLink: readonly (readonly number[])[]): Forest {
  const n = vectors.length;
  const groupOf = new Array<number>(n).fill(-1);
  mustLink.forEach((g, gi) => g.forEach((j) => (groupOf[j] = gi)));
  const leaves: { members: number[]; group: number }[] = [];
  mustLink.forEach((g, gi) => {
    if (g.length > 0) leaves.push({ members: [...g].sort((a, b) => a - b), group: gi });
  });
  for (let j = 0; j < n; j++) if (groupOf[j] === -1) leaves.push({ members: [j], group: -1 });
  leaves.sort((a, b) => a.members[0] - b.members[0]);
  const m = leaves.length;
  if (m === 0) return { roots: [], heights: [], size: 0 };
  const nodes: (TreeNode | null)[] = leaves.map((l) => ({ members: l.members, height: 0 }));
  const counts = leaves.map((l) => l.members.length);
  const d: number[][] = Array.from({ length: m }, () => new Array(m).fill(Infinity));
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      let dist = Infinity;
      if (leaves[a].group === -1 || leaves[b].group === -1) {
        let s = 0;
        for (const i of leaves[a].members) for (const j of leaves[b].members) s += weightedDistance(vectors[i], vectors[j], features, weights);
        dist = s / (counts[a] * counts[b]);
      }
      d[a][b] = dist;
      d[b][a] = dist;
    }
  }
  const heights: number[] = [];
  for (;;) {
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      if (!nodes[i]) continue;
      for (let j = i + 1; j < m; j++) {
        if (nodes[j] && d[i][j] < best) {
          best = d[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;
    const a = nodes[bi]!;
    const b = nodes[bj]!;
    heights.push(best);
    const na = counts[bi];
    const nb = counts[bj];
    for (let k = 0; k < m; k++) {
      if (k === bi || k === bj || !nodes[k]) continue;
      const nd = (na * d[bi][k] + nb * d[bj][k]) / (na + nb);
      d[bi][k] = nd;
      d[k][bi] = nd;
    }
    nodes[bi] = { members: [...a.members, ...b.members], height: best, left: a, right: b };
    counts[bi] = na + nb;
    nodes[bj] = null;
  }
  return { roots: nodes.filter((x): x is TreeNode => x !== null), heights, size: m };
}

const FEATURES = ['x', 'y', 'z'];
/** Weights that are hard for it: zero, odd, negative, non-finite (a NaN or Infinity row). */
const WEIGHTS: Record<string, number>[] = [{ x: 2, y: 0 }, { z: 0.5 }, {}, { x: -2 }, { y: Infinity }, { z: NaN }, { x: 0, y: 0, z: 0 }];

/** Integer coordinates in [0, span), so many pairs tie; some features not measurable. */
function tieHeavy(rand: () => number, n: number, span: number): FeatureVector[] {
  return Array.from({ length: n }, () => {
    const v: FeatureVector = {};
    for (const f of FEATURES) v[f] = rand() < 0.05 ? NaN : Math.floor(rand() * span);
    return v;
  });
}

/** Disjoint must-link groups over a random subset of `n` points. */
function groups(rand: () => number, n: number, count: number): number[][] {
  const order = Array.from({ length: n }, (_, i) => i).sort(() => rand() - 0.5);
  const out: number[][] = [];
  let at = 0;
  for (let g = 0; g < count && at < n; g++) {
    const size = 1 + Math.floor(rand() * 3);
    out.push(order.slice(at, at + size));
    at += size;
  }
  return out;
}

describe('the fast agglomeration (#420)', () => {
  it('builds the full scan forest exactly, ties and Infinity pairs included', () => {
    const rand = rng(420);
    for (let run = 0; run < 150; run++) {
      const n = run === 0 ? 0 : 1 + Math.floor(rand() * 45);
      const vs = tieHeavy(rand, n, 2 + Math.floor(rand() * 4));
      const weights = WEIGHTS[run % WEIGHTS.length];
      const mustLink = [...groups(rand, n, Math.floor(rand() * 5)), ...(run % 4 === 0 ? [[]] : [])];
      expect(buildConstrainedForest(vs, FEATURES, weights, { mustLink })).toEqual(referenceForest(vs, FEATURES, weights, mustLink));
    }
  });

  it('builds the full scan hierarchy exactly (no pins: one root)', () => {
    const rand = rng(7);
    for (let run = 0; run < 50; run++) {
      const vs = tieHeavy(rand, 1 + Math.floor(rand() * 40), 3);
      const ref = referenceForest(vs, FEATURES, {}, []);
      const h = buildHierarchy(vs, FEATURES);
      expect(h.heights).toEqual(ref.heights);
      expect(h.root).toEqual(ref.roots[0]);
    }
  });

  it('picks the medoid the pairwise loop picked', () => {
    const rand = rng(11);
    for (let run = 0; run < 60; run++) {
      const vs = tieHeavy(rand, 2 + Math.floor(rand() * 30), 3);
      const members = vs.map((_, i) => i).filter(() => rand() < 0.8);
      if (members.length === 0) continue;
      const model = { features: FEATURES, weights: WEIGHTS[run % 4] };
      let medoid = members[0];
      let best = Infinity;
      for (const j of members) {
        let total = 0;
        for (const k of members) if (k !== j) total += weightedDistance(vs[j], vs[k], FEATURES, model.weights);
        if (total < best - 1e-12) {
          best = total;
          medoid = j;
        }
      }
      const centroid = { x: 1, y: 1, z: 1 };
      expect(selectExemplars(model, { centroid, members }, vs)[0].index).toBe(medoid);
    }
  });
});
