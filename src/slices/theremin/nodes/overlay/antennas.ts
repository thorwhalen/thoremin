/**
 * The physical theremin's antennas on the video, an overlay element this slice contributes: the
 * vertical pitch rod on the player's right, the horizontal volume loop under the left hand, a
 * field line from each to the nearest part of its hand (brighter as the capacitance grows), and,
 * beside the rod's top, the note, its cents off and the hertz.
 *
 * Inputs: `config` (the `physicalTheremin` dial, delivered by the host: `enabled`, the antennas'
 * places, `antennasOnVideo.show`, `readout.show`) and `status` (the node's live status).
 */
import type { OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import { midiToName } from '@thoremin/sdk/music/theory';
import type { PhysicalThereminSettings } from '../../schema';
import type { PhysicalThereminStatus } from '../physical_theremin';

export const ANTENNAS_ELEMENT = 'antennas';

const ROD_COLOR = '#e5e7eb';
const FIELD_COLOR = '#a78bfa';

/** A note and its cents off, for the readout ("A4 +12c"). */
export function noteReadout(midi: number): string {
  const n = Math.round(midi);
  const cents = Math.round((midi - n) * 100);
  return `${midiToName(n)} ${cents >= 0 ? '+' : ''}${cents}c`;
}

/** How bright a field line is for a capacitance, pF: about a picofarad is a hand close by. */
const fieldAlpha = (pf: number): number => Math.min(0.9, 0.15 + 0.5 * pf);

export const antennasElement: OverlayElementImpl = {
  name: ANTENNAS_ELEMENT,
  draw(g, { display }, inputs) {
    const c = inputs.config as Partial<PhysicalThereminSettings> | undefined;
    if (!c?.enabled || !c.pitchAntenna || !c.volumeLoop) return;
    const st = inputs.status as PhysicalThereminStatus | undefined;
    const showAntennas = c.antennasOnVideo?.show !== false;
    const rodTop = display.shown(c.pitchAntenna.x, c.pitchAntenna.top);
    const rodBottom = display.shown(c.pitchAntenna.x, c.pitchAntenna.bottom);
    if (showAntennas) {
      const loopL = display.shown(c.volumeLoop.left, c.volumeLoop.y);
      const loopR = display.shown(c.volumeLoop.right, c.volumeLoop.y);
      g.globalAlpha = 0.85;
      g.strokeStyle = ROD_COLOR;
      g.lineCap = 'round';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(rodTop.x, rodTop.y);
      g.lineTo(rodBottom.x, rodBottom.y);
      g.stroke();
      // The loop: drawn as a flattened ring, as the real one is seen from the front.
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse((loopL.x + loopR.x) / 2, loopL.y, Math.abs(loopR.x - loopL.x) / 2, 6, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([4, 6]);
      g.lineWidth = 2;
      g.strokeStyle = FIELD_COLOR;
      if (st?.pitchPoint) {
        const p = display.shown(st.pitchPoint.x, st.pitchPoint.y);
        const ry = Math.min(Math.max(p.y, Math.min(rodTop.y, rodBottom.y)), Math.max(rodTop.y, rodBottom.y));
        g.globalAlpha = fieldAlpha(st.pitchPf);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(rodTop.x, ry);
        g.stroke();
      }
      if (st?.loopPoint) {
        const p = display.shown(st.loopPoint.x, st.loopPoint.y);
        const lx = Math.min(Math.max(p.x, Math.min(loopL.x, loopR.x)), Math.max(loopL.x, loopR.x));
        g.globalAlpha = fieldAlpha(st.loopPf);
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(lx, loopL.y);
        g.stroke();
      }
      g.setLineDash([]);
    }
    if (c.readout?.show !== false && st?.midi != null && st.hz != null) {
      g.globalAlpha = 0.9;
      g.fillStyle = '#ffffff';
      g.font = '14px monospace';
      g.textAlign = 'right';
      const x = rodTop.x - 10;
      g.fillText(noteReadout(st.midi), x, rodTop.y + 14);
      g.font = '11px monospace';
      g.fillText(`${st.hz.toFixed(1)} Hz  vol ${Math.round(st.volume * 100)}%`, x, rodTop.y + 30);
      if (st.vibrato > 0.5) g.fillText('vibrato', x, rodTop.y + 44);
      g.textAlign = 'left';
    }
    g.globalAlpha = 1;
  },
};
