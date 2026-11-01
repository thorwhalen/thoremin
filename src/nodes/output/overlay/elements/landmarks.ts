/**
 * The hand landmark dots.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { LM } from '@thoremin/sdk/nodes/domain';
import { LEFT_COLOR, type OverlayElement, type OverlayView, RIGHT_COLOR } from '../view';

/** Where the hand source's status line sits: top-left, one line under the body's (`body_skeleton.ts`). */
const STATUS_AT = { x: 12, y: 28 } as const;

/** The hand source's state in words while it is not working (loading, moving thread, failed):
 *  the player's only sign of why no hand is drawn (#737). */
function drawHandsStatus(g: CanvasRenderingContext2D, view: OverlayView): void {
  const status = view.inputs.handsStatus;
  if (!status || status.phase === 'off' || status.phase === 'ready' || status.phase === 'active') return;
  g.save();
  g.globalAlpha = 0.8;
  g.fillStyle = RIGHT_COLOR;
  g.font = '12px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(`Hands: ${status.message}`, STATUS_AT.x, STATUS_AT.y);
  g.restore();
}

/** The landmark used as the "note source" ring, per the hand map. */
const sourceLm = (view: OverlayView): number =>
  view.inputs.handMap?.positionSource === 'wrist' ? LM.wrist : LM.index_tip;

export const landmarkDots: OverlayElement = {
  name: 'landmarks',
  category: 'input',
  draw(g, view) {
    const { display, inputs, params } = view;
    if (!params.landmarks.show) return;
    drawHandsStatus(g, view);
    const frame = inputs.hands;
    if (!frame) return;
    const srcLm = sourceLm(view);
    for (const hand of frame.hands) {
      const color = hand.handedness === 'Left' ? RIGHT_COLOR : LEFT_COLOR; // mirrored
      g.fillStyle = color;
      for (const k of hand.keypoints) {
        const { x: sx, y: sy } = display.px(k.x, k.y, frame);
        g.beginPath();
        g.arc(sx, sy, 3, 0, Math.PI * 2);
        g.fill();
      }
      // Ring the ACTIVE note source (wrist or index), matching what plays the note.
      const src = hand.keypoints[srcLm];
      if (src) {
        const { x: sx, y: sy } = display.px(src.x, src.y, frame);
        g.beginPath();
        g.arc(sx, sy, 10, 0, Math.PI * 2);
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.stroke();
      }
    }
  },
};
