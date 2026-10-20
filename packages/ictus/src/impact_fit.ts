/**
 * The impact predictor's curve fits: a least-squares quadratic or line over recent
 * samples, where a fit crosses a level, where two fits meet, and the vertex of three
 * samples. Moved out of `impact.ts`, which re-exports what it exported.
 */
import { olsLine } from '@thoremin/stats';

export interface Quadratic {
  a: number;
  b: number;
  c: number;
  /** Root-mean-square residual of the fit. */
  rms: number;
}

/** Below this the normal equations' determinant is singular: the sample times have no
 *  spread to fit a curve over. */
const MIN_NORMAL_DET = 1e-18;

/**
 * Least-squares quadratic `d(τ) = a + b τ + c τ²`, `τ = t - t0` (the origin is the
 * caller's choice, for conditioning). Null for fewer than three points or a
 * singular system.
 */
export function fitQuadratic(ts: readonly number[], ds: readonly number[], t0: number): Quadratic | null {
  const n = ts.length;
  if (n < 3 || ds.length !== n) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < n; i++) {
    const x = ts[i] - t0;
    const x2 = x * x;
    const y = ds[i];
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    r0 += y;
    r1 += x * y;
    r2 += x2 * y;
  }
  const s0 = n;
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (!Number.isFinite(det) || Math.abs(det) < MIN_NORMAL_DET) return null;
  const a = (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det;
  const b = (s0 * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det;
  const c = (s0 * (s2 * r2 - r1 * s3) - s1 * (s1 * r2 - r1 * s2) + r0 * (s1 * s3 - s2 * s2)) / det;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const x = ts[i] - t0;
    const e = ds[i] - (a + b * x + c * x * x);
    ss += e * e;
  }
  return { a, b, c, rms: Math.sqrt(ss / n) };
}

/** Least-squares line `d(τ) = a + b τ` (as a degenerate {@link Quadratic}, c = 0): the
 *  centred fit of `@thoremin/stats`, null when the times have no spread (its normal
 *  determinant `n Σx² - (Σx)²` is `n` times the centred spread). */
export function fitLine(ts: readonly number[], ds: readonly number[], t0: number): Quadratic | null {
  const line = olsLine(ts, ds, { origin: t0 });
  if (!line || !(line.n * line.sxx >= MIN_NORMAL_DET)) return null;
  return { a: line.intercept, b: line.slope, c: 0, rms: Math.sqrt(line.rss / line.n) };
}

export const evalQ = (f: Quadratic, tau: number) => f.a + f.b * tau + f.c * tau * tau;

/**
 * When a quadratic (τ from its origin) reaches `level`, or turns before reaching it.
 * Looking AHEAD (`past` false, the prediction): the first root at or after τ = 0,
 * else the vertex if the trajectory is decelerating (it turns above the level;
 * `reaches` false). Looking AROUND (`past` true, the post-hoc refinement, where the
 * origin is the deepest SAMPLE and the true crossing may lie a little before it):
 * the root nearest τ = 0 on either side. `tau` is NaN when there is neither.
 */
export function crossingTau(fit: { a: number; b: number; c: number }, level: number, past = false): { tau: number; reaches: boolean } {
  const { a, b, c } = fit;
  const k = a - level;
  if (Math.abs(c) < 1e-12) {
    if (Math.abs(b) < 1e-12) return { tau: NaN, reaches: false };
    const tau = -k / b;
    if (past || (b > 0 && tau >= 0)) return { tau, reaches: true };
    return { tau: NaN, reaches: false };
  }
  // Looking ahead from at or below the level while still heading toward it: the
  // crossing was a moment ago — the backward root (never the exit root of a
  // decelerating trajectory, never "now" when it was earlier).
  if (!past && k >= 0 && b > 0) {
    const back = crossingTau(fit, level, true);
    return { tau: Number.isFinite(back.tau) ? Math.min(0, back.tau) : 0, reaches: true };
  }
  const disc = b * b - 4 * c * k;
  if (disc >= 0) {
    const sq = Math.sqrt(disc);
    const r1 = (-b - sq) / (2 * c);
    const r2 = (-b + sq) / (2 * c);
    if (past) return { tau: Math.abs(r1) <= Math.abs(r2) ? r1 : r2, reaches: true };
    const lo = Math.min(r1, r2);
    const hi = Math.max(r1, r2);
    if (lo >= -1e-9) return { tau: Math.max(0, lo), reaches: true };
    if (hi >= -1e-9) return { tau: Math.max(0, hi), reaches: true };
  }
  if (c < 0) {
    const tv = -b / (2 * c);
    if (past || tv >= 0) return { tau: tv, reaches: false };
  }
  return { tau: NaN, reaches: false };
}

/** The τ (both fits share an origin) where two quadratics meet, nearest `near`; NaN if none. */
export function intersectionTau(f: Quadratic, g: Quadratic, near: number): number {
  const A = f.c - g.c;
  const B = f.b - g.b;
  const C = f.a - g.a;
  if (Math.abs(A) < 1e-12) {
    if (Math.abs(B) < 1e-12) return NaN;
    return -C / B;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return NaN;
  const sq = Math.sqrt(disc);
  const r1 = (-B - sq) / (2 * A);
  const r2 = (-B + sq) / (2 * A);
  return Math.abs(r1 - near) <= Math.abs(r2 - near) ? r1 : r2;
}

/** The vertex of the exact parabola through three points (τ from t1), clamped to
 *  [t0, t2]; the middle point when the three are not a cap. */
export function vertexOf(t0: number, d0: number, t1: number, d1: number, t2: number, d2: number): { t: number; d: number } {
  const f = fitQuadratic([t0, t1, t2], [d0, d1, d2], t1);
  if (!f || !(f.c < 0)) return { t: t1, d: d1 };
  const tau = Math.max(t0 - t1, Math.min(t2 - t1, -f.b / (2 * f.c)));
  return { t: t1 + tau, d: evalQ(f, tau) };
}
