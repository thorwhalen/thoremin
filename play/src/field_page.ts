/**
 * The pieces the field-game pages share (Pop the Notes, the Pitch Maze, the vowel games): the
 * picture before Start (the plane and its backdrop, empty) and the aspect of the plane on this
 * page's canvas, which a session's hit test needs.
 */
import type { Backdrop, FieldGame, FieldView } from '@thoremin/games/field';
import { drawField, fieldLayout } from '@thoremin/games/field_stage';

/** Draw the view, or the empty plane with its backdrop and a line of what to do. */
export function drawFieldOrIdle(g: CanvasRenderingContext2D, W: number, H: number, view: FieldView | null, idle: { game: FieldGame; title: string; backdrop: Backdrop; hint: string; wrapX: boolean }): void {
  drawField(g, { W, H }, view ?? { ...idle, phase: 'playing', now: 0, cursor: null, trail: [], targets: [], score: { done: 0, total: 0, elapsed: 0 } });
}

/** Width over height of the plane on a canvas. */
export const planeAspect = (canvas: HTMLCanvasElement): number => fieldLayout({ W: canvas.clientWidth || 16, H: canvas.clientHeight || 9 }).aspect;
