/**
 * The body's app half of the carve modality (#382 = #385 E9): "Your poses". A hold's picture is its
 * STICK FIGURE (#387 C7): drawn from the segment directions the carve measures (`poseSkeleton`),
 * kept in the categorizer file, rendered here as a small SVG. A whole-body camera still shows the
 * room and the person, so stills are opt-in, and when taken they are the whole frame (the region
 * is null): the stick figure already says where the limbs are.
 *
 * A pose categorizer is played through the category bindings (a command per category); the degree
 * renderer is #450, and the conductor's transport from a pose category is B4 (#384).
 */
import { bodyModality, POSE_FIGURE_LINES } from '@thoremin/sdk/features/modalities/body';
import type { Skeleton } from '@thoremin/sdk/enroll/modality';
import type { CarveModalityUi } from '@thoremin/sdk-ui/enroll/modality';

export const POSE_FIGURE_STYLE = {
  /** The picture's side, in pixels (the grid's cards scale it). */
  size: 96,
  /** Space around the figure, in torso lengths. */
  pad: 0.25,
  /** The smallest box the figure is fitted into, in torso lengths, so a figure with its limbs in
   *  keeps its proportions next to one with them out. */
  minSpan: 3.4,
  stroke: '#e2e8f0',
  background: '#0f172a',
  width: 0.09,
  /** The head's radius, in torso lengths. */
  head: 0.2,
} as const;

/** The figure as an SVG document (y up in the skeleton, down in SVG). */
export function poseFigureSvg(skeleton: Skeleton, style: typeof POSE_FIGURE_STYLE = POSE_FIGURE_STYLE): string {
  const pts = Object.values(skeleton);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(style.minSpan, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2 * style.pad;
  const f = (n: number) => Number(n.toFixed(3));
  const lines = POSE_FIGURE_LINES.map((names) => names.map((n) => skeleton[n]).filter((p): p is readonly [number, number] => p !== undefined))
    .filter((line) => line.length >= 2)
    .map((line) => `<polyline points="${line.map(([x, y]) => `${f(x)},${f(-y)}`).join(' ')}"/>`)
    .join('');
  const head = skeleton.head ? `<circle cx="${f(skeleton.head[0])}" cy="${f(-skeleton.head[1])}" r="${style.head}"/>` : '';
  const view = `${f(cx - span / 2)} ${f(-cy - span / 2)} ${f(span)} ${f(span)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${style.size}" height="${style.size}">` +
    `<rect x="${f(cx - span / 2)}" y="${f(-cy - span / 2)}" width="${f(span)}" height="${f(span)}" fill="${style.background}"/>` +
    `<g fill="none" stroke="${style.stroke}" stroke-width="${style.width}" stroke-linecap="round" stroke-linejoin="round">${lines}${head}</g></svg>`
  );
}

/** The figure as a data URL (no object URL to revoke; an `<img>` shows it like a still). */
export function poseFigureUrl(skeleton: Skeleton): string | null {
  // A figure with no drawable joint is no picture (the grid then has none for it).
  if (!Object.values(skeleton).some(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(poseFigureSvg(skeleton))}`;
}

export const bodyModalityUi: CarveModalityUi = {
  modality: bodyModality,
  // The whole frame: a still (when the player asks for one) shows the whole pose.
  region: () => null,
  figure: poseFigureUrl,
  stills: 'opt-in',
  targets: [{ kind: 'command', id: 'category-binding', label: 'a command per category (the Gestures tool)' }],
};
