/**
 * Drawing a cell grid (`CellGrid`, `@thoremin/sdk/nodes/cell_grid`): the overlay's `cellGrid`
 * element, the chord map's targets. Its own module so the overlay node stays a list of
 * elements and grows by the element's wiring only. Pure canvas calls, the ones the recording
 * canvas of the overlay tests records (no `measureText`, no `closePath`).
 */
import { CellGridSchema, type CellGrid, type GridCell } from '@thoremin/sdk/nodes/cell_grid';

/** How strongly a cell is lit, per state: fill alpha, outline alpha, outline width (px). */
const CELL_LOOK: Record<GridCell['state'], { fill: number; stroke: number; width: number }> = {
  idle: { fill: 0.08, stroke: 0.45, width: 1.5 },
  candidate: { fill: 0.2, stroke: 0.8, width: 2.5 },
  active: { fill: 0.38, stroke: 1, width: 4 },
};
/** A cell's label is this fraction of its smaller side. */
const CELL_LABEL_SIZE = 0.3;
/** The radius of a pointer's ring, px. */
const CELL_POINTER_R = 9;
/** Approximate glyph width of the 11px captions (no measureText: the headless recording-canvas test). */
const CELL_CAPTION_CHAR_W = 6;

/** A valid grid, or null (a malformed one draws nothing rather than half a grid). */
export function cellGridOf(raw: unknown): CellGrid | null {
  if (!raw) return null;
  const parsed = CellGridSchema.safeParse(raw);
  return parsed.success && parsed.data.cells.length > 0 ? parsed.data : null;
}

/** One cell's outline: a pointy-top hexagon or a rectangle, in canvas pixels. */
function cellPath(g: CanvasRenderingContext2D, cell: GridCell, W: number, H: number): void {
  const cx = cell.x * W;
  const cy = cell.y * H;
  const hw = (cell.w * W) / 2;
  const hh = (cell.h * H) / 2;
  g.beginPath();
  if (cell.shape === 'rect') {
    g.rect(cx - hw, cy - hh, 2 * hw, 2 * hh);
    return;
  }
  g.moveTo(cx, cy - hh);
  g.lineTo(cx + hw, cy - hh / 2);
  g.lineTo(cx + hw, cy + hh / 2);
  g.lineTo(cx, cy + hh);
  g.lineTo(cx - hw, cy + hh / 2);
  g.lineTo(cx - hw, cy - hh / 2);
  g.lineTo(cx, cy - hh);
}

/**
 * A node's on-screen targets (the chord map, `CellGrid` in `@thoremin/sdk/nodes/cell_grid`):
 * each cell outlined in its colour and labelled, the one the hand is moving to brighter, the
 * one in force brightest; short captions on the grid (what a move does); a ring at each
 * pointing hand. Coordinates are fractions of the displayed, mirrored frame.
 */
export function drawCellGrid(g: CanvasRenderingContext2D, W: number, H: number, grid: CellGrid): void {
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const cell of grid.cells) {
    const look = CELL_LOOK[cell.state];
    cellPath(g, cell, W, H);
    g.globalAlpha = look.fill;
    g.fillStyle = cell.color;
    g.fill();
    g.globalAlpha = look.stroke;
    g.lineWidth = look.width;
    g.strokeStyle = cell.color;
    g.stroke();
    const size = Math.max(8, Math.round(Math.min(cell.w * W, cell.h * H) * CELL_LABEL_SIZE));
    g.globalAlpha = cell.state === 'idle' ? 0.8 : 1;
    g.fillStyle = cell.color;
    g.font = `bold ${size}px sans-serif`;
    g.fillText(cell.label, cell.x * W, cell.y * H - (cell.sub ? size * 0.25 : 0));
    if (cell.sub) {
      g.font = `${Math.round(size * 0.5)}px sans-serif`;
      g.fillText(cell.sub, cell.x * W, cell.y * H + size * 0.6);
    }
  }
  g.font = '11px sans-serif';
  for (const c of grid.captions) {
    if (!c.text) continue;
    const w = c.text.length * CELL_CAPTION_CHAR_W + 8;
    g.globalAlpha = 0.75;
    g.fillStyle = '#0f172a';
    g.fillRect(c.x * W - w / 2, c.y * H - 8, w, 16);
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillText(c.text, c.x * W, c.y * H);
  }
  g.globalAlpha = 0.9;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  for (const pt of grid.pointers) {
    g.beginPath();
    g.arc(pt.x * W, pt.y * H, CELL_POINTER_R, 0, Math.PI * 2);
    g.stroke();
  }
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.restore();
}
