/**
 * The per-hand control markers (and their note names).
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { freqToMidi, midiToName } from '@thoremin/sdk/music/theory';
import type { SingleHandFeatures } from '@thoremin/sdk/nodes/domain';
import { LEFT_COLOR, type OverlayElement, RIGHT_COLOR } from '../view';

export const controlMarkers: OverlayElement = {
  name: 'markers',
  category: 'output',
  draw(g, view) {
    const { display, inputs, params } = view;
    if (!params.markers.show) return;
    const feats = inputs.features;
    if (!feats) return;
    const sp = inputs.params;
    const wrist = inputs.handMap?.positionSource === 'wrist';
    const noteFor = (voiceId: number): string | null => {
      const v = sp?.voices?.[voiceId];
      if (!v || !v.present || v.freq <= 0) return null;
      return midiToName(freqToMidi(v.freq));
    };
    const drawMarker = (f: SingleHandFeatures, color: string, note: string | null) => {
      if (!f.present) return;
      // The marker sits at the ACTIVE note source (wrist or index fingertip).
      const { x: sx, y: sy } = display.shown(wrist ? f.wristX : f.x, wrist ? f.wristY : f.y);
      const ring = 14 + f.openness * 26;
      g.beginPath();
      g.arc(sx, sy, ring, 0, Math.PI * 2);
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 0.3 + 0.7 * f.pinch;
      g.fillStyle = color;
      g.beginPath();
      g.arc(sx, sy, 8, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      if (params.markers.showNotes && note) {
        g.fillStyle = color;
        g.font = 'bold 22px monospace';
        g.textAlign = 'center';
        g.fillText(note, sx, sy - ring - 10);
        g.textAlign = 'left';
      }
    };
    drawMarker(feats.right, RIGHT_COLOR, noteFor(0));
    drawMarker(feats.left, LEFT_COLOR, noteFor(1));
  },
};
