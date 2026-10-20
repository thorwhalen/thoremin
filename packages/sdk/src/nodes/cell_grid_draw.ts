/**
 * Drawing a cell grid (`CellGrid`, `./cell_grid`): an extension's own overlay element (#600 S5;
 * the chord map's and the chord wheel's) draws through it, so one
 * picture of a grid serves every layout. In the SDK because an extension may not import core. Pure canvas calls, the ones the recording
 * canvas of the overlay tests records (no `measureText`, no `closePath`).
 */
import { CellGridSchema, type CellGrid, type GridCell, type GridTrail } from './cell_grid';

/** How strongly a cell is lit, per state: fill alpha, outline alpha, outline width (px). */
const CELL_LOOK: Record<GridCell['state'], { fill: number; stroke: number; width: number }> = {
  idle: { fill: 0.08, stroke: 0.45, width: 1.5 },
  candidate: { fill: 0.2, stroke: 0.8, width: 2.5 },
  active: { fill: 0.38, stroke: 1, width: 4 },
};
/** A marked cell's second outline: inset by this fraction of its size (`home`), or outside it in
 *  white (`changed`). */
const MARK_INSET = 0.82;
const MARK_WIDTH = 2;

/** A cell's label is this fraction of its smaller side. */
const CELL_LABEL_SIZE = 0.3;
/** The radius of a pointer's ring, px. */
const CELL_POINTER_R = 9;
/** Approximate glyph width of the 11px captions (no measureText: the headless recording-canvas test). */
const CELL_CAPTION_CHAR_W = 6;

/** Height of one caption line, px. */
const CAPTION_LINE_H = 14;
/** A caption longer than this many characters wraps onto two lines at its comma (#805). */
const CAPTION_WRAP_AT = 16;

export interface CaptionBox { cx: number; cy: number; w: number; h: number; lines: string[] }

/** A caption's lines: one, or two split at the comma nearest its middle when it is long (#805:
 *  the computed captions run to four words and overlapped their neighbours on one line). */
export function captionLines(text: string): string[] {
  if (text.length <= CAPTION_WRAP_AT) return [text];
  const commas = [...text.matchAll(/, /g)].map((m) => m.index as number);
  if (commas.length === 0) return [text];
  const at = commas.reduce((best, i) => (Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2) ? i : best));
  return [text.slice(0, at + 1), text.slice(at + 2)];
}

const boxesOverlap = (a: CaptionBox, b: CaptionBox): boolean => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;

/**
 * Where each caption's box goes: wrapped to its lines, kept on the canvas, and moved vertically
 * (away from the box it hits, alternating sides) until it clears the ones placed before it, so a
 * caption never covers another. A box that finds no clear place within a few tries stays where it
 * last was rather than wandering off its move. Pure: pixel sizes in, boxes out.
 */
export function layoutCaptions(captions: readonly { x: number; y: number; text: string }[], W: number, H: number): CaptionBox[] {
  const placed: CaptionBox[] = [];
  for (const c of captions) {
    if (!c.text) continue;
    const lines = captionLines(c.text);
    const w = Math.max(...lines.map((l) => l.length)) * CELL_CAPTION_CHAR_W + 8;
    const h = lines.length * CAPTION_LINE_H + 2;
    const clampY = (y: number) => Math.min(Math.max(y, h / 2), H - h / 2);
    const box: CaptionBox = { cx: Math.min(Math.max(c.x * W, w / 2), W - w / 2), cy: clampY(c.y * H), w, h, lines };
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((p) => boxesOverlap(box, p));
      if (!hit) break;
      const down = tries % 2 === 0 ? box.cy >= hit.cy : box.cy < hit.cy;
      box.cy = clampY(down ? hit.cy + (hit.h + h) / 2 + 1 : hit.cy - (hit.h + h) / 2 - 1);
    }
    placed.push(box);
  }
  return placed;
}

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

/** A trail's look: its line's alpha, width and dash (px), and its numbered discs' radius. */
const TRAIL_ALPHA = 0.55;
const TRAIL_WIDTH = 3;
const TRAIL_DASH = [6, 6];
const TRAIL_DOT_R = 8;

/** A ghost trail: a dashed line from its start through its points, a numbered disc on each. */
function drawTrail(g: CanvasRenderingContext2D, W: number, H: number, trail: GridTrail): void {
  if (trail.points.length === 0) return;
  const pts = trail.from ? [trail.from, ...trail.points] : trail.points;
  g.globalAlpha = TRAIL_ALPHA;
  g.strokeStyle = trail.color;
  g.lineWidth = TRAIL_WIDTH;
  g.setLineDash(TRAIL_DASH);
  g.beginPath();
  g.moveTo(pts[0].x * W, pts[0].y * H);
  for (const p of pts.slice(1)) g.lineTo(p.x * W, p.y * H);
  g.stroke();
  g.setLineDash([]);
  g.font = 'bold 10px sans-serif';
  trail.points.forEach((p, i) => {
    g.globalAlpha = TRAIL_ALPHA + (1 - TRAIL_ALPHA) * (i === 0 ? 1 : 0);
    g.fillStyle = trail.color;
    g.beginPath();
    g.arc(p.x * W, p.y * H, TRAIL_DOT_R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0f172a';
    g.fillText(String(i + 1), p.x * W, p.y * H);
  });
  if (trail.label) {
    const p = trail.points[0];
    g.globalAlpha = 1;
    g.fillStyle = trail.color;
    g.font = '11px sans-serif';
    g.fillText(trail.label, p.x * W, p.y * H - TRAIL_DOT_R - 8);
  }
}

/**
 * A node's on-screen targets (the chord map, `CellGrid` in `@thoremin/sdk/nodes/cell_grid`):
 * each cell outlined in its colour and labelled, the one the hand is moving to brighter, the
 * one in force brightest; ghost trails (a path ahead); short captions on the grid (what a move
 * does); a ring at each pointing hand. Coordinates are fractions of the displayed, mirrored frame.
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
    if (cell.mark) {
      // Home: a ring inside the cell in its colour; changed: a white ring on its edge.
      cellPath(g, cell.mark === 'home' ? { ...cell, w: cell.w * MARK_INSET, h: cell.h * MARK_INSET } : cell, W, H);
      g.globalAlpha = 1;
      g.lineWidth = MARK_WIDTH;
      g.strokeStyle = cell.mark === 'home' ? cell.color : '#ffffff';
      g.stroke();
    }
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
  for (const trail of grid.trails ?? []) drawTrail(g, W, H, trail);
  g.font = '11px sans-serif';
  for (const box of layoutCaptions(grid.captions, W, H)) {
    g.globalAlpha = 0.75;
    g.fillStyle = '#0f172a';
    g.fillRect(box.cx - box.w / 2, box.cy - box.h / 2, box.w, box.h);
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    box.lines.forEach((line, i) => g.fillText(line, box.cx, box.cy - box.h / 2 + CAPTION_LINE_H * (i + 0.5) + 1));
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
