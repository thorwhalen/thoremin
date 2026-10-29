/**
 * The stage of the field games (Pop the Notes, the Pitch Maze, the vowel games): draws a
 * `FieldView` on a 2D canvas. Behind, the backdrop the view names (the octave's columns, the vowel
 * trapezoid); then the walls, the balloons (shaking harder as their hold fills, bursting when
 * popped), the voice's dot and its trail; the title, the score and the results card on top. The
 * palette, the text and the results card are the timed games' stage's (`stage`).
 *
 * `fieldLayout` is pure: the box the plane fills on a canvas, and the aspect a session's hit test
 * needs so that a balloon round on screen is round to it.
 */
import type { CursorState, FieldTarget, FieldView, Point, WallView } from './field';
import { BG, DIM, GRID, TEXT, TRAIL, drawResultsCard, text } from './stage';

export interface FieldFrame {
  W: number;
  H: number;
  /** Fraction of the height above the plane (title, score). Default 0.14. */
  top?: number;
}

/** The plane's box on the canvas, and the conversions. */
export function fieldLayout(frame: FieldFrame) {
  const { W, H } = frame;
  const left = Math.max(12, 0.03 * W);
  const right = W - left;
  const top = (frame.top ?? 0.14) * H;
  const bottom = H - Math.max(28, 0.07 * H);
  const bw = right - left;
  const bh = bottom - top;
  return {
    left,
    right,
    top,
    bottom,
    /** Width over height: what a session's hit test is given. */
    aspect: bw / bh,
    px: (p: Point) => ({ x: left + p.x * bw, y: bottom - p.y * bh }),
    /** A length in units of the plane's height, in pixels. */
    len: (r: number) => r * bh,
    bw,
    bh,
  };
}

type Layout = ReturnType<typeof fieldLayout>;

const HUES = [199, 330, 45, 140, 270, 15, 175, 90];

function drawBackdrop(g: CanvasRenderingContext2D, v: FieldView, L: Layout) {
  const b = v.backdrop;
  if (b.columns) {
    const n = b.columns.length;
    b.columns.forEach((c, k) => {
      const x0 = L.left + (k / n) * L.bw;
      g.fillStyle = c.dark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.025)';
      g.fillRect(x0, L.top, L.bw / n, L.bh);
      g.fillStyle = GRID;
      g.fillRect(x0, L.top, 1, L.bh);
      text(g, c.label, x0 + L.bw / n / 2, L.bottom + 14, 13, c.dark ? DIM : TEXT, 'center');
    });
  }
  if (b.outline && b.outline.length > 1) {
    g.strokeStyle = 'rgba(229,231,235,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    b.outline.forEach((p, i) => {
      const q = L.px(p);
      if (i === 0) g.moveTo(q.x, q.y);
      else g.lineTo(q.x, q.y);
    });
    g.closePath();
    g.stroke();
  }
  for (const m of b.marks ?? []) {
    const q = L.px(m);
    text(g, m.label, q.x, q.y, Math.max(16, L.bh * 0.05), 'rgba(229,231,235,0.4)', 'center');
  }
  if (b.yLabel) {
    text(g, `↑ ${b.yLabel}`, L.left + 6, L.top + 12, 12, DIM);
  }
  if (b.xLabel) text(g, b.xLabel, L.right - 6, L.bottom - 12, 12, DIM, 'right');
}

/** The x positions to draw something at: itself, and its twin across the wrap when it overhangs an edge. */
function twins(x: number, overhang: number, wrapX: boolean): number[] {
  if (!wrapX) return [x];
  const out = [x];
  if (x - overhang < 0) out.push(x + 1);
  if (x + overhang > 1) out.push(x - 1);
  return out;
}

function drawWall(g: CanvasRenderingContext2D, w: WallView, L: Layout) {
  const y0 = L.px({ x: 0, y: w.y1 }).y;
  const y1 = L.px({ x: 0, y: w.y0 }).y;
  const a = w.gapX - w.gapW / 2;
  const b = w.gapX + w.gapW / 2;
  // The solid parts: [0,1] minus the opening, which may straddle the wrap.
  const solid: [number, number][] = a < 0 ? [[b, a + 1]] : b > 1 ? [[b - 1, a]] : [[0, a], [b, 1]];
  g.fillStyle = w.state === 'passed' ? 'rgba(100,116,139,0.35)' : w.state === 'inside' ? '#94a3b8' : '#64748b';
  for (const [s, e] of solid) if (e > s) g.fillRect(L.left + s * L.bw, y0, (e - s) * L.bw, y1 - y0);
  if (w.state !== 'passed') {
    const gx = L.left + w.gapX * L.bw;
    text(g, w.label, gx, y0 - 12, 15, '#f5d142', 'center');
  }
}

