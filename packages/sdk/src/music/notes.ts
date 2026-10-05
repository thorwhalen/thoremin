/**
 * Note names (#249): "D5", "F#4", "Bb3" to MIDI. The air flute's enrolled
 * fingerings are named by the note they play, as a flautist names them.
 *
 * Scientific pitch notation: C4 is middle C (MIDI 60). The other direction is
 * `midiToName` in `./theory`. Pure.
 */
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface NoteSpec {
  midi: number;
  /** The name as it should be shown: the letter, the accidental the player typed, the octave. */
  name: string;
}

/** Parse a note name (letter, optional `#` or `b`, octave -1..9). Null when it is not one. */
export function parseNoteName(raw: string): NoteSpec | null {
  const m = /^\s*([A-Ga-g])([#b]?)(-?\d)\s*$/.exec(raw);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  const midi = (octave + 1) * 12 + LETTER_PC[letter] + accidental;
  if (midi < 0 || midi > 127) return null;
  return { midi, name: `${letter}${m[2]}${octave}` };
}
