/**
 * The camera models' status lines: "Body: ..." and "Hands: ..." in the top-left corner while a
 * model is not working (loading, moving thread, retrying, failed, no camera).
 *
 * Its own element (#737) rather than a line inside the skeleton or the landmark dots, for two
 * reasons. A failure is the player's only sign of why nothing is drawn, so it must not hide
 * behind a cosmetic toggle like "Hand landmarks" (a player who turned the dots off would see a
 * frozen instrument and no word). And two sources saying the same kind of thing should say it
 * through one piece of code that stacks them, so a third source is a line in a list, and the
 * rows close up when one source has nothing to say.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face).
 */
import type { LoadStatus } from '@thoremin/lazy';
import { BODY_COLOR, CUE_MARGIN, type OverlayElement, type OverlayView, RIGHT_COLOR } from '../view';

/** Where the first line sits (top-left, clear of the Lab panel and the trainer HUD that anchor
 *  to the bottom), and how far apart the lines are. */
const STATUS_ORIGIN = { x: CUE_MARGIN, y: CUE_MARGIN } as const;
const STATUS_ROW_HEIGHT = 16;
const STATUS_FONT = '12px system-ui, sans-serif';
const STATUS_ALPHA = 0.8;

/** Anything but off / ready / active is worth a word: loading, no camera, failed. Pure. */
export function statusWorthAWord(status: LoadStatus | undefined): status is LoadStatus {
  return !!status && status.phase !== 'off' && status.phase !== 'ready' && status.phase !== 'active';
}

/** A status that says something is broken, rather than on its way. Shown even with the element's
 *  toggle off: the toggle hides the passing notes, never the reason the instrument is silent. */
const isFailure = (status: LoadStatus): boolean => status.phase === 'error' || status.phase === 'unavailable';

/** One status line, `row` lines down from the corner. */
export function drawStatusLine(g: CanvasRenderingContext2D, text: string, colour: string, row: number): void {
  g.save();
  g.globalAlpha = STATUS_ALPHA;
  g.fillStyle = colour;
  g.font = STATUS_FONT;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(text, STATUS_ORIGIN.x, STATUS_ORIGIN.y + row * STATUS_ROW_HEIGHT);
  g.restore();
}

/** The sources that speak, top to bottom, with the colour each draws in elsewhere. */
const SOURCES: readonly { label: string; colour: string; status(view: OverlayView): LoadStatus | undefined }[] = [
  { label: 'Body', colour: BODY_COLOR, status: (v) => v.inputs.bodyStatus },
  { label: 'Hands', colour: RIGHT_COLOR, status: (v) => v.inputs.handsStatus },
];

export const sourceStatus: OverlayElement = {
  name: 'sourceStatus',
  category: 'input',
  draw(g, view) {
    const { show } = view.params.sourceStatus;
    let row = 0;
    for (const source of SOURCES) {
      const status = source.status(view);
      if (!statusWorthAWord(status) || (!show && !isFailure(status))) continue;
      drawStatusLine(g, `${source.label}: ${status.message}`, source.colour, row);
      row += 1;
    }
  },
};
