/**
 * Carving the space (#160) — agglomerative hierarchy, cut at k.
 *
 * ## Why a hierarchy and not k-means
 *
 * This is the design move that makes the oddest-sounding half of the request nearly
 * free: *"a target number of categories that I could specify before **or afterwards**"*.
 *
 * Commit to a partition (k-means with k fixed, an online clusterer with a fixed
 * vigilance) and k becomes a training parameter — changing it means retraining, and
 * "afterwards" is not expressible. Build a **hierarchy** instead and the number of
 * clusters need not be specified a priori at all: clusters are obtained by cutting the
 * tree at a chosen level, and "give me k" is "cut at the height that yields k branches".
 *
 * So one recording supports 3 categories, then 5, then 4, **with no retraining and no
 * new data**. The player drags a slider and hears their vocabulary get finer or coarser.
 * That is the feature, not an implementation detail.
 *
 * Two more properties that fall out for free and are worth having:
 *
 * - **Order independence.** Agglomerative clustering on a fixed point set does not
 *   depend on the order the points arrived in. The streaming alternatives (the ART
 *   family) do, and mitigating it is a known research problem. For a bounded enrollment
 *   take, this is simply not a question we have to answer.
 * - **Determinism.** No seeding, no restarts, no `Math.random`. The same recording
 *   yields the same tree every time, which is what makes the whole thing testable.
 *
 * Scale: the merge loop is O(n²) in time and memory (a nearest-neighbour cache over a flat
 * distance matrix, see {@link agglomerate}), so the *hundreds* of still-points a 60-second gated
 * take produces build instantly and the file's bound of 2000 in about a second (#420).
 *
 * ## Linkage
 *
 * **Average linkage** (UPGMA). Single linkage chains — two genuinely distinct
 * expressions joined by one intermediate point merge into one blob, which is exactly the
 * failure mode a face full of continuous transitions invites. Complete linkage is the
 * opposite extreme and splits an honestly-broad category. Average sits between them and
 * is the standard default for this shape of data.
 */
import type { FeatureVector } from './types';

