/**
 * The per-scale-note pitch guide across the frame.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { midiToName, scaleGuide } from '@thoremin/sdk/music/theory';
import { LEFT_COLOR, type OverlayElement } from '../view';

const arrEq = (a?: number[], b?: number[]) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

export const scaleGuideElement: OverlayElement = {
  name: 'scaleGuide',
  category: 'guide',
  draw(g, { display, inputs, params }) {
    if (!params.scaleGuide.show) return;
    const scaleR = inputs.scale;
    if (!Array.isArray(scaleR) || scaleR.length <= 1) return;
    const shift = inputs.octaveShift;
    const drawGuide = (s: number[], color: string, alpha: number, labelY: number) => {
      g.save();
      g.font = '11px monospace';
      g.textAlign = 'center';
      for (const { midi, x } of scaleGuide(s)) {
        const sx = display.shown(x, 0).x;
        g.globalAlpha = alpha;
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(sx, display.shown(0, 0.12).y);
        g.lineTo(sx, display.shown(0, 0.86).y);
        g.stroke();
        if (params.scaleGuide.showLabels) {
          g.globalAlpha = Math.min(1, alpha * 4);
          g.fillStyle = color;
          g.fillText(midiToName(midi + shift * 12), sx, labelY);
        }
      }
      g.restore();
    };
    drawGuide(scaleR, '#ffffff', 0.1, display.shown(0, 0.82).y);
    const scaleL = inputs.scaleLeft;
    if (Array.isArray(scaleL) && scaleL.length > 1 && !arrEq(scaleL, scaleR)) {
      drawGuide(scaleL, LEFT_COLOR, 0.12, display.shown(0, 0.18).y);
    }
  },
};
