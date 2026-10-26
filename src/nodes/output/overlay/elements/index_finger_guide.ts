/**
 * The index-finger guide line.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { kp, LM } from '@thoremin/sdk/nodes/domain';
import { LEFT_COLOR, type OverlayElement, RIGHT_COLOR, isDisplayedRight } from '../view';

export const indexFingerGuide: OverlayElement = {
  name: 'indexGuide',
  category: 'guide',
  draw(g, { H, display, inputs, params }) {
    if (!params.indexGuide.show) return;
    const frame = inputs.hands;
    if (!frame) return;
    for (const hand of frame.hands) {
      const tip = kp(hand, LM.index_tip);
      if (!tip) continue;
      const { x: sx, y: sy } = display.px(tip.x, tip.y, frame);
      const right = isDisplayedRight(hand.handedness);
      g.save();
      g.globalAlpha = 0.4;
      g.strokeStyle = right ? RIGHT_COLOR : LEFT_COLOR;
      g.lineWidth = 2;
      if (params.indexGuide.dashed) g.setLineDash([5, 5]);
      g.beginPath();
      g.moveTo(sx, sy);
      g.lineTo(sx, right ? 0 : H);
      g.stroke();
      g.restore();
    }
  },
};
