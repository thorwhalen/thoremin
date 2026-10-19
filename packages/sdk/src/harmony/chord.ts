/**
 * The chord model of the harmonic layers (`docs/design/harmonic-layers.md` §2.1, step H1 of
 * #613): what a chord IS before it has any notes, what key it is heard in, and what function it
 * has there. Every other harmonic part (a space of relations, a layout, a navigator, a
 * realization pipeline) talks in these terms.
 *
 * - A {@link Chord} is a root pitch class, a quality (a row of `./qualities`) and, for a slash
 *   chord, a bass. No register, no notes: that is realization's business.
 * - A {@link Key} is a tonic and a scale. A five- or six-note scale is read through its
 *   seven-note parent (`defaultChordSpecFor`), as everywhere in thoremin.
 * - A {@link ChordFunction} is what a Roman numeral says: a degree, an alteration (bVII), an
 *   applied target (V/V), and the Riemann function where it is unambiguous.
 *
 * Pure: the quality table and `music/theory`'s scale helpers, nothing else.
 */
import { z } from 'zod';
import {
  NOTES,
  NOTE_LETTERS,
  SCALE_TYPES,
  defaultChordSpecFor,
  diatonicChord,
  keyName,
  romanNumeral,
  spellOnLetter,
  type ChordQuality,
  type NoteLetter,
  type ScaleTypeId,
} from '../music/theory';
import { QUALITIES, QUALITY_IDS, qualityOfIntervals, type QualityId, type ToneRole } from './qualities';

export type PitchClass = number;

const pc = (n: number): PitchClass => ((Math.round(n) % 12) + 12) % 12;

export const ChordSchema = z.object({
  root: z.number().int().min(0).max(11),
  quality: z.enum(QUALITY_IDS),
  /** The bass pitch class when it is not the root (a slash chord); absent = the root. */
  bass: z.number().int().min(0).max(11).optional(),
});
export type Chord = z.infer<typeof ChordSchema>;

const SCALE_IDS = Object.keys(SCALE_TYPES) as [ScaleTypeId, ...ScaleTypeId[]];
export const KeySchema = z.object({ tonic: z.number().int().min(0).max(11), scale: z.enum(SCALE_IDS) });
export type Key = z.infer<typeof KeySchema>;

/** The key a scale spec (`{ root, type }`, the dials' shape) stands for. */
export function keyOf(spec: { root: number; type: ScaleTypeId }): Key {
  return { tonic: pc(spec.root), scale: spec.type };
}

/** The seven-note key a key is heard through (its own, or its parent's). */
export function parentKey(key: Key): Key {
  const p = defaultChordSpecFor({ root: key.tonic, type: key.scale });
  return { tonic: pc(p.root), scale: p.type };
}

// ---- Tones ---------------------------------------------------------------------------------

/** The chord's pitch classes, root first, in the quality's interval order. */
export function pitchClasses(c: Chord): PitchClass[] {
  return QUALITIES[c.quality].intervals.map((i) => pc(c.root + i));
}

/** The chord's tones with their roles ('1', 'b3', 'b7', ...): what reduction and coloration read. */
export function tonesOf(c: Chord): { pc: PitchClass; role: ToneRole }[] {
  const q = QUALITIES[c.quality];
  return q.intervals.map((i, k) => ({ pc: pc(c.root + i), role: q.roles[k] }));
}

/** The chord a set of MIDI notes spells, its lowest note the root (the overlay's rule), or null
 *  for no notes or a shape the quality table does not detect. A lowest note that is not the
 *  detected root is not searched for: a first-inversion triad classifies by its bass, as before. */
export function classify(midis: readonly number[]): Chord | null {
  if (midis.length === 0) return null;
  const low = Math.min(...midis);
  const quality = qualityOfIntervals(midis.map((m) => m - low));
  return quality ? { root: pc(low), quality } : null;
}

// ---- Names ---------------------------------------------------------------------------------

