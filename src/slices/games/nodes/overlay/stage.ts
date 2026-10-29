/**
 * The listening games' stage as an overlay element this slice contributes. The drawing itself is
 * `@thoremin/games/stage` (pure, a canvas and a view model), shared with the standalone game
 * pages; this wrapper only reads the game node's `view` input.
 */
import type { OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import type { GameView } from '@thoremin/games/view';
import { drawStage } from '@thoremin/games/stage';

export { drawStage, layout, HEADER_Y, NOW_X } from '@thoremin/games/stage';

export const STAGE_ELEMENT = 'stage';

export const stageElement: OverlayElementImpl = {
  name: STAGE_ELEMENT,
  draw(g, frame, inputs) {
    const v = inputs.view as GameView | null | undefined;
    if (!v) return;
    g.save();
    drawStage(g, frame, v);
    g.restore();
  },
};
