/**
 * The keyboard strip along the bottom edge.
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { NOTES } from '@thoremin/sdk/music/theory';
import { pcOf, voicedNotes } from './chord_name';
import { CHORD_COLOR, LEFT_COLOR, type OverlayElement } from '../view';

/** The natural (white-key) pitch classes; the rest are the black keys. */
const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);
const STRIP_MARGIN = 8;

/** One drawable key of the keyboard strip. */
interface StripKey {
  midi: number;
  x: number;
  w: number;
  h: number;
  isWhite: boolean;
}

/** Standard chromatic piano keys spanning the scale's MIDI range: equal-width
 *  whites first (full height), then the narrower/shorter blacks on top. The range
 *  is snapped OUT to natural keys (down at the bottom, up at the top) so a black
 *  key never leads the row — otherwise a sharp root (C#/D#/F#/G#/A#) would place
 *  the first black key at a negative x, off the left edge. */
function standardStripKeys(scale: number[], W: number, stripH: number): StripKey[] {
  let lo = scale[0];
  while (!NATURAL_PCS.has(pcOf(lo))) lo -= 1; // snap down to a white key
  let hi = scale[scale.length - 1];
  while (!NATURAL_PCS.has(pcOf(hi))) hi += 1; // snap up to a white key
  const whites: number[] = [];
  const blacks: { midi: number; afterWhite: number }[] = [];
  for (let m = lo; m <= hi; m++) {
    if (NATURAL_PCS.has(pcOf(m))) whites.push(m);
    else blacks.push({ midi: m, afterWhite: whites.length }); // boundary = whites drawn so far
  }
  if (!whites.length) return [];
  const whiteW = (W - 2 * STRIP_MARGIN) / whites.length;
  const blackW = whiteW * 0.62;
  const blackH = stripH * 0.6;
  const keys: StripKey[] = whites.map((midi, i) => ({
    midi,
    x: STRIP_MARGIN + i * whiteW,
    w: whiteW,
    h: stripH,
    isWhite: true,
  }));
  for (const b of blacks) {
    keys.push({ midi: b.midi, x: STRIP_MARGIN + b.afterWhite * whiteW - blackW / 2, w: blackW, h: blackH, isWhite: false });
  }
  return keys;
}

/** Scale-only keys: one equal-width cell per scale note (a decluttered ribbon). */
function scaleStripKeys(scale: number[], W: number, stripH: number): StripKey[] {
  const cellW = (W - 2 * STRIP_MARGIN) / scale.length;
  return scale.map((midi, i) => ({ midi, x: STRIP_MARGIN + i * cellW, w: cellW, h: stripH, isWhite: true }));
}

/**
 * The keyboard strip (#89): a thin bottom-edge piano/scale ribbon that shows what
 * is playing, with a shape+brightness cue hierarchy (never hue alone) so it reads
 * over the dimmed video and survives colour-blindness:
 *   chord ROOT (gold filled diamond) ▸ VOICED-now (bright gold base band) ▸
 *   CHORD-tone set (faint gold tint) ▸ SCALE root (hollow blue ring) ▸
 *   in-scale (light tint) ▸ out-of-scale (greyed).
 * Not a HUD cue — it owns a fixed bottom rectangle and draws in list order.
 */
export const keyboardStripElement: OverlayElement = {
  name: 'keyboardStrip',
  category: 'guide',
  draw(g, view) {
    const p = view.params.keyboardStrip;
    if (!p.show) return;
    const scale = view.inputs.scale;
    if (!Array.isArray(scale) || scale.length < 2) return;
    const { W, H } = view;
    const stripH = Math.round(H * p.height);
    const y0 = H - stripH;

    const scalePcs = new Set(scale.map(pcOf));
    const scaleRoot = pcOf(scale[0]); // generateScale starts on the root, so scale[0] IS the tonic
    const chord = Array.isArray(view.inputs.chord) ? view.inputs.chord : [];
    const chordPcs = new Set(chord.map(pcOf));
    const chordRootPc = chord.length ? pcOf(Math.min(...chord)) : -1;
    const voicedPcs = new Set(voicedNotes(view).map(pcOf)); // what's actually sounding now
    const keys = p.scaleMode ? scaleStripKeys(scale, W, stripH) : standardStripKeys(scale, W, stripH);

    g.save();
    // Dark backing plate: a stable substrate so keys read over any video frame.
    g.globalAlpha = 0.4;
    g.fillStyle = '#000000';
    g.fillRect(0, y0, W, stripH);

    for (const k of keys) {
      const pc = pcOf(k.midi);
      const inScale = scalePcs.has(pc);
      // Base fill: in-scale keys tinted, out-of-scale greyed; whites light, blacks dark.
      g.globalAlpha = k.isWhite ? (inScale ? 0.16 : 0.06) : inScale ? 0.4 : 0.55;
      g.fillStyle = k.isWhite ? '#ffffff' : '#000000';
      g.fillRect(k.x, y0, k.w, k.h);
      // Chord-tone set: the chord's footprint, recessive (matches chordGuide alpha).
      if (p.showChordTones && chordPcs.has(pc)) {
        g.globalAlpha = 0.28;
        g.fillStyle = CHORD_COLOR;
        g.fillRect(k.x, y0, k.w, k.h);
      }
      // Voiced-now: a bright gold band at the key base — the strongest cue.
      if (voicedPcs.has(pc)) {
        g.globalAlpha = 0.9;
        g.fillStyle = CHORD_COLOR;
        g.fillRect(k.x, y0 + k.h * 0.55, k.w, k.h * 0.45);
      }
      // Scale root: a hollow cool-blue ring (different shape + temperature than the
      // warm filled chord-root diamond, so the two roots never blur together).
      if (p.showScaleRoot && pc === scaleRoot) {
        g.globalAlpha = 0.9;
        g.strokeStyle = LEFT_COLOR;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(k.x + k.w / 2, y0 + k.h * 0.72, Math.min(k.w * 0.3, 6), 0, Math.PI * 2);
        g.stroke();
      }
      // Chord root: a filled gold diamond marker at the key top — highest salience.
      if (pc === chordRootPc) {
        g.globalAlpha = 1;
        g.fillStyle = CHORD_COLOR;
        const dx = k.x + k.w / 2;
        const dy = y0 + k.h * 0.26;
        const r = Math.min(k.w * 0.32, 7);
        g.beginPath();
        g.moveTo(dx, dy - r);
        g.lineTo(dx + r, dy);
        g.lineTo(dx, dy + r);
        g.lineTo(dx - r, dy);
        g.fill();
      }
      if (p.showLabels) {
        g.globalAlpha = 0.85;
        g.fillStyle = k.isWhite ? '#111111' : '#ffffff';
        g.font = '9px monospace';
        g.textAlign = 'center';
        g.fillText(NOTES[pc], k.x + k.w / 2, y0 + k.h - 3);
      }
    }
    g.textAlign = 'left';
    g.restore();
  },
};

// ---- Air drum pads (#245) ---------------------------------------------------