/** One node of the merge tree. Leaves carry a point index; internal nodes carry kids. */
export interface TreeNode {
  /** Indices of the still-points beneath this node. */
  members: number[];
  /** The linkage distance at which this node's two children merged (0 for a leaf). */
  height: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface Hierarchy {
  /** The single root (undefined when there were no points). */
  root?: TreeNode;
  /** Merge heights in the order they occurred, ascending. */
  heights: number[];
  /** How many points the tree was built from. */
  size: number;
}

/** Weighted Euclidean distance between two vectors over `features`. */
export function weightedDistance(
  a: FeatureVector,
  b: FeatureVector,
  features: readonly string[],
  weights: Record<string, number>,
): number {
  let sum = 0;
  for (const f of features) {
    // Own keys only: a feature named `toString` must not read Object.prototype (#355).
    const w = Object.hasOwn(weights, f) ? weights[f] : 1;
    if (w === 0) continue;
    const x = a[f];
    const y = b[f];
    // A non-finite feature ("not measurable this frame") contributes nothing rather
    // than making the whole distance NaN — one absent landmark must not delete a point.
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const d = (x - y) * w;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Build the agglomerative hierarchy over `vectors` with average linkage: the unconstrained
 * {@link buildConstrainedForest}, whose one root (when every distance is finite) is the tree.
 *
 * Uses the Lance-Williams update so cluster-to-cluster distances are maintained
 * incrementally rather than recomputed from members on every merge.
 */
export function buildHierarchy(
  vectors: readonly FeatureVector[],
  features: readonly string[],
  weights: Record<string, number> = {},
): Hierarchy {
  const { roots, heights, size } = buildConstrainedForest(vectors, features, weights);
  return { root: roots[0], heights, size };
}

/**
 * Cut the tree into exactly `k` clusters — the "specify the count afterwards" operation.
 *
 * Repeatedly splits the currently-tallest node, which is equivalent to cutting at the
 * height that yields k branches, and is exact rather than a search over cut heights.
 * Returns arrays of point indices. `k` is clamped to `[1, size]`, so a slider that runs
 * past either end degrades instead of throwing.
 */
export function cutAt(hierarchy: Hierarchy, k: number): number[][] {
  const { root, size } = hierarchy;
  if (!root || size === 0) return [];
  const want = Math.max(1, Math.min(Math.floor(k), size));
  const open: TreeNode[] = [root];
  while (open.length < want) {
    // Split the tallest splittable node.
    let idx = -1;
    let tallest = -Infinity;
    for (let i = 0; i < open.length; i++) {
      const nd = open[i];
      if (nd.left && nd.right && nd.height > tallest) {
        tallest = nd.height;
        idx = i;
      }
    }
    if (idx < 0) break; // all leaves — cannot split further
    const [node] = open.splice(idx, 1);
    open.push(node.left!, node.right!);
  }
  // Stable order: by first member index, so cluster 1 is always the same cluster.
  return open.map((nd) => [...nd.members].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
}

/**
 * Suggest a k from the merge heights: the largest RELATIVE gap between successive
 * merges, which is the classic "natural clustering" heuristic.
 *
 * Relative rather than absolute, because merge heights grow as clusters do — an absolute
 * gap criterion is biased toward tiny k on almost any real data.
 *
 * **This is a suggestion and the caller must present it as one.** The clustering
 * literature is explicit that dendrograms over-suggest structure: they often "suggest a
 * correct number of clusters when there is no real evidence to support the conclusion."
 * Show the player why, and let them overrule it.
 */
export function suggestK(hierarchy: Hierarchy, opts: { max?: number } = {}): number {
  const { heights, size } = hierarchy;
  if (size <= 1) return size;
  const max = Math.min(opts.max ?? 8, size);
  // heights[i] is the i-th merge; cutting just before merge i leaves size - i clusters.
  let bestK = Math.min(2, size);
  let bestRatio = -Infinity;
  for (let i = 1; i < heights.length; i++) {
    const k = size - i;
    if (k < 2 || k > max) continue;
    const prev = heights[i - 1];
    const ratio = prev > 1e-9 ? heights[i] / prev : heights[i] > 1e-9 ? Infinity : 1;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestK = k;
    }
  }
  return bestK;
}

/**
 * A hierarchy that may stop short of one root: what {@link buildConstrainedForest} builds.
 * `size` counts LEAVES (a must-link group is one leaf), so the finest cut has `size` clusters
 * and the coarsest has `roots.length`.
 */
export interface Forest {
  roots: TreeNode[];
  /** Merge heights in the order they occurred, ascending. */
  heights: number[];
  /** How many leaves the forest was built from. */
  size: number;
}

export interface ConstraintOptions {
  /**
   * Groups of point indices that must end in one cluster, each a DIFFERENT category: a group is
   * one leaf (must-link), and two clusters holding different groups never merge (cannot-link).
   * Disjoint; an index outside `vectors` or in two groups throws.
   */
  mustLink?: readonly (readonly number[])[];
}

/**
 * The agglomerative hierarchy of {@link buildHierarchy} under pairwise constraints (#385 E4): a
 * player's moves, kept as pins, are must-link (the holds pinned to one category start as one
 * leaf) and cannot-link (clusters holding holds pinned to different categories never merge).
 * Merging stops when no allowed pair is left, so the result is a forest with one root per
 * pinned category (one root when nothing is pinned, the same tree `buildHierarchy` builds).
 *
 * Average linkage over POINTS, so a group of three counts three times: a group-to-cluster
 * distance is the mean of its point-to-point distances, and the Lance-Williams update carries
 * the counts. A forbidden pair has distance `Infinity`, and the update keeps it so: a cluster
 * that took a group in inherits that group's `Infinity` to every other group. Deterministic.
 */
export function buildConstrainedForest(
  vectors: readonly FeatureVector[],
  features: readonly string[],
  weights: Record<string, number> = {},
  { mustLink = [] }: ConstraintOptions = {},
): Forest {
  const n = vectors.length;
  const groupOf = new Array<number>(n).fill(-1);
  mustLink.forEach((g, gi) => {
    for (const j of g) {
      if (!Number.isInteger(j) || j < 0 || j >= n) throw new Error(`buildConstrainedForest: index ${j} is not a point`);
      if (groupOf[j] !== -1) throw new Error(`buildConstrainedForest: point ${j} is in two groups`);
      groupOf[j] = gi;
    }
  });
  // Leaves: each non-empty group, then every free point, in order of first member.
  const leaves: { members: number[]; group: number }[] = [];
  mustLink.forEach((g, gi) => {
    if (g.length > 0) leaves.push({ members: [...g].sort((a, b) => a - b), group: gi });
  });
  for (let j = 0; j < n; j++) if (groupOf[j] === -1) leaves.push({ members: [j], group: -1 });
  leaves.sort((a, b) => a.members[0] - b.members[0]);
  const m = leaves.length;
  if (m === 0) return { roots: [], heights: [], size: 0 };

  const dist = pointDistance(vectors, features, weights);
  const d = new Float64Array(m * m).fill(Infinity);
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      let dd = Infinity;
      if (leaves[a].group === -1 || leaves[b].group === -1) {
        let s = 0;
        for (const i of leaves[a].members) for (const j of leaves[b].members) s += dist(i, j);
        dd = s / (leaves[a].members.length * leaves[b].members.length);
      }
      d[a * m + b] = dd;
      d[b * m + a] = dd;
    }
  }
  const nodes: (TreeNode | null)[] = leaves.map((l) => ({ members: l.members, height: 0 }));
  const { roots, heights } = agglomerate(d, m, nodes, leaves.map((l) => l.members.length));
  return { roots, heights, size: m };
}

/**
 * A distance between two of `vectors` by index, bit for bit {@link weightedDistance}: the
 * coordinates are read once into a flat array (a non-finite one as NaN, which the sum skips as
 * `weightedDistance` does, the zero-weight features dropped), so the O(n²) pairs of a hierarchy
 * or a medoid pay no property lookups (#420).
 */
export function pointDistance(
  vectors: readonly FeatureVector[],
  features: readonly string[],
  weights: Record<string, number>,
): (i: number, j: number) => number {
  const ws: number[] = [];
  const kept: string[] = [];
  for (const f of features) {
    const w = Object.hasOwn(weights, f) ? weights[f] : 1;
    if (w === 0) continue;
    ws.push(w);
    kept.push(f);
  }
  const dim = kept.length;
  const x = new Float64Array(vectors.length * dim);
  vectors.forEach((v, i) => {
    kept.forEach((f, k) => {
      const value = v[f];
      x[i * dim + k] = Number.isFinite(value) ? value : NaN;
    });
  });
  return (i, j) => {
    let sum = 0;
    const oi = i * dim;
    const oj = j * dim;
    for (let k = 0; k < dim; k++) {
      const a = x[oi + k];
      const b = x[oj + k];
      if (a !== a || b !== b) continue; // NaN: not measurable this frame
      const e = (a - b) * ws[k];
      sum += e * e;
    }
    return Math.sqrt(sum);
  };
}

/**
 * Greedy average-linkage agglomeration over `m` slots: repeatedly merge the closest allowed
 * pair (ties to the lowest slot pair, row-major), the merged cluster taking the lower slot,
 * until no pair is below `Infinity`. `d` is the symmetric m x m distance matrix (row-major,
 * updated in place); `nodes` and `counts` are the slots' starting clusters and point counts.
 *
 * Each live row keeps its nearest live column to its right (a nearest-neighbour cache), so a
 * merge rescans only the merged row and the rows whose nearest was one of the pair: O(n²)
 * overall instead of the O(n³) of a full scan per merge (#420). It is exact, not a heuristic:
 * the global minimum is the minimum over the rows' cached minima, and a row that pointed
 * elsewhere can only gain the merged slot, whose new distance is checked against its cache
 * with the same tie rule. So the tree is the one the full scan builds, merge for merge.
 */
function agglomerate(
  d: Float64Array,
  m: number,
  nodes: (TreeNode | null)[],
  counts: number[],
): { roots: TreeNode[]; heights: number[] } {
  const nn = new Int32Array(m).fill(-1);
  const nnDist = new Float64Array(m).fill(Infinity);
  const rescan = (i: number) => {
    let best = Infinity;
    let at = -1;
    const row = i * m;
    for (let j = i + 1; j < m; j++) {
      if (nodes[j] && d[row + j] < best) {
        best = d[row + j];
        at = j;
      }
    }
    nn[i] = at;
    nnDist[i] = best;
  };
  for (let i = 0; i < m; i++) rescan(i);

  const heights: number[] = [];
  for (;;) {
    let bi = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      if (nodes[i] && nnDist[i] < best) {
        best = nnDist[i];
        bi = i;
      }
    }
    if (bi < 0) break; // no allowed pair left
    const bj = nn[bi];
    const a = nodes[bi]!;
    const b = nodes[bj]!;
    heights.push(best);
    const na = counts[bi];
    const nb = counts[bj];
    for (let k = 0; k < m; k++) {
      if (k === bi || k === bj || !nodes[k]) continue;
      const nd = (na * d[bi * m + k] + nb * d[bj * m + k]) / (na + nb);
      d[bi * m + k] = nd;
      d[k * m + bi] = nd;
    }
    nodes[bi] = { members: [...a.members, ...b.members], height: best, left: a, right: b };
    counts[bi] = na + nb;
    nodes[bj] = null;
    nn[bj] = -1;
    nnDist[bj] = Infinity;
    // Rows left of bi see the merged slot's new distance; rows that pointed at either half
    // (only rows left of bj can) rescan; row bi rescans.
    for (let k = 0; k < bj; k++) {
      if (!nodes[k]) continue;
      if (k === bi || nn[k] === bi || nn[k] === bj) rescan(k);
      else if (k < bi) {
        const nd = d[k * m + bi];
        if (nd < nnDist[k] || (nd === nnDist[k] && nd < Infinity && bi < nn[k])) {
          nn[k] = bi;
          nnDist[k] = nd;
        }
      }
    }
  }
  return { roots: nodes.filter((x): x is TreeNode => x !== null), heights };
}

