/**
 * A 2-D map of the holds for the sorting grid (#434, design C.3.2): the Fisher LDA projection
 * that best separates the categories as they stand, or the first two principal axes when there
 * are fewer than three classes (LDA has k - 1 axes). Dependency-free on purpose (no umap-js in
 * the lazy chunk), deterministic, and a pure function of its inputs: nothing here is stored.
 *
 * It works in the model's own metric (each feature times its weight, as the classifier measures
 * distance), so what is near on the map is near to the classifier. `project` places a live
 * vector in the same plane (the map's cursor); a missing feature reads as the holds' mean, which
 * puts it at the middle of that axis rather than at an edge.
 *
 * The within-class scatter is regularised (a ridge a fraction of its mean variance): a carve has
 * far fewer holds than features, so without it the solve is singular and the map is noise.
 */
import type { FeatureVector, FeatureWeights } from './types';
import type { Point2 } from './projection';

export const LDA_DEFAULTS = {
  /** The ridge on the within-class scatter, as a share of its mean variance. */
  ridge: 0.05,
  /** Power-iteration steps per principal axis. */
  powerSteps: 200,
  /** Jacobi sweeps over the class-by-class matrix. */
  jacobiSweeps: 60,
} as const;

export interface LdaMap {
  /** One point per input vector, in input order. */
  points: Point2[];
  /** Where a vector falls on the same map. */
  project(vector: FeatureVector): Point2;
  /** `lda` when the axes separate the classes, `pca` when there are too few classes for that. */
  method: 'lda' | 'pca';
}

const dot = (a: readonly number[], b: readonly number[]): number => a.reduce((s, x, i) => s + x * b[i], 0);

/** Solve S x = b for a symmetric positive-definite S (Cholesky); null when it is not. */
function cholSolve(S: number[][], bs: number[][]): number[][] | null {
  const d = S.length;
  const L = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = S[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(sum > 1e-12)) return null;
        L[i][i] = Math.sqrt(sum);
      } else L[i][j] = sum / L[j][j];
    }
  }
  return bs.map((b) => {
    const y = new Array<number>(d).fill(0);
    for (let i = 0; i < d; i++) {
      let s = b[i];
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    const x = new Array<number>(d).fill(0);
    for (let i = d - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < d; k++) s -= L[k][i] * x[k];
      x[i] = s / L[i][i];
    }
    return x;
  });
}