const LETTER_PC: Record<NoteLetter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The letter a key spells its degree `d` with (the tonic's letter plus d). */
function letterOf(key: Key, degree: number): NoteLetter {
  const tonicLetter = keyName({ root: key.tonic, type: key.scale })[0] as NoteLetter;
  return NOTE_LETTERS[(NOTE_LETTERS.indexOf(tonicLetter) + degree) % 7];
}

/** A root spelled: on the key's letter for its degree when it has one in the key (Bb in F, F# in
 *  G), with the alteration's letter for an altered degree (bVII in C is Bb), else sharps. */
function rootName(root: PitchClass, key?: Key): string {
  if (!key) return NOTES[root];
  const p = parentKey(key);
  const d = degreeOfRoot(root, key);
  if (d >= 0) return spellOnLetter(root, letterOf(p, d));
  // An altered degree is spelled on the letter it alters, flat first (bII bIII bV bVI bVII).
  for (const alter of [-1, 1] as const) {
    const k = degreeOfRoot(pc(root - alter), key);
    if (k >= 0) return spellOnLetter(root, letterOf(p, k));
  }
  return NOTES[root];
}

/** How a chord is shown: "Am", "B°", "Bb", "F#m7", "C/E", spelled in `key` when given. */
export function chordName(c: Chord, key?: Key): string {
  const bass = c.bass !== undefined && c.bass !== c.root ? `/${rootName(c.bass, key)}` : '';
  return rootName(c.root, key) + QUALITIES[c.quality].short + bass;
}

/** The lead-sheet symbol a parser reads back: "Am", "Bdim", "Bm7b5", "Bb", "C/E". */
export function chordSymbol(c: Chord, key?: Key): string {
  const bass = c.bass !== undefined && c.bass !== c.root ? `/${rootName(c.bass, key)}` : '';
  return rootName(c.root, key) + QUALITIES[c.quality].symbol + bass;
}

/** A stable string id, Harte-style: "C:maj", "A#:min7", "G:7/B" (sharps, never spelled). */
export function chordId(c: Chord): string {
  const bass = c.bass !== undefined && c.bass !== c.root ? `/${NOTES[c.bass]}` : '';
  return `${NOTES[c.root]}:${c.quality}${bass}`;
}

const NOTE_RE = /^([A-Ga-g])([#b]?)$/;
function parseNote(s: string): PitchClass | null {
  const m = NOTE_RE.exec(s.trim());
  if (!m) return null;
  return pc(LETTER_PC[m[1].toUpperCase() as NoteLetter] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
}

/** The chord an id names ({@link chordId}; flats accepted), or null. */
export function parseChordId(id: string): Chord | null {
  const m = /^([^:]+):([^/]+)(?:\/(.+))?$/.exec(id.trim());
  if (!m) return null;
  const root = parseNote(m[1]);
  if (root === null || !(m[2] in QUALITIES)) return null;
  const quality = m[2] as QualityId;
  if (m[3] === undefined) return { root, quality };
  const bass = parseNote(m[3]);
  return bass === null ? null : { root, quality, bass };
}

// ---- A key's chords and functions ----------------------------------------------------------

/** The register the key's chords are built in when asked for notes (theory's spec shape). */
const REGISTER = { octaves: 2, baseOctave: 3 } as const;

/** The key's seven diatonic chords, by degree: triads (`size` 3) or sevenths (4). */
export function diatonicChords(key: Key, size: 3 | 4 = 3): Chord[] {
  const p = parentKey(key);
  const spec = { root: p.tonic, type: p.scale, ...REGISTER };
  return Array.from({ length: 7 }, (_, d) => classify(diatonicChord(spec, d, size)) ?? { root: pc(diatonicChord(spec, d, 1)[0]), quality: 'maj' as const });
}

/** The quality names `music/theory` writes numerals with, per quality id. */
const THEORY_QUALITY: Partial<Record<QualityId, ChordQuality>> = {
  maj: 'maj',
  min: 'min',
  dim: 'dim',
  aug: 'aug',
  '5': 'power',
  maj7: 'maj7',
  '7': 'dom7',
  min7: 'min7',
  hdim7: 'm7b5',
  dim7: 'dim7',
  minmaj7: 'minMaj7',
  augmaj7: 'augMaj7',
};

/** A chord's function in a key: what a Roman numeral (and, where unambiguous, Riemann) says. */
export interface ChordFunction {
  /** 0..6 on the key's seven-note parent. */
  degree: number;
  /** A borrowed or chromatic root a semitone off the degree (bVII, #iv). */
  alter?: -1 | 1;
  /** Applied (secondary) chords: the degree this chord is the dominant OF (V/V: degree 4 of 4). */
  of?: number;
  numeral: string;
  /** Tonic, subdominant or dominant, for the diatonic chords whose function is not ambiguous
   *  (iii is left out: it is a tonic or a dominant substitute depending on the context). */
  riemann?: 'T' | 'S' | 'D';
}

const RIEMANN: readonly ('T' | 'S' | 'D' | undefined)[] = ['T', 'S', undefined, 'S', 'D', 'T', 'D'];

/** The degree whose root is `root` in the key's parent, or -1. */
function degreeOfRoot(root: PitchClass, key: Key): number {
  return diatonicChords(key).findIndex((c) => c.root === root);
}

const numeralOf = (degree: number, quality: QualityId): string => romanNumeral(degree, THEORY_QUALITY[quality] ?? 'unknown');

/**
 * A chord's function in a key, or null when it is none of: a diatonic chord (any quality on a
 * diatonic root: "ii", "V7"), an applied dominant (a major or dominant-seventh chord a fifth above
 * a diatonic root other than the tonic, which is not itself diatonic there: "V/V", "V7/vi"), or a
 * chord on an altered root ("bVII", "bVI", "#iv°").
 */
export function functionOf(c: Chord, key: Key): ChordFunction | null {
  const chords = diatonicChords(key);
  const d = degreeOfRoot(c.root, key);
  if (d >= 0) {
    const diatonic = chords[d].quality === c.quality || diatonicChords(key, 4)[d].quality === c.quality;
    if (diatonic || !(c.quality === 'maj' || c.quality === '7')) {
      const riemann = diatonic ? RIEMANN[d] : undefined;
      return { degree: d, numeral: numeralOf(d, c.quality), ...(riemann ? { riemann } : {}) };
    }
  }
  if (c.quality === 'maj' || c.quality === '7') {
    const target = chords.findIndex((t, k) => k !== 0 && t.quality !== 'dim' && pc(t.root + 7) === c.root);
    if (target > 0) {
      const targetNumeral = numeralOf(target, chords[target].quality);
      return { degree: 4, of: target, numeral: `${numeralOf(4, c.quality)}/${targetNumeral}` };
    }
    if (d >= 0) return { degree: d, numeral: numeralOf(d, c.quality) };
  }
  for (const alter of [-1, 1] as const) {
    const k = degreeOfRoot(pc(c.root - alter), key);
    if (k >= 0) return { degree: k, alter, numeral: (alter < 0 ? 'b' : '#') + numeralOf(k, c.quality) };
  }
  return null;
}

/** The chord a function names in a key: a diatonic degree (its own quality), an applied dominant
 *  (major, or a dominant seventh at `size` 4), or an altered root (major; a minor parent's
 *  borrowing is a later coloration's choice). */
export function chordOfFunction(fn: Pick<ChordFunction, 'degree' | 'alter' | 'of'>, key: Key, size: 3 | 4 = 3): Chord {
  const chords = diatonicChords(key, size);
  if (fn.of !== undefined) return { root: pc(chords[fn.of].root + 7), quality: size === 4 ? '7' : 'maj' };
  if (fn.alter) return { root: pc(chords[fn.degree].root + fn.alter), quality: size === 4 ? '7' : 'maj' };
  return chords[fn.degree];
}
