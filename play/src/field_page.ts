/**
 * The pieces the field-game pages share (Pop the Notes, the Pitch Maze, the vowel games): the
 * picture before Start (the plane and its backdrop, empty) and the aspect of the plane on this
 * page's canvas, which a session's hit test needs.
 */
import type { Backdrop, FieldGame, FieldTarget, FieldView } from '@thoremin/games/field';
import { drawField, fieldLayout } from '@thoremin/games/field_stage';

/** Draw the view, or the empty plane with its backdrop and a line of what to do. */
export function drawFieldOrIdle(g: CanvasRenderingContext2D, W: number, H: number, view: FieldView | null, idle: { game: FieldGame; title: string; backdrop: Backdrop; hint: string; wrapX: boolean }): void {
  drawField(g, { W, H }, view ?? { ...idle, phase: 'playing', now: 0, cursor: null, trail: [], targets: [], score: { done: 0, total: 0, elapsed: 0 } });
}

/** Width over height of the plane on a canvas. */
export const planeAspect = (canvas: HTMLCanvasElement): number => fieldLayout({ W: canvas.clientWidth || 16, H: canvas.clientHeight || 9 }).aspect;

/** The live target under a pointer on the stage, if any (a tap that skips a balloon). */
export function targetAt(canvas: HTMLCanvasElement, view: FieldView | null, e: { clientX: number; clientY: number }): FieldTarget | null {
  if (!view) return null;
  const r = canvas.getBoundingClientRect();
  const L = fieldLayout({ W: r.width, H: r.height });
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  return view.targets.find((t) => t.state === 'live' && Math.hypot(L.px(t).x - x, L.px(t).y - y) <= L.len(t.r)) ?? null;
}

/** A "Skip" button beside Start: a balloon too hard today is put aside, and the next comes up. */
export function skipButton(after: HTMLElement, skip: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'secondary';
  b.textContent = 'Skip balloon';
  b.addEventListener('click', skip);
  after.after(b);
  return b;
}