function drawTarget(g: CanvasRenderingContext2D, t: FieldTarget, v: FieldView, L: Layout) {
  const hue = HUES[t.id % HUES.length];
  const rpx = L.len(t.r);
  const center = L.px(t);
  if (t.state === 'popped') {
    const age = v.now - (t.poppedAt ?? v.now);
    const k = Math.min(1, age / 0.6);
    g.globalAlpha = 1 - k;
    g.fillStyle = `hsl(${hue} 90% 70%)`;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + t.id;
      const d = rpx * (0.6 + 2.2 * k);
      g.beginPath();
      g.arc(center.x + Math.cos(a) * d, center.y + Math.sin(a) * d, Math.max(2, rpx * 0.12 * (1 - k)), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    return;
  }
  // About to burst: it shakes harder and swells a little as the hold fills.
  const p = t.progress;
  const amp = p * p * rpx * 0.16;
  const jx = amp * Math.sin(v.now * 53 + t.id * 1.7);
  const jy = amp * Math.cos(v.now * 61 + t.id * 2.3);
  const r = rpx * (1 + 0.08 * p + 0.03 * p * Math.sin(v.now * 40));
  for (const tx of twins(t.x, t.r / L.aspect, v.wrapX)) {
    const c = L.px({ x: tx, y: t.y });
    const cx = c.x + jx;
    const cy = c.y + jy;
    const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    grad.addColorStop(0, `hsl(${hue} 95% ${80 + 10 * p}%)`);
    grad.addColorStop(0.55, `hsl(${hue} 80% ${52 + 15 * p}%)`);
    grad.addColorStop(1, `hsl(${hue} 70% 25%)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    if (p > 0) {
      g.strokeStyle = '#f5d142';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r + 5, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * p);
      g.stroke();
    }
    if (t.label) text(g, t.label, cx, cy, Math.max(14, r * 0.8), BG, 'center');
  }
}

function drawCursor(g: CanvasRenderingContext2D, c: CursorState, trail: readonly Point[], L: Layout, big: boolean, stuck: boolean) {
  g.strokeStyle = TRAIL;
  g.lineWidth = 3;
  g.globalAlpha = 0.5;
  g.beginPath();
  trail.forEach((p, i) => {
    const q = L.px(p);
    // A jump across the wrap is not a line across the screen.
    if (i === 0 || Math.abs(p.x - trail[i - 1].x) > 0.5) g.moveTo(q.x, q.y);
    else g.lineTo(q.x, q.y);
  });
  g.stroke();
  g.globalAlpha = c.live ? 1 : 0.35;
  const q = L.px(c);
  const r = big ? 13 : 9;
  g.fillStyle = 'rgba(34,211,238,0.25)';
  g.beginPath();
  g.arc(q.x, q.y, r * 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = stuck ? '#fca5a5' : '#e0f2fe';
  g.beginPath();
  g.arc(q.x, q.y, r, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/** Draw the whole field stage for one view. */
export function drawField(g: CanvasRenderingContext2D, frame: FieldFrame, v: FieldView): void {
  const { W, H } = frame;
  const L = fieldLayout(frame);
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  drawBackdrop(g, v, L);
  g.save();
  g.beginPath();
  g.rect(L.left, L.top, L.bw, L.bh);
  g.clip();
  for (const w of v.maze?.walls ?? []) drawWall(g, w, L);
  for (const t of v.targets) drawTarget(g, t, v, L);
  if (v.cursor) drawCursor(g, v.cursor, v.trail, L, !!v.maze, !!v.maze?.stuck);
  g.restore();

  const headY = L.top * 0.4;
  text(g, v.title, L.left, headY, Math.min(20, H * 0.04), TEXT);
  if (v.hint) text(g, v.hint, L.left, headY + Math.min(20, H * 0.04), 12, DIM);
  text(g, `${v.score.done} / ${v.score.total}   ${Math.floor(v.score.elapsed)} s`, L.right, headY, 15, DIM, 'right');
  if (v.phase === 'results' && v.results) {
    const headline = v.game === 'maze' ? `${Math.round(v.score.elapsed)} s` : `${v.score.done} / ${v.score.total}`;
    drawResultsCard(g, W, H, v.results, headline);
  }
  if (v.notice) text(g, v.notice, W / 2, H * 0.5, 16, '#fbbf24', 'center');
}
