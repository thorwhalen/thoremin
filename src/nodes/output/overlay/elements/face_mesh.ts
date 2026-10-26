/**
 * The face mesh.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { FACE_COLOR, type OverlayElement } from '../view';

export const faceMesh: OverlayElement = {
  name: 'faceLandmarks',
  category: 'input',
  draw(g, { display, inputs, params }) {
    if (!params.faceLandmarks.show) return;
    const face = inputs.faceFrame;
    if (!face?.present || !face.landmarks?.length) return;
    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = FACE_COLOR;
    const r = 1.1;
    g.beginPath();
    for (const lm of face.landmarks) {
      const { x: sx, y: sy } = display.unit(lm.x, lm.y);
      g.moveTo(sx + r, sy);
      g.arc(sx, sy, r, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  },
};
