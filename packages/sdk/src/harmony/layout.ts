/**
 * Layouts: where each target of a harmonic space sits on the screen (H4 of #613,
 * `docs/design/harmonic-layers.md` §2.4). Geometry and assignment are separate:
 *
 * - geometry (`hexLattice`, `strip`, `radial`) makes cells in DISPLAY coordinates (fractions of
 *   the mirrored frame the player sees, the overlay's convention), each with lattice coordinates;
 *   lengths that must be equal across and down (a hexagon) are computed in frame heights and
 *   converted with the frame's aspect;
 * - assignment says what each cell is: a chord reached by walking two relations from a seed
 *   (`latticeChord`: the video's map is the diatonic fourth across and third down-right), a chord
 *   of a list (a strip in some order), or, on a radial layout, a MOVE from the current chord.
 *
 * Static layouts (a lattice, a strip) are pointed at; a dynamic one (the radial wheel, recentred on
 * the chord in force) is navigated by direction, never by absolute position: its targets move when
 * the chord changes (the design's pairing rule).
 *
 * Pure: the chord model and the space's relations only.
 */
import type { Chord, Key } from './chord';
import type { Relation } from './space';

/** A rectangle of the displayed frame, in fractions. */
export interface Region {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type CellShape = 'hex' | 'rect' | 'wedge';

/** One target's place: centre and size (display fractions), and its lattice coordinates (axial
 *  on a hex lattice; the column on a strip; the wedge index on a radial layout, -1 its centre). */
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: CellShape;
  q: number;
  r: number;
}

const SQRT3 = Math.sqrt(3);
/** A hex's height point to point, over its width across the flats. */
export const HEX_HEIGHT = 2 / SQRT3;
/** Rows of pointy-top hexagons are this fraction of a hex's height apart. */
export const HEX_ROW_STEP = 0.75;

/** The six hex neighbours as axial offsets, with their position relative to the cell in cell
 *  widths (x) and row steps (y): east, west, south-east, south-west, north-east, north-west. */
export const HEX_NEIGHBOURS = [
  { dq: 1, dr: 0, dx: 1, dy: 0 },
  { dq: -1, dr: 0, dx: -1, dy: 0 },
  { dq: 0, dr: 1, dx: 0.5, dy: 1 },
  { dq: -1, dr: 1, dx: -0.5, dy: 1 },
  { dq: 1, dr: -1, dx: 0.5, dy: -1 },
  { dq: 0, dr: -1, dx: -0.5, dy: -1 },
] as const;

/**
 * A pointy-top hex lattice filling a region: as many whole hexagons `cellSize` frame heights
 * wide as fit, centred, axial (0, 0) on the middle cell.
 */
export function hexLattice(region: Region, { aspect, cellSize }: { aspect: number; cellSize: number }): Cell[] {
  const regionW = (region.x1 - region.x0) * aspect;
  const regionH = region.y1 - region.y0;
  if (!(regionW > 0 && regionH > 0 && aspect > 0 && cellSize > 0)) return [];
  const w = cellSize;
  const h = w * HEX_HEIGHT;
  const step = h * HEX_ROW_STEP;
  const rows = Math.max(1, Math.floor((regionH - h) / step) + 1);
  const cols = Math.max(1, Math.floor((regionW - (rows > 1 ? w / 2 : 0)) / w));
  const blockW = cols * w + (rows > 1 ? w / 2 : 0);
  const blockH = h + (rows - 1) * step;
  const ox = region.x0 * aspect + (regionW - blockW) / 2;
  const oy = region.y0 + (regionH - blockH) / 2;
  const axial = (c: number, row: number) => c - (row - (row & 1)) / 2;
  const r0 = Math.floor((rows - 1) / 2);
  const q0 = axial(Math.floor((cols - 1) / 2), r0);
  const cells: Cell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let c = 0; c < cols; c++) {
      cells.push({
        x: (ox + w / 2 + c * w + (row & 1 ? w / 2 : 0)) / aspect,
        y: oy + h / 2 + row * step,
        w: w / aspect,
        h,
        shape: 'hex',
        q: axial(c, row) - q0,
        r: row - r0,
      });
    }
  }
  return cells;
}

