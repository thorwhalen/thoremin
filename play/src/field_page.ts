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
  // On a plane that wraps, a balloon over an edge is drawn on both sides: either copy is it.
  const dx = (t: FieldTarget) => {
    const d = L.px(t).x - x;
    return view.wrapX ? Math.min(Math.abs(d), Math.abs(d - L.bw), Math.abs(d + L.bw)) : d;
  };
  return view.targets.find((t) => t.state === 'live' && Math.hypot(dx(t), L.px(t).y - y) <= L.len(t.r)) ?? null;
}

/**
 * Call `onTap` with the balloon under a deliberate tap: down and up on the same balloon, quick and
 * still. A palm steadying the tablet or a brush of the screen skips nothing.
 */
export function onBalloonTap(canvas: HTMLCanvasElement, view: () => FieldView | null, onTap: (t: FieldTarget) => void, { maxMs = 400, maxMovePx = 12 } = {}): void {
  let down: { id: number; x: number; y: number; at: number; target: FieldTarget } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    const t = targetAt(canvas, view(), e);
    down = t ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp, target: t } : null;
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || e.timeStamp - d.at > maxMs || Math.hypot(e.clientX - d.x, e.clientY - d.y) > maxMovePx) return;
    if (targetAt(canvas, view(), e)?.id === d.target.id) onTap(d.target);
  });
  canvas.addEventListener('pointercancel', () => (down = null));
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
