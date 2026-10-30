// @vitest-environment jsdom
/**
 * Skipping a balloon by touch (`play/src/field_page.ts`): only a deliberate tap (down and up on it,
 * quick and still) skips it, and a balloon over the wrapping edge is hit on either of its copies.
 */
import { describe, it, expect } from 'vitest';
import { onBalloonTap, targetAt } from '../../play/src/field_page';
import { fieldLayout } from '@thoremin/games/field_stage';
import type { FieldView } from '@thoremin/games/field';

const W = 800;
const H = 450;

function stage() {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H, x: 0, y: 0, toJSON: () => ({}) });
  return canvas;
}

const view = (x: number): FieldView => ({ game: 'pop', title: 't', phase: 'playing', now: 0, wrapX: true, backdrop: {}, cursor: null, trail: [], targets: [{ id: 3, x, y: 0.5, r: 0.08, progress: 0, state: 'live' }], score: { done: 0, total: 1, elapsed: 0 } });
const L = fieldLayout({ W, H });
const at = (x: number, y = 0.5) => ({ clientX: L.px({ x, y }).x, clientY: L.px({ x, y }).y });
const fire = (el: HTMLElement, type: string, p: { clientX: number; clientY: number }, timeStamp: number) => {
  const e = new MouseEvent(type, p);
  Object.defineProperty(e, 'timeStamp', { value: timeStamp });
  el.dispatchEvent(e);
};

describe('skipping by touch', () => {
  it('finds a balloon over the edge from its copy on the other side', () => {
    const c = stage();
    expect(targetAt(c, view(0.99), at(0.005))?.id).toBe(3);
    expect(targetAt(c, view(0.5), at(0.005))).toBeNull();
  });

  it('a quick still tap skips; a long press or a slide does not', () => {
    const c = stage();
    const taps: number[] = [];
    onBalloonTap(c, () => view(0.5), (t) => taps.push(t.id));
    fire(c, 'pointerdown', at(0.5), 0);
    fire(c, 'pointerup', at(0.5), 150);
    fire(c, 'pointerdown', at(0.5), 1000);
    fire(c, 'pointerup', at(0.5), 2000);
    fire(c, 'pointerdown', at(0.5), 3000);
    fire(c, 'pointerup', at(0.53), 3100);
    expect(taps).toEqual([3]);
  });
});
