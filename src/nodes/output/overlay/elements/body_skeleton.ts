/**
 * The full-body skeleton.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { BODY_BONES, BODY_LANDMARK_COUNT } from '@thoremin/sdk/nodes/domain';
import { BODY_COLOR, type OverlayElement } from '../view';
import { statusWorthAWord } from './source_status';

/**
 * The full-body skeleton (#186): bones + joints of the latest body frame, mirrored
 * like everything else in the scene. Nothing while the model is loading (or failed):
 * the state is said in the corner by the source-status element (`source_status.ts`,
 * #737), which a player cannot hide by turning the skeleton off.
 */
export const bodySkeleton: OverlayElement = {
  name: 'bodySkeleton',
  category: 'input',
  draw(g, { display, inputs, params }) {
    if (!params.bodySkeleton.show) return;
    const body = inputs.bodyFrame;
    if (statusWorthAWord(inputs.bodyStatus)) return;
    if (!body?.present || body.landmarks.length < BODY_LANDMARK_COUNT) return;
    const pt = (i: number) => display.px(body.landmarks[i].x, body.landmarks[i].y, body);
    const sx = (i: number) => pt(i).x;
    const sy = (i: number) => pt(i).y;
    const vis = (i: number) => (body.visibility[i] ?? 1) >= 0.5;
    g.save();
    g.strokeStyle = BODY_COLOR;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.globalAlpha = 0.7;
    g.beginPath();
    for (const [a, b] of BODY_BONES) {
      if (!vis(a) || !vis(b)) continue;
      g.moveTo(sx(a), sy(a));
      g.lineTo(sx(b), sy(b));
    }
    g.stroke();
    g.fillStyle = BODY_COLOR;
    g.globalAlpha = 0.9;
    g.beginPath();
    for (let i = 0; i < BODY_LANDMARK_COUNT; i++) {
      if (!vis(i)) continue;
      const x = sx(i);
      const y = sy(i);
      g.moveTo(x + 4, y);
      g.arc(x, y, 4, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  },
};
