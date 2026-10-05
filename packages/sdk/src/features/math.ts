/**
 * Small, pure vector + scalar helpers shared by the feature catalog and the
 * online normalizer. Framework-agnostic and Node-safe (no DOM/audio), so the
 * whole feature pipeline unit-tests headlessly.
 *
 * The load-bearing helper here is {@link angleAt}: every mesh/finger angle in the
 * catalog is an `acos` of a dot product of normalized vectors, and normalized
 * dot products routinely exceed +/-1 by a float epsilon — `Math.acos(1.0000001)`
 * is `NaN`, which silently kills a meter. `angleAt` (and every acos path) clamps
 * the dot product to [-1, 1] first. See the #119 research appendix's "load-bearing
 * corrections".
 */

/** A minimal 3-D point. `z` is optional; treated as 0 when absent. */
export interface Vec3 {
  x: number;
  y: number;
  z?: number;
}

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp `v` into `[0, 1]`. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The z of a point, defaulting to 0 (image landmarks may omit it). */
export function z(a: Vec3): number {
  return a.z ?? 0;
}

/** 2-D Euclidean distance (x, y only). */
export function dist2(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 3-D Euclidean distance (includes z; meaningful on metric world landmarks). */
export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, z(a) - z(b));
}

/** Vector difference `a - b` (3-D). */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: z(a) - z(b) };
}

/** Component-wise mean of a non-empty list of points (3-D). Returns the origin
 *  for an empty list so callers never divide by zero. */
export function centroid(points: Vec3[]): Vec3 {
  if (!points.length) return { x: 0, y: 0, z: 0 };
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sz += z(p);
  }
  const n = points.length;
  return { x: sx / n, y: sy / n, z: sz / n };
}

/** Vector length (3-D). */
export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, z(a));
}

/**
 * Unit vector of `a` (3-D). Returns the zero vector for a (near-)zero-length
 * input so downstream `dot`s are 0 rather than NaN — the caller's feature then
 * reads a benign 0/`acos(0)` instead of poisoning a running statistic.
 */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: z(a) / len };
}

/** Dot product (3-D). */
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + z(a) * z(b);
}

/** Cross product (3-D). */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * z(b) - z(a) * b.y,
    y: z(a) * b.x - a.x * z(b),
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * The interior angle at vertex `b` of the path A-B-C, in radians (0..pi).
 * Computed as `acos(clamp(dot(unit(A-B), unit(C-B)), -1, 1))` — the clamp is
 * mandatory (a normalized dot product can be `1 + eps`, and `acos` of that is
 * `NaN`). Returns `NaN` only if a vertex is missing (caller present-gates).
 */
export function angleAt(a: Vec3 | undefined, b: Vec3 | undefined, c: Vec3 | undefined): number {
  if (!a || !b || !c) return NaN;
  const u = normalize(sub(a, b));
  const v = normalize(sub(c, b));
  return Math.acos(clamp(dot(u, v), -1, 1));
}

/**
 * The angle between two direction vectors, in radians (0..pi):
 * `acos(clamp(dot(unit(a), unit(b)), -1, 1))`. Same mandatory clamp as
 * {@link angleAt}. Used by the finger-spread features.
 */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));
}

/** Safe ratio `num / den`: returns `NaN` when the denominator is ~0 (a feature
 *  that divides by a degenerate scale must read "unavailable", never Infinity). */
export function safeDiv(num: number, den: number): number {
  return Math.abs(den) < 1e-9 ? NaN : num / den;
}
