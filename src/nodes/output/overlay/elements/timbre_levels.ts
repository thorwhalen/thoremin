/**
 * The face-timbre levels.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { clamp01 } from '@thoremin/sdk/features/math';
import type { SingleHandFeatures } from '@thoremin/sdk/nodes/domain';
import { CHORD_COLOR, LEFT_COLOR, type OverlayElement, RIGHT_COLOR } from '../view';

export const timbreLevels: OverlayElement = {
  name: 'timbreLevels',
  category: 'output',
  draw(g, { display, inputs, params }) {
    if (!params.timbreLevels.show) return;
    const sp = inputs.params;
    const feats = inputs.features;
    if (!sp || !feats) return;
    const drawLevels = (f: SingleHandFeatures, voiceId: number, color: string) => {
      if (!f.present) return;
      const v = sp.voices?.[voiceId];
      if (!v) return;
      const { x: sx, y: sy } = display.shown(f.x, f.y);
      const side = f.x > 0.5 ? -1 : 1;
      const bar = (offset: number, value: number, c: string) => {
        const bx = sx + side * (32 + offset);
        g.globalAlpha = 0.8;
        g.strokeStyle = c;
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(bx, sy + 18);
        g.lineTo(bx, sy + 18 - (3 + clamp01(value) * 32));
        g.stroke();
      };
      bar(0, v.brightness ?? 1, color);
      bar(9, v.vibrato ?? 0, CHORD_COLOR);
    };
    g.save();
    drawLevels(feats.right, 0, RIGHT_COLOR);
    drawLevels(feats.left, 1, LEFT_COLOR);
    g.restore();
  },
};

// ---- Bar-graph HUD cue helper: `@thoremin/sdk/overlay/bar_graph` (shared with extensions' cues).
