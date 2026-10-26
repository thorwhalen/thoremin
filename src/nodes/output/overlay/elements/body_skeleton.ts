/**
 * The full-body skeleton (and the body model's state while it loads).
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { BODY_BONES, BODY_LANDMARK_COUNT } from '@thoremin/sdk/nodes/domain';
import { BODY_COLOR, type OverlayElement } from '../view';

/**
 * The full-body skeleton (#186): bones + joints of the latest body frame, mirrored
 * like everything else in the scene. While the model is loading (or failed) it
 * prints the state in the corner instead — the player's only feedback that the
 * body toggle did something, since the status has no React chip of its own.
 */
export const bodySkeleton: OverlayElement = {
  name: 'bodySkeleton',
  category: 'input',
  draw(g, { display, inputs, params }) {
    if (!params.bodySkeleton.show) return;
    const status = inputs.bodyStatus;
    const body = inputs.bodyFrame;
    // Anything but off / ready / active is worth a word: loading, no camera, failed.
    // Top-left, clear of the Lab panel and the trainer HUD that anchor to the bottom.
    if (status && status.phase !== 'off' && status.phase !== 'ready' && status.phase !== 'active') {
      g.save();
      g.globalAlpha = 0.8;
      g.fillStyle = BODY_COLOR;
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(`Body: ${status.message}`, 12, 12);
      g.restore();
      return;
    }
    if (!body?.present || body.landmarks.length < BODY_LANDMARK_COUNT) return;
    const sx = (i: number) => display.px(body.landmarks[i].x, body.landmarks[i].y, body).x;
    const sy = (i: number) => display.px(body.landmarks[i].x, body.landmarks[i].y, body).y;
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
