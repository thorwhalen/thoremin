/**
 * Pitch spelling: a MIDI number is a pitch, not a written note. Middle C's neighbour is C sharp or
 * D flat depending on the key, and a staff needs the letter. A key is the seam: its signature in
 * fifths (sharps positive, flats negative), C major (0) by default. A note of the key's scale takes
 * the key's letter; a note outside it is a sharpened letter in a sharp key (and C major), a
 * flattened one in a flat key.
 *
 * Within a bar an accidental holds for that letter in that octave until the bar ends, so a sign is
 * printed only where the written alteration changes, and a return to the signature's alteration
 * prints a natural (`barAccidentals`).
 *
 * Pure.
 */

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Letter = (typeof LETTERS)[number];

/** A written note: the letter, its alteration in semitones (-1 flat, 0, 1 sharp) and its octave. */
export interface Spelled {
  letter: Letter;
  alter: -1 | 0 | 1;
  octave: number;
}

/** A key by its signature: sharps (positive) or flats (negative), -7..7. */
export type KeyFifths = number;

const NATURAL_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Each letter's alteration under a key signature. */
export function signature(fifths: KeyFifths = 0): Record<Letter, -1 | 0 | 1> {
  const k = Math.max(-7, Math.min(7, Math.round(fifths)));
  const sig: Record<Letter, -1 | 0 | 1> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (k > 0) for (const l of SHARP_ORDER.slice(0, k)) sig[l] = 1;
  if (k < 0) for (const l of FLAT_ORDER.slice(0, -k)) sig[l] = -1;
  return sig;
}

/** A MIDI pitch written in a key. */
export function spell(midi: number, fifths: KeyFifths = 0): Spelled {
  const m = Math.round(midi);
  const pc = ((m % 12) + 12) % 12;
  const sig = signature(fifths);
  // In the key's scale: the letter whose signed pitch class it is.
  const inKey = LETTERS.find((l) => (((NATURAL_PC[l] + sig[l]) % 12) + 12) % 12 === pc);
  const pick = (letter: Letter, alter: -1 | 0 | 1): Spelled => ({ letter, alter, octave: Math.floor((m - alter - NATURAL_PC[letter]) / 12) - 1 });
  if (inKey) return pick(inKey, sig[inKey]);
  // Outside it: a raised letter below, or (a flat key) a lowered letter above; a natural first.
  const natural = LETTERS.find((l) => NATURAL_PC[l] === pc);
  if (natural) return pick(natural, 0);
  if (fifths < 0) return pick(LETTERS.find((l) => NATURAL_PC[l] === (pc + 1) % 12)!, -1);
  return pick(LETTERS.find((l) => NATURAL_PC[l] === (pc + 11) % 12)!, 1);
}

/** The diatonic step of a written note (C4 = 28): a staff position counts these. */
export const diatonicStep = (s: Spelled): number => s.octave * 7 + LETTERS.indexOf(s.letter);

/** The sign printed before a note: sharp, flat, natural, or nothing. */
export type Accidental = 'sharp' | 'flat' | 'natural' | null;

/**
 * The signs a run of written notes needs, bar by bar: a note's alteration against what its letter
 * and octave already read in its bar (the signature at the bar's start).
 */
export function barAccidentals(notes: readonly { spelled: Spelled; bar: number }[], fifths: KeyFifths = 0): Accidental[] {
  const sig = signature(fifths);
  let bar = Number.NaN;
  let reads = new Map<string, number>();
  return notes.map(({ spelled: s, bar: b }) => {
    if (b !== bar) {
      bar = b;
      reads = new Map();
    }
    const key = `${s.letter}${s.octave}`;
    const current = reads.get(key) ?? sig[s.letter];
    reads.set(key, s.alter);
    if (current === s.alter) return null;
    return s.alter === 1 ? 'sharp' : s.alter === -1 ? 'flat' : 'natural';
  });
}