/** `n` full-height strips across a region (a row of chord buttons): only the hand's width matters. */
export function strip(region: Region, n: number, aspect: number): Cell[] {
  const regionW = (region.x1 - region.x0) * aspect;
  const regionH = region.y1 - region.y0;
  if (!(regionW > 0 && regionH > 0 && aspect > 0) || n <= 0) return [];
  const w = regionW / n;
  return Array.from({ length: n }, (_, q) => ({
    x: (region.x0 * aspect + w * (q + 0.5)) / aspect,
    y: (region.y0 + region.y1) / 2,
    w: w / aspect,
    h: regionH,
    shape: 'rect' as const,
    q,
    r: 0,
  }));
}

/** The angle of wedge `k` of `n`, radians, clockwise from straight up: a direction always means
 *  the same wedge, whatever chord is in the centre. */
export const wedgeAngle = (k: number, n: number): number => (2 * Math.PI * k) / n;

/**
 * A radial layout: a centre cell (`q` = -1) and `n` wedge cells around it at fixed angles (`q` =
 * the wedge index), in a circle of `radius` frame heights centred in the region. A wedge cell's
 * centre sits two thirds of the way out.
 */
export function radial(region: Region, n: number, { aspect, radius }: { aspect: number; radius: number }): Cell[] {
  if (!(aspect > 0 && radius > 0) || n <= 0) return [];
  const cx = ((region.x0 + region.x1) / 2) * aspect;
  const cy = (region.y0 + region.y1) / 2;
  const inner = radius / 3;
  const cells: Cell[] = [{ x: cx / aspect, y: cy, w: (2 * inner) / aspect, h: 2 * inner, shape: 'hex', q: -1, r: 0 }];
  const size = Math.min(radius - inner, (2 * Math.PI * radius * 0.66) / n);
  for (let k = 0; k < n; k++) {
    const a = wedgeAngle(k, n);
    const d = inner + (radius - inner) * 0.6;
    cells.push({ x: (cx + d * Math.sin(a)) / aspect, y: cy - d * Math.cos(a), w: size / aspect, h: size, shape: 'wedge', q: k, r: 0 });
  }
  return cells;
}

// ---- Hit testing ---------------------------------------------------------------------------------

/** How far outside its nearest cell a point may be and still count as on it, in cell widths from
 *  the centre: a hexagon's corners are 0.577 out, a strip's sides 0.5, a wedge's 0.55. */
const REACH: Readonly<Record<CellShape, number>> = { hex: 0.6, rect: 0.55, wedge: 0.6 };

/** A point's distance from a cell's centre in that cell's widths (a strip: across only, and
 *  infinite above or below it). */
export function cellDistance(cell: Cell, p: { x: number; y: number }, aspect: number): number {
  const dx = (p.x - cell.x) / cell.w;
  if (cell.shape === 'rect') return Math.abs(p.y - cell.y) <= cell.h / 2 ? Math.abs(dx) : Infinity;
  const dy = (p.y - cell.y) / (cell.w * aspect);
  return Math.hypot(dx, dy);
}

/** The cell a point is over (the nearest centre, within reach), or null off the layout. */
export function cellAt(cells: readonly Cell[], p: { x: number; y: number }, aspect: number): { index: number; distance: number } | null {
  let best: { index: number; distance: number } | null = null;
  cells.forEach((cell, index) => {
    const distance = cellDistance(cell, p, aspect);
    if (!best || distance < best.distance) best = { index, distance };
  });
  const found = best as { index: number; distance: number } | null;
  return found && found.distance <= REACH[cells[found.index].shape] ? found : null;
}

// ---- Assignment ----------------------------------------------------------------------------------

/** Apply a relation `times` times (its inverse for a negative count); null where it does not apply. */
function walk(relations: ReadonlyMap<string, Relation>, id: string, times: number, from: Chord, key: Key): Chord | null {
  const r = relations.get(id);
  if (!r) return null;
  const step = times >= 0 ? r : relations.get(r.inverse ?? '');
  if (!step) return null;
  let c: Chord | null = from;
  for (let i = 0; i < Math.abs(times) && c; i++) c = step.apply(c, key)[0] ?? null;
  return c;
}

/**
 * The chord at axial (q, r) of a lattice whose east neighbour is one `east` move and whose
 * south-east neighbour is one `southEast` move, (0, 0) being `seed`: walk east q times, then
 * south-east r times (inverses for negative counts). Null where a move does not apply.
 */
export function latticeChord(
  relations: ReadonlyMap<string, Relation>,
  { east, southEast }: { east: string; southEast: string },
  seed: Chord,
  key: Key,
  q: number,
  r: number,
): Chord | null {
  const across = walk(relations, east, q, seed, key);
  return across ? walk(relations, southEast, r, across, key) : null;
}
