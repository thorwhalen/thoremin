/**
 * Guitar chords (#249): a chord NAME → the notes a guitarist would actually strum.
 *
 * The air guitar's vocabulary is the player's own (`docs/research/air-instruments.md`
 * §6.4: a chord is not a shape, so each player enrols the shapes THEY make), and they
 * name each one ("G", "Em", "C7"). The name is what decides the sound. Two steps:
 *
 * 1. {@link parseChordName}: root + quality from the usual shorthand.
 * 2. {@link guitarVoicing}: the notes on six strings in standard tuning, found the way an
 *    open chord is found on the instrument. On each string take the lowest chord tone
 *    within {@link MAX_FRET} frets of the open string. The bass is the lowest string
 *    whose note is the ROOT, and the strings below it are muted. That rule rebuilds the
 *    open chords a beginner learns: C is x32010, G is 320003, D is xx0232, Em is 022000,
 *    Am is x02210. For a chord with no root in reach on the four lowest strings (F: E
 *    string, first fret), it falls back to a higher reach, so every parseable name
 *    sounds.
 *
 * Pure: no audio, no DOM.
 */
import { NOTES } from './theory';

/** Standard tuning, low to high: E2 A2 D3 G3 B3 E4. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64] as const;
/** How far up the neck an open-chord voicing reaches on each string. */
export const MAX_FRET = 4;
/** The reach used when no string has the root within {@link MAX_FRET}. */
const FALLBACK_FRET = 7;

/** Chord qualities: the intervals above the root, by the suffix that names them. */
export const CHORD_QUALITIES = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '5': [0, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  add9: [0, 2, 4, 7],
} as const satisfies Record<string, readonly number[]>;
export type ChordQuality = keyof typeof CHORD_QUALITIES;

/** Other spellings a player may type, mapped to the canonical suffix. */
const QUALITY_ALIASES: Record<string, ChordQuality> = {
  M: '',
  maj: '',
  min: 'm',
  '-': 'm',
  M7: 'maj7',
  min7: 'm7',
  '-7': 'm7',
  sus: 'sus4',
  '+': 'aug',
  o: 'dim',
};

export interface ChordSpec {
  /** Root pitch class, 0 = C. */
  root: number;
  quality: ChordQuality;
  /** Intervals above the root. */
  intervals: readonly number[];
  /** The canonical name ("F#m7"). */
  name: string;
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Parse a chord name: a root letter (either case), an optional `#` or `b`, then a
 * quality suffix ("", "m", "7", "m7", "maj7", "sus2", "sus4", "5", "dim", "aug", "6",
 * "m6", "add9", or an alias such as "min" or "-"). Surrounding space is ignored.
 * Null when the name is not a chord.
 */
export function parseChordName(raw: string): ChordSpec | null {
  const m = /^\s*([A-Ga-g])([#b]?)(.*?)\s*$/.exec(raw);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const suffix = m[3];
  const quality: ChordQuality | undefined =
    suffix in CHORD_QUALITIES ? (suffix as ChordQuality) : QUALITY_ALIASES[suffix];
  if (quality === undefined) return null;
  const root = (((LETTER_PC[letter] + accidental) % 12) + 12) % 12;
  return { root, quality, intervals: CHORD_QUALITIES[quality], name: `${NOTES[root]}${quality}` };
}

/** One string of a voicing: its index (0 = low E) and the note, or null when muted. */
export type VoicedString = number | null;

function lowestToneOn(open: number, pcs: ReadonlySet<number>, maxFret: number): number | null {
  for (let fret = 0; fret <= maxFret; fret++) if (pcs.has((open + fret) % 12)) return open + fret;
  return null;
}

const PERFECT_FIFTH = 7;

/**
 * The notes of a chord on six strings (low to high; null = muted), by the open-chord
 * rule described at the top of this module, then completed: a chord tone the lowest-note
 * rule left out (a 7th, a 6th) takes over a string, from the top down, that doubles
 * another note or plays the fifth (the tone a guitarist drops first). That turns C into
 * C7 as x32310 and G into G7 as 320001, the shapes on the chart.
 */
export function guitarVoicing(chord: Pick<ChordSpec, 'root' | 'intervals'>, tuning: readonly number[] = STANDARD_TUNING): VoicedString[] {
  const pcs = new Set(chord.intervals.map((i) => (chord.root + i) % 12));
  const fifth = (chord.root + PERFECT_FIFTH) % 12;
  for (const reach of [MAX_FRET, FALLBACK_FRET]) {
    // The bass: the root, on the lowest of the four lowest strings that reaches it.
    const bass = tuning.findIndex((open, i) => i < 4 && lowestToneOn(open, new Set([chord.root]), reach) !== null);
    if (bass < 0) continue;
    const notes: VoicedString[] = tuning.map((open, i) =>
      i < bass ? null : i === bass ? lowestToneOn(open, new Set([chord.root]), reach) : lowestToneOn(open, pcs, reach),
    );
    for (const i of chord.intervals) {
      const pc = (chord.root + i) % 12;
      if (notes.some((n) => n !== null && n % 12 === pc)) continue;
      const count = (q: number) => notes.filter((n) => n !== null && n % 12 === q).length;
      for (let s = tuning.length - 1; s > bass; s--) {
        const n = notes[s];
        if (n === null || !(count(n % 12) > 1 || (n % 12 === fifth && pc !== fifth))) continue;
        const replacement = lowestToneOn(tuning[s], new Set([pc]), reach);
        if (replacement === null) continue;
        notes[s] = replacement;
        break;
      }
    }
    return notes;
  }
  // Unreachable for a 12-tone root within FALLBACK_FRET on the low strings; kept total:
  // every string sounds its lowest chord tone.
  return tuning.map((open) => lowestToneOn(open, pcs, 11));
}
