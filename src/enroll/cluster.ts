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
    const w = weights[f] ?? 1;
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
