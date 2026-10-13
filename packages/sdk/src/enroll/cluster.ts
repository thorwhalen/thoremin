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
 * Scale is a non-issue: O(n²) over the *hundreds* of still-points a 60-second gated
 * take produces, not the millions raw frames would give.
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
 * Build the agglomerative hierarchy over `vectors` with average linkage.
 *
 * Uses the Lance-Williams update so cluster-to-cluster distances are maintained
 * incrementally rather than recomputed from members on every merge — O(n²) overall
 * instead of O(n³), which is the difference between instant and noticeable at n≈400.
 */
export function buildHierarchy(
  vectors: readonly FeatureVector[],
  features: readonly string[],
  weights: Record<string, number> = {},
): Hierarchy {
  const n = vectors.length;
  if (n === 0) return { heights: [], size: 0 };
  if (n === 1) return { root: { members: [0], height: 0 }, heights: [], size: 1 };

  // Active cluster slots; `nodes[i]` is null once slot i has been merged away.
  const nodes: (TreeNode | null)[] = vectors.map((_, i) => ({ members: [i], height: 0 }));
  const counts: number[] = new Array(n).fill(1);
  const d: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = weightedDistance(vectors[i], vectors[j], features, weights);
      d[i][j] = dist;
      d[j][i] = dist;
    }
  }

  const heights: number[] = [];
  let remaining = n;
  while (remaining > 1) {
    // Closest active pair.
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!nodes[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!nodes[j]) continue;
        if (d[i][j] < best) {
          best = d[i][j];
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0) break;

    const a = nodes[bi]!;
    const b = nodes[bj]!;
    const merged: TreeNode = {
      members: [...a.members, ...b.members],
      height: best,
      left: a,
      right: b,
    };
    heights.push(best);

    // Lance-Williams for average linkage: the distance from the merged cluster to any
    // other is the count-weighted mean of its two children's distances.
    const na = counts[bi];
    const nb = counts[bj];
    for (let k = 0; k < n; k++) {
      if (k === bi || k === bj || !nodes[k]) continue;
      const nd = (na * d[bi][k] + nb * d[bj][k]) / (na + nb);
      d[bi][k] = nd;
      d[k][bi] = nd;
    }
    nodes[bi] = merged;
    counts[bi] = na + nb;
    nodes[bj] = null;
    remaining -= 1;
  }

  const root = nodes.find((x): x is TreeNode => x !== null);
  return { root, heights, size: n };
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

  const point: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = weightedDistance(vectors[i], vectors[j], features, weights);
      point[i][j] = dist;
      point[j][i] = dist;
    }
  }
  const nodes: (TreeNode | null)[] = leaves.map((l) => ({ members: l.members, height: 0 }));
  const counts = leaves.map((l) => l.members.length);
  const d: number[][] = Array.from({ length: m }, () => new Array(m).fill(Infinity));
  for (let a = 0; a < m; a++) {
    for (let b = a + 1; b < m; b++) {
      let dist = Infinity;
      if (leaves[a].group === -1 || leaves[b].group === -1) {
        let s = 0;
        for (const i of leaves[a].members) for (const j of leaves[b].members) s += point[i][j];
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
    if (bi < 0) break; // no allowed pair left
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
