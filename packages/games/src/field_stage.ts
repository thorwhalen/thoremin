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
import type { CursorState, FieldTarget, FieldView, Point, SegmentView } from './field';
import { BG, DIM, GRID, TEXT, TRAIL, drawResultsCard, text } from './paint';
import { ROAD_CAMERA, roadProjection } from './perspective';

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
    text(g, m.label, q.x, q.y, Math.max(12, Math.min(L.bw, L.bh) * 0.045), 'rgba(229,231,235,0.4)', 'center');
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

/** Where the ball line sits on the plane (the camera follows the ball), as the track session puts it. */
const BALL_Y = 0.25;
/** The road's camera: this far behind the ball (screen heights), the horizon this high on the plane. */
const ROAD = { camera: ROAD_CAMERA, horizon: 0.96 };

/**
 * A track point (x across, d ahead of the ball) on the canvas: from above, d is height on the
 * plane; on the road, things shrink toward a horizon as camera / (camera + d), full width at the
 * ball's line.
 */
function trackProjection(L: Layout, view: 'top' | 'road') {
  if (view === 'top') return (x: number, d: number) => L.px({ x, y: BALL_Y + d });
  const road = roadProjection(L.px({ x: 0.5, y: BALL_Y }), L.px({ x: 0.5, y: ROAD.horizon }).y, L.bw, ROAD.camera);
  return (x: number, d: number) => road(x - 0.5, d);
}

type Project = ReturnType<typeof trackProjection>;

function quad(g: CanvasRenderingContext2D, P: Project, x0: number, x1: number, d0: number, d1: number) {
  const a = P(x0, d0);
  const b = P(x1, d0);
  const c = P(x1, d1);
  const d = P(x0, d1);
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineTo(c.x, c.y);
  g.lineTo(d.x, d.y);
  g.closePath();
  g.fill();
}

/** The parts of [0, 1] inside (or, `outside`, outside) an interval that may straddle the wrap. */
function spans(gapX: number, gapW: number, outside: boolean): [number, number][] {
  const a = gapX - gapW / 2;
  const b = gapX + gapW / 2;
  if (!outside) return a < 0 ? [[0, b], [a + 1, 1]] : b > 1 ? [[a, 1], [0, b - 1]] : [[a, b]];
  return a < 0 ? [[b, a + 1]] : b > 1 ? [[b - 1, a]] : [[0, a], [b, 1]];
}

/** The road itself: a lane per pitch class converging on the horizon, the black keys' darker. */
function drawRoad(g: CanvasRenderingContext2D, v: FieldView, L: Layout, P: Project) {
  const cols = v.backdrop.columns ?? [];
  const far = 8;
  cols.forEach((c, k) => {
    g.fillStyle = c.dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.03)';
    quad(g, P, k / cols.length, (k + 1) / cols.length, -0.6, far);
    const label = P((k + 0.5) / cols.length, 0);
    text(g, c.label, label.x, L.bottom + 14, 13, c.dark ? DIM : TEXT, 'center');
  });
  g.strokeStyle = GRID;
  g.lineWidth = 1;
  for (let k = 0; k <= cols.length; k++) {
    const a = P(k / cols.length, -0.6);
    const b = P(k / cols.length, far);
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  // The ball's line: where the note under it counts.
  const a = P(0, 0);
  const b = P(1, 0);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(a.x, a.y - 1, b.x - a.x, 2);
}

function drawSegment(g: CanvasRenderingContext2D, s: SegmentView, P: Project, onBand: boolean | null | undefined) {
  if (s.kind === 'wall') {
    g.fillStyle = s.state === 'passed' ? 'rgba(100,116,139,0.35)' : s.state === 'inside' ? '#94a3b8' : '#64748b';
    for (const [x0, x1] of spans(s.gapX, s.gapW, true)) if (x1 > x0) quad(g, P, x0, x1, s.d0, s.d1);
    if (s.state !== 'passed') {
      const q = P(s.gapX, s.d1);
      text(g, s.label, q.x, q.y - 12, 15, '#f5d142', 'center');
    }
    return;
  }
  g.fillStyle =
    s.state === 'passed' ? 'rgba(148,163,184,0.25)' : s.state === 'inside' ? (onBand ? '#34d399' : '#f87171') : 'rgba(245,209,66,0.85)';
  for (const [x0, x1] of spans(s.gapX, s.gapW, false)) if (x1 > x0) quad(g, P, x0, x1, Math.max(s.d0, -0.6), s.d1);
  if (s.state === 'ahead' && s.d0 < 4) {
    const q = P(s.gapX, s.d0);
    text(g, s.label, q.x, q.y + 12, Math.max(10, 15 * (ROAD.camera / (ROAD.camera + Math.max(0, s.d0)))), TEXT, 'center');
  }
}

/** The points left on the band levels, as a bar under the score. */
function drawPoints(g: CanvasRenderingContext2D, points: number, L: Layout, y: number) {
  const w = Math.min(160, L.bw * 0.3);
  const full = Math.min(1, points / 20);
  g.fillStyle = GRID;
  g.fillRect(L.right - w, y, w, 8);
  g.fillStyle = points < 2 ? '#f87171' : '#34d399';
  g.fillRect(L.right - w, y, w * full, 8);
  text(g, `${Math.round(points)} points`, L.right - w - 8, y + 4, 12, DIM, 'right');
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
  const road = v.maze?.view === 'road';
  if (road) drawBackdrop(g, { ...v, backdrop: { ...v.backdrop, columns: undefined } }, L);
  else drawBackdrop(g, v, L);
  g.save();
  g.beginPath();
  g.rect(L.left, L.top, L.bw, L.bh);
  g.clip();
  if (v.maze) {
    const P = trackProjection(L, v.maze.view);
    if (road) drawRoad(g, v, L, P);
    // Far first, so a near segment covers a far one.
    for (const sgm of [...v.maze.segments].sort((a, b) => b.d0 - a.d0)) drawSegment(g, sgm, P, v.maze.onBand);
  }
  for (const t of v.targets) drawTarget(g, t, v, L);
  if (v.cursor) drawCursor(g, v.cursor, v.trail, L, !!v.maze, !!v.maze?.stuck);
  g.restore();

  const headY = L.top * 0.4;
  text(g, v.title, L.left, headY, Math.min(20, H * 0.04), TEXT);
  if (v.hint) text(g, v.hint, L.left, headY + Math.min(20, H * 0.04), 12, DIM);
  if (v.score.total > 0) text(g, `${v.score.done} / ${v.score.total}   ${Math.floor(v.score.elapsed)} s`, L.right, headY, 15, DIM, 'right');
  if (v.maze?.points !== undefined) drawPoints(g, v.maze.points, L, headY + 14);
  if (v.phase === 'results' && v.results) {
    const headline = v.maze?.lost
      ? 'Out of points'
      : v.maze?.points !== undefined
        ? `${Math.round(v.results.accuracy * 100)} % on the note`
        : v.game === 'maze'
          ? `${Math.round(v.score.elapsed)} s`
          : `${v.score.done} / ${v.score.total}`;
    drawResultsCard(g, W, H, v.results, headline);
  }
  if (v.notice) text(g, v.notice, W / 2, H * 0.5, 16, '#fbbf24', 'center');
}
