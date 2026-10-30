/**
 * What every games stage paints with: the palette, a line of text and the results card. Apart from
 * the timed games' stage (`stage`) so that the field and echo stages, and their pages, carry none
 * of its note views.
 */
import type { Results } from './view';

export const BG = '#0b1020';
export const GRID = 'rgba(255,255,255,0.08)';
export const TEXT = '#e5e7eb';
export const DIM = 'rgba(229,231,235,0.55)';
export const TRAIL = '#22d3ee';

export function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = TEXT, align: CanvasTextAlign = 'left') {
  g.fillStyle = color;
  g.font = `600 ${Math.round(size)}px system-ui, sans-serif`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** The results card: a headline, the game's one line, its counts and, for a timed game, the timing. */
export function drawResultsCard(g: CanvasRenderingContext2D, W: number, H: number, r: Results, headline: string): void {
  g.globalAlpha = 0.85;
  g.fillStyle = BG;
  g.fillRect(W * 0.15, H * 0.25, W * 0.7, H * 0.5);
  g.globalAlpha = 1;
  text(g, headline, W / 2, H * 0.36, Math.min(48, H * 0.09), TEXT, 'center');
  text(g, r.summary, W / 2, H * 0.47, 15, TEXT, 'center');
  const counts = Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join('   ');
  text(g, counts, W / 2, H * 0.55, 13, DIM, 'center');
  if (r.timing) text(g, `${r.timing.verdict}: ${r.timing.meanMs > 0 ? '+' : ''}${r.timing.meanMs} ms on average, spread ${r.timing.sdMs} ms`, W / 2, H * 0.62, 13, DIM, 'center');
}
