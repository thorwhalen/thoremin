/**
 * The bar-graph HUD cue (a titled row of vertical bars with rotated labels): how the overlay draws
 * the expression bars, the finger bars, the category bars and an extension's own cue (the air
 * flute's breath cue, #600 S10), so one shared drawing gives them one look. Pure canvas drawing.
 */
import { clamp01 } from '../features/math';

/** The overlay's label colour (cyan) and the winner's highlight (warm gold). */
export const BAR_LABEL_COLOR = '#22d3ee';
export const BAR_HIGHLIGHT_COLOR = '#f5d142';


export interface BarSpec {
  value: number; // 0..1
  threshold?: number; // 0..1, drawn as a white tick
  color: string;
  highlight?: boolean; // winner → gold
  /** Bright (fired) vs dim; defaults to value-cleared-its-threshold. */
  fired?: boolean;
  /** Up-to-two vertical x-axis labels (drawn rotated), e.g. expression / chord. */
  labels?: string[];
}
export interface BarGraphOpts {
  title?: string; // optional top label
  barW?: number;
  gap?: number;
  maxH?: number;
  labelColor?: string;
}
export const BAR_W = 14;
export const BAR_GAP = 6;
export const BAR_MAXH = 34;
export const PAD = 8;
const LABEL_LINE_H = 44; // vertical label column height per label line

/** Box size of a bar graph (only the bar count + label lines matter for sizing). */
export function measureBarGraph(bars: { labels?: string[] }[], opts: BarGraphOpts): { w: number; h: number } {
  const barW = opts.barW ?? BAR_W;
  const gap = opts.gap ?? BAR_GAP;
  const maxH = opts.maxH ?? BAR_MAXH;
  const n = bars.length;
  const barsW = n * (barW + gap) - gap + PAD * 2;
  // A short title (bold 14px monospace ≈ 8.4px/char) can be wider than a 1-bar box;
  // take the max so horizontally-stacked (top/bottom) cues don't overlap.
  const titleW = opts.title ? opts.title.length * 8.4 + PAD * 2 : 0;
  const w = Math.max(barsW, titleW);
  const labelLines = Math.max(0, ...bars.map((b) => b.labels?.filter(Boolean).length ?? 0));
  const h = (opts.title ? 18 : 0) + maxH + 6 + labelLines * LABEL_LINE_H + PAD;
  return { w, h };
}

/** Draw a bar graph with its top-left at (x0, y0). */
export function drawBarGraph(g: CanvasRenderingContext2D, x0: number, y0: number, bars: BarSpec[], opts: BarGraphOpts): void {
  const barW = opts.barW ?? BAR_W;
  const gap = opts.gap ?? BAR_GAP;
  const maxH = opts.maxH ?? BAR_MAXH;
  const labelColor = opts.labelColor ?? BAR_LABEL_COLOR;
  g.save();
  let topY = y0 + PAD;
  if (opts.title) {
    g.globalAlpha = 1;
    g.fillStyle = labelColor;
    g.font = 'bold 14px monospace';
    g.textAlign = 'left';
    g.fillText(opts.title, x0 + PAD, topY + 12);
    topY += 18;
  }
  const baseY = topY + maxH;
  bars.forEach((b, i) => {
    const cx = x0 + PAD + i * (barW + gap) + barW / 2;
    const bright = b.fired ?? b.value >= (b.threshold ?? 0.001);
    g.globalAlpha = bright ? 0.9 : 0.4;
    g.strokeStyle = b.highlight ? BAR_HIGHLIGHT_COLOR : b.color;
    g.lineWidth = barW;
    g.beginPath();
    g.moveTo(cx, baseY);
    g.lineTo(cx, baseY - (2 + clamp01(b.value) * maxH));
    g.stroke();
    if (b.threshold !== undefined) {
      const ty = baseY - (2 + clamp01(b.threshold) * maxH);
      g.globalAlpha = 0.85;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx - barW / 2, ty);
      g.lineTo(cx + barW / 2, ty);
      g.stroke();
    }
    // Vertical x-axis labels (rotated 90°), one line per label.
    const labels = b.labels?.filter(Boolean) ?? [];
    labels.forEach((text, li) => {
      g.save();
      g.globalAlpha = b.highlight ? 1 : 0.75;
      g.fillStyle = b.highlight ? BAR_HIGHLIGHT_COLOR : labelColor;
      g.font = '10px monospace';
      g.textAlign = 'left';
      g.translate(cx + 3, baseY + 6 + li * LABEL_LINE_H);
      g.rotate(Math.PI / 2);
      g.fillText(text, 0, 0);
      g.restore();
    });
  });
  g.restore();
}