/** Eigenpairs of a small symmetric matrix by cyclic Jacobi, largest eigenvalue first. */
function jacobi(M: number[][], sweeps: number): { value: number; vector: number[] }[] {
  const n = M.length;
  const A = M.map((r) => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return A.map((_, i) => ({ value: A[i][i], vector: V.map((r) => r[i]) })).sort((a, b) => b.value - a.value);
}

/** The first `count` principal axes of centred rows, by power iteration with deflation. */
function principalAxes(rows: readonly number[][], d: number, count: number, steps: number): number[][] {
  const axes: number[][] = [];
  const work = rows.map((r) => [...r]);
  for (let a = 0; a < count; a++) {
    // A start no row is orthogonal to by construction: the largest row, then a fixed fallback.
    let v = work.reduce((best, r) => (dot(r, r) > dot(best, best) ? r : best), new Array<number>(d).fill(0));
    if (dot(v, v) < 1e-18) v = Array.from({ length: d }, (_, j) => (j === a ? 1 : 0));
    let norm = Math.sqrt(dot(v, v));
    v = v.map((x) => x / norm);
    for (let it = 0; it < steps; it++) {
      const next = new Array<number>(d).fill(0);
      for (const r of work) {
        const p = dot(r, v);
        for (let j = 0; j < d; j++) next[j] += p * r[j];
      }
      norm = Math.sqrt(dot(next, next));
      if (norm < 1e-18) break;
      v = next.map((x) => x / norm);
    }
    axes.push(v);
    for (const r of work) {
      const p = dot(r, v);
      for (let j = 0; j < d; j++) r[j] -= p * v[j];
    }
  }
  return axes;
}

/**
 * The map of `vectors`, `classes[i]` being the class index of vector i (or -1: drawn, but not
 * used to find the axes). Null when there is nothing to draw (fewer than two vectors, no
 * features). Never throws on degenerate input; falls back to principal axes.
 */
export function ldaProjection(
  vectors: readonly FeatureVector[],
  classes: readonly number[],
  features: readonly string[],
  weights: FeatureWeights,
  options: Partial<typeof LDA_DEFAULTS> = {},
): LdaMap | null {
  const o = { ...LDA_DEFAULTS, ...options };
  const d = features.length;
  const n = vectors.length;
  if (n < 2 || d === 0) return null;
  const w = features.map((f) => weights[f] ?? 1);
  const col = features.map((f) => {
    const xs = vectors.map((v) => v[f]).filter((x): x is number => Number.isFinite(x));
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  });
  const row = (v: FeatureVector): number[] => features.map((f, j) => w[j] * ((Number.isFinite(v[f]) ? v[f] : col[j]) - col[j]));
  const X = vectors.map(row);

  const labelled = X.map((_, i) => i).filter((i) => classes[i] >= 0);
  const ids = [...new Set(labelled.map((i) => classes[i]))].sort((a, b) => a - b);
  const mean = (idx: readonly number[]): number[] => {
    const m = new Array<number>(d).fill(0);
    for (const i of idx) for (let j = 0; j < d; j++) m[j] += X[i][j];
    return m.map((x) => x / Math.max(1, idx.length));
  };
  const centre = (axes: number[][], mu: number[]) => (x: readonly number[]): Point2 => {
    const c = x.map((v, j) => v - mu[j]);
    return [dot(c, axes[0]), axes[1] ? dot(c, axes[1]) : 0];
  };
  const finish = (axes: number[][], mu: number[], method: 'lda' | 'pca'): LdaMap => {
    const at = centre(axes, mu);
    return { points: X.map(at), project: (v) => at(row(v)), method };
  };
  const pca = (): LdaMap => {
    const mu = mean(X.map((_, i) => i));
    return finish(principalAxes(X.map((x) => x.map((v, j) => v - mu[j])), d, 2, o.powerSteps), mu, 'pca');
  };

  if (ids.length < 3 || labelled.length < ids.length + 1) return pca();

  const mu = mean(labelled);
  const groups = ids.map((id) => labelled.filter((i) => classes[i] === id));
  const means = groups.map(mean);
  const Sw = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  groups.forEach((g, c) => {
    for (const i of g) {
      const r = X[i].map((v, j) => v - means[c][j]);
      for (let a = 0; a < d; a++) for (let b = 0; b <= a; b++) Sw[a][b] += (r[a] * r[b]) / labelled.length;
    }
  });
  for (let a = 0; a < d; a++) for (let b = a + 1; b < d; b++) Sw[a][b] = Sw[b][a];
  const ridge = (o.ridge * Sw.reduce((s, r, i) => s + r[i], 0)) / d + 1e-9;
  for (let a = 0; a < d; a++) Sw[a][a] += ridge;
  // Rows of A: sqrt(share) x (class mean - overall mean). Then the generalised eigenproblem
  // Sb v = lambda Sw v lives in the span of A's rows: eigenvectors y of A Sw^-1 A^T, v = Sw^-1 A^T y.
  const A = groups.map((g, c) => means[c].map((m, j) => Math.sqrt(g.length / labelled.length) * (m - mu[j])));
  const SinvA = cholSolve(Sw, A);
  if (!SinvA) return pca();
  const B = A.map((a) => SinvA.map((s) => dot(a, s)));
  const eig = jacobi(B, o.jacobiSweeps).filter((e) => e.value > 1e-12).slice(0, 2);
  if (eig.length < 2) return pca();
  const axes = eig.map((e) => {
    const v = new Array<number>(d).fill(0);
    SinvA.forEach((s, c) => {
      for (let j = 0; j < d; j++) v[j] += e.vector[c] * s[j];
    });
    const norm = Math.sqrt(dot(v, v)) || 1;
    return v.map((x) => x / norm);
  });
  return finish(axes, mu, 'lda');
}
