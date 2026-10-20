/**
 * The chord name cue (with its Roman numeral / function).
 *
 * Part of the `canvas-overlay` node (`../../canvas_overlay.ts` is its public face; split into these
 * files by #600 S19a, the drawing unchanged).
 */
import { classifyChord, freqToMidi, nashvilleNumber, romanNumeral, scaleDegreeOf } from '@thoremin/sdk/music/theory';
import { PAD } from '@thoremin/sdk/overlay/bar_graph';
import { CHORD_COLOR, type OverlayElement, type OverlayView } from '../view';

const NAME_PRIMARY_PX = 40;
const NAME_SECONDARY_PX = 20;
/** Monospace glyph advance ≈ this × font px (used to size the cue box headlessly). */
const NAME_CHAR_W = 0.62;

/** Pitch class of a MIDI note (0..11). */
export const pcOf = (m: number) => (((m % 12) + 12) % 12);

/** The actually-sounding MIDI notes (rounded), read from the synth voices — the
 *  "what is rendering right now" layer for the keyboard strip. */
export function voicedNotes(view: OverlayView): number[] {
  const voices = view.inputs.params?.voices;
  if (!voices) return [];
  return voices.filter((v) => v.present && v.freq > 0).map((v) => Math.round(freqToMidi(v.freq)));
}

/** The Roman/Nashville function line for the current chord within the current
 *  scale, or '' when off / unavailable / non-diatonic. */
function chordFunctionLabel(view: OverlayView): string {
  const p = view.params.chordName;
  if (!p.roman) return '';
  const chord = view.inputs.chord;
  // Analyze the chord's function against the CHORD-SOURCE scale (#75): the chord root
  // is a degree of the scale it was built from, which need not be the melody scale.
  const scale = view.inputs.chordScale ?? view.inputs.scale;
  if (!Array.isArray(chord) || !chord.length || !Array.isArray(scale) || scale.length < 2) return '';
  const info = classifyChord(chord);
  if (!info) return '';
  const degree = scaleDegreeOf(info.root, scale);
  if (degree < 0) return '';
  return p.nashville ? nashvilleNumber(degree, info.quality) : romanNumeral(degree, info.quality);
}

/** The chord-name cue's rendered text + box size, or null when nothing to show.
 *  Shared by `measure` (layout) and `draw`, so the two never disagree. */
function chordNameBox(view: OverlayView): { symbol: string; secondary: string; w: number; h: number } | null {
  const p = view.params.chordName;
  if (!p.show) return null;
  const chord = view.inputs.chord;
  if (!Array.isArray(chord) || chord.length === 0) return null;
  const info = classifyChord(chord);
  if (!info) return null;
  const secondary = chordFunctionLabel(view);
  const primaryW = info.symbol.length * NAME_PRIMARY_PX * NAME_CHAR_W;
  const secondaryW = secondary ? secondary.length * NAME_SECONDARY_PX * NAME_CHAR_W : 0;
  const w = Math.max(primaryW, secondaryW) + PAD * 2;
  const h = NAME_PRIMARY_PX + (secondary ? NAME_SECONDARY_PX + 4 : 0) + PAD * 2;
  return { symbol: info.symbol, secondary, w, h };
}

export const chordNameCue: OverlayElement = {
  name: 'chordName',
  category: 'output',
  cue: true,
  positionOf: (view) => view.params.chordName.position,
  measure(view) {
    const box = chordNameBox(view);
    return box ? { w: box.w, h: box.h } : null;
  },
  draw(g, view) {
    const origin = view.layout['chordName'];
    const box = chordNameBox(view);
    if (!origin || !box) return;
    g.save();
    // Dark backing plate so gold/white glyphs read over any (dimmed) video.
    g.globalAlpha = 0.4;
    g.fillStyle = '#000000';
    g.fillRect(origin.x, origin.y, box.w, box.h);
    const cx = origin.x + box.w / 2;
    g.textAlign = 'center';
    // Primary: the jazz chord symbol, large + gold.
    g.globalAlpha = 1;
    g.fillStyle = CHORD_COLOR;
    g.font = `bold ${NAME_PRIMARY_PX}px monospace`;
    g.fillText(box.symbol, cx, origin.y + PAD + NAME_PRIMARY_PX * 0.78);
    // Secondary: the function line (Roman / Nashville), smaller + dimmer.
    if (box.secondary) {
      g.globalAlpha = 0.8;
      g.fillStyle = '#ffffff';
      g.font = `${NAME_SECONDARY_PX}px monospace`;
      g.fillText(box.secondary, cx, origin.y + PAD + NAME_PRIMARY_PX + NAME_SECONDARY_PX * 0.9);
    }
    g.textAlign = 'left';
    g.restore();
  },
};
