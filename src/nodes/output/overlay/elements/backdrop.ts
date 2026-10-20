/**
 * The mirrored webcam frame every other element draws over.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import type { OverlayElement } from '../view';

export const videoBackdrop: OverlayElement = {
  name: 'video',
  category: 'backdrop',
  draw(g, { W, H, video, params }) {
    if (!params.video.show) return;
    if (!video || video.readyState < 2) return;
    g.save();
    g.globalAlpha = params.video.alpha;
    g.scale(-1, 1);
    g.translate(-W, 0);
    g.drawImage(video, 0, 0, W, H);
    g.restore();
  },
};
