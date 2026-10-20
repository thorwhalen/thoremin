/**
 * The finger-to-thumb effect lines.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { EFFECT_SHORT } from '../../../mapping/hand_map';
import { FINGER_NAMES, kp, LM, type FingerName } from '@thoremin/sdk/nodes/domain';
import { LEFT_COLOR, type OverlayElement, RIGHT_COLOR, isDisplayedRight, mirrorX } from '../view';

/**
 * Finger→thumb effect lines (in-scene): for each ROUTED finger, a line from the
 * fingertip to the thumb tip, labelled with the normalized closeness value and a very
 * short effect name (brt/vib/pan/bnd/oct/gate). Shows exactly which distances drive
 * which sound aspect. Opt-in; nothing without a hand map that routes fingers.
 */
export const fingerLinesElement: OverlayElement = {
  name: 'fingerLines',
  category: 'output',
  draw(g, view) {
    const { W, H, inputs, params } = view;
    if (!params.fingerLines.show) return;
    const frame = inputs.hands;
    const feats = inputs.features;
    const routes = inputs.handMap?.fingers;
    if (!frame || !feats || !routes) return;
    const TIP: Record<FingerName, number> = {
      index: LM.index_tip,
      middle: LM.middle_tip,
      ring: LM.ring_tip,
      pinky: LM.pinky_tip,
    };
    g.save();
    g.font = 'bold 11px monospace';
    g.textAlign = 'center';
    for (const hand of frame.hands) {
      const right = isDisplayedRight(hand.handedness);
      const f = right ? feats.right : feats.left;
      if (!f.present) continue;
      const color = right ? RIGHT_COLOR : LEFT_COLOR;
      const thumb = kp(hand, LM.thumb_tip);
      if (!thumb) continue;
      const tx = mirrorX(thumb.x, frame.width, W);
      const ty = (thumb.y / frame.height) * H;
      for (const name of FINGER_NAMES) {
        const r = routes[name];
        if (!r || r.target === 'none') continue;
        const tip = kp(hand, TIP[name]);
        if (!tip) continue;
        const fx = mirrorX(tip.x, frame.width, W);
        const fy = (tip.y / frame.height) * H;
        const value = f.fingers[name];
        g.globalAlpha = 0.35 + 0.55 * value;
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(tx, ty);
        g.stroke();
        if (params.fingerLines.showLabels) {
          g.globalAlpha = 0.9;
          g.fillStyle = color;
          g.fillText(`${EFFECT_SHORT[r.target]} ${value.toFixed(2)}`, (fx + tx) / 2, (fy + ty) / 2 - 3);
        }
      }
    }
    g.restore();
  },
};
