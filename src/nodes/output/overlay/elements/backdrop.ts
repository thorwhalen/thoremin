/**
 * The mirrored webcam frame every other element draws over.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { drawFrame } from '@thoremin/sdk/view/frame_view';
import type { OverlayElement } from '../view';

export const videoBackdrop: OverlayElement = {
  name: 'video',
  category: 'backdrop',
  draw(g, { display, video, held, params }) {
    if (!params.video.show) return;
    const image = held ?? (video && video.readyState >= 2 ? video : undefined);
    if (!image) return;
    g.save();
    g.globalAlpha = params.video.alpha;
    drawFrame(g, image, display);
    g.restore();
  },
};
