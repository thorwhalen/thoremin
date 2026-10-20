/**
 * The seven-chord map as a torus (#717): a display-only 3-D view for orientation and teaching.
 *
 * The seven diatonic chords are K7, the complete graph on seven vertices, and K7 draws on a torus
 * without a crossing (Heawood's map; the Szilassi polyhedron has one face per chord). Put chord d
 * (0-based degree) on the flat torus at (u, v) = (d / 7, 3d mod 7 / 7): every pair of chords then
 * differs by 1, 2 or 3 steps around the seven, so the 21 edges fall into three cycles, each a
 * straight line winding once round the torus: the seconds (step 1), the thirds (step 2) and the
 * fourths (step 3), the same three axes as the harmonic layout of the chord map.
 *
 * Pure: angles and points in, points out. No canvas, no DAG, no dial; {@link drawTorus} takes the
 * 2-D context it is handed. Wiring it as an overlay element is the harmony extension's, and the
 * rotation is the caller's (a fixed turn per second, or a hand).
 */

export const TORUS_DEGREES = 7;

/** The three cycles of K7 on the torus: the step between neighbours on each, and its name. */
export const TORUS_CYCLES = [
  { step: 1, name: 'seconds' },
  { step: 2, name: 'thirds' },
  { step: 3, name: 'fourths' },
] as const;
export type TorusCycle = (typeof TORUS_CYCLES)[number];

export interface Point3 { x: number; y: number; z: number }
export interface Rotation { yaw: number; pitch: number }

/** Where a chord sits on the flat torus, each coordinate in [0, 1). */
export function flatPosition(degree: number): { u: number; v: number } {
  const d = ((degree % TORUS_DEGREES) + TORUS_DEGREES) % TORUS_DEGREES;
  return { u: d / TORUS_DEGREES, v: ((3 * d) % TORUS_DEGREES) / TORUS_DEGREES };
}

export interface TorusShape {
  /** Distance from the torus's centre to the middle of its tube. */
  major: number;
  /** The tube's radius. */
  minor: number;
}
export const DEFAULT_TORUS: TorusShape = { major: 1, minor: 0.4 };

/** A point on the torus surface from its flat coordinates (any real; they wrap). */
export function torusPoint(u: number, v: number, shape: TorusShape = DEFAULT_TORUS): Point3 {
  const a = 2 * Math.PI * u;
  const b = 2 * Math.PI * v;
  const ring = shape.major + shape.minor * Math.cos(b);
  return { x: ring * Math.cos(a), y: ring * Math.sin(a), z: shape.minor * Math.sin(b) };
}

/** Turn a point about the vertical axis by `yaw`, then tilt it about the horizontal axis by `pitch`. */
export function rotate(p: Point3, { yaw, pitch }: Rotation): Point3 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = p.x * cy - p.y * sy;
  const y1 = p.x * sy + p.y * cy;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { x: x1, y: y1 * cp - p.z * sp, z: y1 * sp + p.z * cp };
}

export interface Projected { x: number; y: number; /** Nearer the viewer is larger. */ depth: number; scale: number }

/** Perspective projection of a rotated point: the viewer looks along -y from `distance` away. */
export function project(p: Point3, distance = 4): Projected {
  const scale = distance / (distance - p.y);
  return { x: p.x * scale, y: -p.z * scale, depth: p.y, scale };
}

export interface TorusNode extends Projected { degree: number }
export interface TorusLoop { step: number; name: string; points: Projected[] }
export interface TorusView {
  nodes: TorusNode[];
  /** One closed polyline per cycle, in the drawing order of {@link TORUS_CYCLES}. */
  loops: TorusLoop[];
}

export interface TorusViewOptions {
  rotation: Rotation;
  shape?: TorusShape;
  distance?: number;
  /** Samples per edge along a cycle's line (a straight line on the flat torus is a curve in 3-D). */
  samples?: number;
}

/** The loop of one cycle: seven edges from chord 0, each sampled along the straight flat line. */
export function loopPoints(step: number, shape: TorusShape, samples: number): Point3[] {
  const out: Point3[] = [];
  const du = step / TORUS_DEGREES;
  const dv = ((3 * step) % TORUS_DEGREES) / TORUS_DEGREES;
  const total = TORUS_DEGREES * samples;
  for (let i = 0; i <= total; i++) {
    const t = i / samples; // in edges
    out.push(torusPoint(t * du, t * dv, shape));
  }
  return out;
}

/** The whole view at one rotation: the seven chords and the three cycles, projected. */
export function torusView({ rotation, shape = DEFAULT_TORUS, distance = 4, samples = 12 }: TorusViewOptions): TorusView {
  const to2d = (p: Point3) => project(rotate(p, rotation), distance);
  const nodes = Array.from({ length: TORUS_DEGREES }, (_, degree) => {
    const { u, v } = flatPosition(degree);
    return { degree, ...to2d(torusPoint(u, v, shape)) };
  });
  const loops = TORUS_CYCLES.map(({ step, name }) => ({ step, name, points: loopPoints(step, shape, samples).map(to2d) }));
  return { nodes, loops };
}

export interface TorusStyle {
  /** One colour per degree (the chord map's `DEGREE_COLORS`). */
  colors: readonly string[];
  /** The cycle to light (a step 1, 2 or 3) or none. */
  lit?: number | null;
  /** The chord to mark as the current one. */
  current?: number | null;
}

/** Draw a view centred in a W x H box, scaled so the torus fills about 80 % of the shorter side. */
export function drawTorus(g: CanvasRenderingContext2D, W: number, H: number, view: TorusView, style: TorusStyle): void {
  const unit = (Math.min(W, H) * 0.4) / 1.8;
  const at = (p: Projected) => [W / 2 + p.x * unit, H / 2 + p.y * unit] as const;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const loop of view.loops) {
    const lit = style.lit === loop.step;
    g.globalAlpha = style.lit == null || lit ? 0.85 : 0.18;
    g.lineWidth = lit ? 3 : 1.5;
    g.strokeStyle = '#e5e7eb';
    g.beginPath();
    loop.points.forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))));
    g.stroke();
  }
  // Far nodes first, so a near one paints over them.
  for (const n of [...view.nodes].sort((a, b) => a.depth - b.depth)) {
    const [x, y] = at(n);
    g.globalAlpha = n.degree === style.current ? 1 : 0.55 + 0.45 * Math.max(0, Math.min(1, (n.depth + 1.4) / 2.8));
    g.fillStyle = style.colors[n.degree % style.colors.length] ?? '#fff';
    g.beginPath();
    g.arc(x, y, (n.degree === style.current ? 0.11 : 0.07) * unit * n.scale, 0, 2 * Math.PI);
    g.fill();
    g.strokeStyle = '#111827';
    g.lineWidth = 1;
    g.stroke();
  }
  g.restore();
}