/** The k a forest can be cut at: from one cluster per root to one per leaf. */
export function forestRange(forest: Forest): { minK: number; maxK: number } {
  return { minK: forest.roots.length, maxK: forest.size };
}

/**
 * Cut a forest into `k` clusters, `k` clamped to {@link forestRange}: start from the roots and
 * split the tallest splittable node until there are `k`, as {@link cutAt} does for one tree.
 * A must-link leaf is never split. Clusters are ordered by first member.
 */
export function cutForest(forest: Forest, k: number): number[][] {
  const { minK, maxK } = forestRange(forest);
  if (maxK === 0) return [];
  const want = Math.max(minK, Math.min(maxK, Math.floor(Number.isFinite(k) ? k : minK)));
  const open: TreeNode[] = [...forest.roots];
  while (open.length < want) {
    let idx = -1;
    let tallest = -Infinity;
    for (let i = 0; i < open.length; i++) {
      const nd = open[i];
      if (nd.left && nd.right && nd.height > tallest) {
        tallest = nd.height;
        idx = i;
      }
    }
    if (idx < 0) break;
    const [node] = open.splice(idx, 1);
    open.push(node.left!, node.right!);
  }
  return open.map((nd) => [...nd.members].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
}

/** {@link suggestK} for a forest, clamped to its range. A suggestion, as there. */
export function suggestForestK(forest: Forest, opts: { max?: number } = {}): number {
  const { minK, maxK } = forestRange(forest);
  if (maxK === 0) return 0;
  return Math.max(minK, Math.min(maxK, suggestK({ heights: forest.heights, size: forest.size }, opts)));
}
