/**
 * The chord guide: the sounding chord's notes on the pitch guide.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { scaleGuide } from '@thoremin/sdk/music/theory';
import { CHORD_COLOR, type OverlayElement } from '../view';

export const chordGuideElement: OverlayElement = {
  name: 'chordGuide',
  category: 'output',
  draw(g, { W, H, inputs, params }) {
    if (!params.chordGuide.show) return;
    const chord = inputs.chord;
    const scale = inputs.scale;
    if (!Array.isArray(chord) || chord.length === 0) return;
    if (!Array.isArray(scale) || scale.length <= 1) return;
    const pitchClass = (m: number) => (((m % 12) + 12) % 12);
    const chordPcs = new Set(chord.map(pitchClass));
    g.save();
    g.globalAlpha = 0.28;
    g.strokeStyle = CHORD_COLOR;
    g.lineWidth = 2;
    for (const { midi, x } of scaleGuide(scale)) {
      if (!chordPcs.has(pitchClass(midi))) continue;
      const sx = x * W;
      g.beginPath();
      g.moveTo(sx, H * 0.12);
      g.lineTo(sx, H * 0.86);
      g.stroke();
    }
    g.restore();
  },
};
