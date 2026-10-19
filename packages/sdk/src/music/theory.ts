/**
 * Pure music-theory helpers — the "tonal guidance" toolkit.
 *
 * These functions turn raw continuous control values (e.g. a hand's normalized
 * x position) into musically meaningful pitches by snapping toward the notes of
 * a chosen scale. They are deliberately dependency-free (plain math, no `tonal`,
 * no DOM) so they are trivially unit-testable and reusable everywhere.
 *
 * MIDI note numbers are the common currency: 60 = middle C, +12 per octave,
 * and `midiToFreq(69) === 440`.
 */
import { clamp01 } from '../features/math';
import { QUALITIES, qualityOfIntervals, type QualityId } from '../harmony/qualities';

/** Re-exported from the scalar-math SSOT (`@thoremin/sdk/features/math`), which owns the single
 *  definition; kept on the theory surface because the mapping layer imports it from here. */
export { clamp01 };

export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Scale interval sets (semitones from the root), keyed by a stable id. */
export const SCALE_TYPES = {
  major: { name: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  pentatonic: { name: 'Major Pentatonic', intervals: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor Pentatonic', intervals: [0, 3, 5, 7, 10] },
  minorHarmonic: { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  blues: { name: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  chromatic: { name: 'Chromatic', intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
} as const;

export type ScaleTypeId = keyof typeof SCALE_TYPES;

/** Standard equal-temperament conversion. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Inverse of {@link midiToFreq} (continuous MIDI; not rounded). */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Name a MIDI note, e.g. 60 -> "C4". */
export function midiToName(midi: number): string {
  const r = Math.round(midi);
  return `${NOTES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

/** The recognized chord qualities: the basic triads plus the common sevenths. */
export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'power'
  | 'maj7'
  | 'dom7'
  | 'min7'
  | 'm7b5'
  | 'dim7'
  | 'minMaj7'
  | 'augMaj7'
  | 'unknown';

/** A chord's root pitch class, classified quality, and jazz lead-sheet symbol. */
export interface ChordInfo {
  /** Root pitch class, 0 = C … 11 = B (the lowest tone). */
  root: number;
  quality: ChordQuality;
  /** Lead-sheet symbol, e.g. `C`, `Am`, `Bdim`, `G7`, `Cmaj7`, `Bm7b5`. */
  symbol: string;
}

/** Each classified quality's row in the harmony layer's quality table (`../harmony/qualities`),
 *  the one SSOT of intervals, suffixes and function marks: this module keeps its own names
 *  (`dom7`, `m7b5`, `power`) because every caller and stored label uses them. */
const QUALITY_ID: Record<Exclude<ChordQuality, 'unknown'>, QualityId> = {
  maj: 'maj',
  min: 'min',
  dim: 'dim',
  aug: 'aug',
  power: '5',
  maj7: 'maj7',
  dom7: '7',
  min7: 'min7',
  m7b5: 'hdim7',
  dim7: 'dim7',
  minMaj7: 'minmaj7',
  augMaj7: 'augmaj7',
};
const QUALITY_OF_ID = Object.fromEntries(Object.entries(QUALITY_ID).map(([q, id]) => [id, q])) as Partial<Record<QualityId, ChordQuality>>;
const row = (q: ChordQuality) => (q === 'unknown' ? undefined : QUALITIES[QUALITY_ID[q]]);

/**
 * Classify a chord from its MIDI tones: the lowest tone is the root, and the set
 * of intervals above it selects the quality. Sevenths are tested BEFORE the plain
 * triads (a maj7 contains a major triad), so the most specific shape wins
 * (`CLASSIFY_ORDER` in `../harmony/qualities`). Returns `null` for no tones; an
 * unrecognized shape falls back to the bare root note name (quality `unknown`,
 * empty suffix).
 */
export function classifyChord(tones: number[]): ChordInfo | null {
  if (!tones.length) return null;
  const sorted = [...tones].sort((a, b) => a - b);
  const root = (((sorted[0] % 12) + 12) % 12);
  const id = qualityOfIntervals(sorted.map((m) => m - sorted[0]));
  const quality: ChordQuality = (id && QUALITY_OF_ID[id]) ?? 'unknown';
  return { root, quality, symbol: NOTES[root] + (row(quality)?.symbol ?? '') };
}

/**
 * Name a chord from its MIDI tones (root + quality) — e.g. "C", "Am", "Bdim",
 * "G7", "Cmaj7". Best-effort: the lowest tone is the root and the intervals
 * classify the quality (see {@link classifyChord}); falls back to just the root
 * note name when the shape isn't a recognized triad/seventh, and "" for no tones.
 */
export function chordName(tones: number[]): string {
  return classifyChord(tones)?.symbol ?? '';
}

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;
/** Whether Roman analysis writes the quality lowercase (a minor-ish third), and the colour
 *  mark after the numeral (the diminished/augmented/half-diminished symbol and the seventh;
 *  the major/minor distinction is carried by case, or by the Nashville `m`): both from the
 *  quality table (`../harmony/qualities`). `ø` already denotes a half-diminished SEVENTH,
 *  so it stands alone. */
const minorish = (q: ChordQuality): boolean => row(q)?.minorish ?? false;
const functionMark = (q: ChordQuality): string => row(q)?.functionMark ?? '';

/**
 * The scale degree (0 = tonic … 6) whose pitch class equals `pitchClass`, or -1
 * if it is not in the scale. A scale's distinct pitch classes, in ascending order
 * within its first octave, ARE its degrees — so this maps a chord root back to the
 * degree it was built on (exact for diatonic chords, which is all thoremin plays
 * in chord mode). Feeds the Roman/Nashville function label without a new port.
 */
export function scaleDegreeOf(pitchClass: number, scale: number[]): number {
  const target = (((pitchClass % 12) + 12) % 12);
  const pcs: number[] = [];
  for (const m of scale) {
    const pc = (((m % 12) + 12) % 12);
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return pcs.indexOf(target);
}

/**
 * The Roman-numeral function of a chord on scale `degree` (0..6) with the given
 * `quality`: case encodes major/minor (upper/lower) and the quality's function mark adds
 * the colour (e.g. `I`, `ii`, `V7`, `vii°`, `iiø`, `Imaj7`). Returns "" for an
 * out-of-range degree.
 */
export function romanNumeral(degree: number, quality: ChordQuality): string {
  if (degree < 0 || degree > 6) return '';
  const r = minorish(quality)
    ? ROMAN_NUMERALS[degree].toLowerCase()
    : (ROMAN_NUMERALS[degree] as string);
  return r + functionMark(quality);
}

/**
 * The Nashville-number function of a chord: the degree as 1..7, a trailing `m`
 * for plain minor qualities, and the quality's function mark for the colour (e.g. `1`,
 * `2m`, `57`, `7°`, `7ø`, `1maj7`). The number-first shorthand many non-classical
 * players prefer. Returns "" for an out-of-range degree.
 */
export function nashvilleNumber(degree: number, quality: ChordQuality): string {
  if (degree < 0 || degree > 6) return '';
  // A plain minor triad/seventh gets an `m`; dim/aug/half-dim carry their own mark.
  const m = quality === 'min' || quality === 'min7' || quality === 'minMaj7' ? 'm' : '';
  return String(degree + 1) + m + functionMark(quality);
}

export interface ScaleSpec {
  /** Pitch class of the root, 0 = C ... 11 = B. */
  root: number;
  type: ScaleTypeId;
  /** Number of octaves the playable range spans (the LEGACY span control; used by
   *  {@link generateScale} only when the range fields below are absent). */
  octaves: number;
  /** Octave of the lowest note (MIDI octave; 3 is a comfortable mid range). Also the
   *  floor of the always-covered "middle octave" for the range model (#63). */
  baseOctave: number;
  /**
   * #63 octave RANGE (a "double-thumb" span around a locked middle octave). When BOTH
   * `rangeLow` and `rangeHigh` are set, {@link generateScale} spans
   * `[baseNote − rangeLow·12, (baseNote + 12) + rangeHigh·12]` — the middle octave
   * `[baseNote, baseNote+12]` is always covered and the total span is 1..3 octaves.
   * Each is a fractional octave in `[0,1]`. When EITHER is absent, generation falls
   * back to the legacy `octaves` path (byte-identical), so pre-#63 specs are unchanged.
   */
  rangeLow?: number;
  rangeHigh?: number;
}

export const DEFAULT_SCALE: ScaleSpec = {
  root: 0,
  type: 'major',
  octaves: 2,
  baseOctave: 3,
};

/**
 * Build the ascending list of MIDI notes for a scale spec, inclusive of the
 * octave-completing top note. e.g. C major, 2 octaves, base octave 3 ->
 * [48, 50, 52, 53, 55, 57, 59, 60, ... 72].
 *
 * Two spans (#63): when `rangeLow`/`rangeHigh` are set, the scale covers a locked
 * MIDDLE octave `[baseNote, baseNote+12]` extended `rangeLow` octaves down and
 * `rangeHigh` octaves up (each a fractional octave in `[0,1]` → a 1..3 octave span
 * that always includes the middle). Otherwise it uses the legacy `octaves` span
 * (byte-identical to before #63). A wider range simply lengthens the note array's
 * span; the continuous pitch mapper ({@link magneticPitch}) glides across it.
 */
export function generateScale(spec: ScaleSpec): number[] {
  const { type, baseOctave, root, rangeLow, rangeHigh } = spec;
  const intervals = SCALE_TYPES[type].intervals;
  const baseNote = (baseOctave + 1) * 12 + root; // the root at the middle octave's floor

  if (typeof rangeLow === 'number' && typeof rangeHigh === 'number') {
    const EPS = 1e-9;
    const lo = baseNote - Math.max(0, rangeLow) * 12;
    const hi = baseNote + 12 + Math.max(0, rangeHigh) * 12;
    const scale: number[] = [baseNote, baseNote + 12]; // the middle octave is always covered
    const kMin = Math.floor((lo - baseNote) / 12) - 1;
    const kMax = Math.ceil((hi - baseNote) / 12) + 1;
    for (let k = kMin; k <= kMax; k++) {
      for (const interval of intervals) {
        const n = baseNote + k * 12 + interval;
        if (n >= lo - EPS && n <= hi + EPS) scale.push(n);
      }
      const octaveTop = baseNote + (k + 1) * 12; // octave-completing root
      if (octaveTop >= lo - EPS && octaveTop <= hi + EPS) scale.push(octaveTop);
    }
    return [...new Set(scale)].sort((a, b) => a - b);
  }

  const { octaves } = spec;
  const scale: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const interval of intervals) scale.push(baseNote + o * 12 + interval);
  }
  scale.push(baseNote + octaves * 12);
  return [...new Set(scale)].sort((a, b) => a - b);
}

/** True for scales with exactly seven degrees (major / natural minor / harmonic
 * minor) — the scales on which a diatonic triad (stacked thirds) is well-defined.
 * Pentatonic (5), blues (6) and chromatic (12) are not seven-note. */
export function isSevenNoteScale(type: ScaleTypeId): boolean {
  return SCALE_TYPES[type].intervals.length === 7;
}

/**
 * The chord rooted on scale `degree` (0 = tonic) of a scale, as three ascending
 * MIDI notes, built by stacking scale-thirds — degrees `degree`, `degree + 2`,
 * `degree + 4` — within the scale's own interval set. On a seven-note scale this
 * is the classic diatonic triad (major I/ii/iii…, harmonic-minor's augmented III
 * and diminished ii°, etc.); on a non-seven-note scale it generalizes to that
 * scale's own step-set (see {@link diatonicChord}) — e.g. a pentatonic source
 * yields a musical, non-tertian stacked sonority. Degrees that step past the
 * octave wrap up by 12 semitones, keeping the triad ascending.
 *
 * A NEGATIVE degree (the silence sentinel) returns `[]`, so the sentinel is
 * self-enforcing — a caller that forgets to gate it gets silence, not a wrong
 * (wrapped) chord.
 */
export function diatonicTriad(spec: ScaleSpec, degree: number): number[] {
  return diatonicChord(spec, degree, 3);
}

/**
 * A chord rooted on scale `degree`, built by stacking `size` scale-thirds —
 * degrees `degree`, `degree+2`, … — within the scale's own interval set, as
 * ascending MIDI notes. `size = 3` is the triad ({@link diatonicTriad}); `size = 4`
 * adds the diatonic seventh (`[0,2,4,6]`), used by the head-pose instrument's brow
 * "add-7th" modifier (#76).
 *
 * Generalized over the scale's own length `L = intervals.length` (#75): a
 * seven-note scale is byte-identical to the classic diatonic chord; a shorter
 * scale (pentatonic L=5, blues L=6) stacks *its* thirds — the chord-source scale
 * need no longer match the melody scale, so a pentatonic melody can still get
 * chords (from a seven-note chord source by default) and arbitrary chord-source
 * scales are allowed (yielding non-traditional but musical sonorities). Degrees
 * are taken `mod L` and steps past the top octave wrap up by 12 semitones, keeping
 * the chord ascending.
 *
 * Returns `[]` for a negative degree (the silence sentinel) or a non-positive
 * `size`, so callers degrade gracefully to no chord rather than indexing out of
 * range.
 */
export function diatonicChord(spec: ScaleSpec, degree: number, size = 3): number[] {
  if (degree < 0 || size < 1) return [];
  const intervals = SCALE_TYPES[spec.type].intervals;
  const L = intervals.length;
  const baseNote = (spec.baseOctave + 1) * 12 + spec.root;
  const d = ((degree % L) + L) % L;
  return Array.from({ length: size }, (_, i) => {
    const idx = d + 2 * i;
    return baseNote + intervals[idx % L] + 12 * Math.floor(idx / L);
  });
}

/**
 * The default chord-source scale for a melody scale (#75): the melody scale is a
 * smart *default* for where the face/pose chords are drawn from, decoupled from
 * what the right hand plays. Seven-note melodies keep today's behaviour exactly
 * (chord source = melody scale). Non-seven-note melodies map to the nearest
 * diatonic embedding by root, so "pentatonic melody + chords" just works with zero
 * configuration:
 *  - Major Pentatonic @R → Major @R (C-maj-pent {C,D,E,G,A} ⊂ C major).
 *  - Minor Pentatonic @R → Natural Minor @R (A-min-pent {A,C,D,E,G} ⊂ A minor;
 *    same-root so the tonic/"home chord" matches the player's mental root).
 *  - Blues @R → Natural Minor @R (blues is a minor-pentatonic + ♭5).
 *  - Chromatic @R → Major @R (chromatic has no home; give plain tertian triads).
 * The result is a subset-coherent embedding for the pentatonics; blues/chromatic
 * carry expected blue-note/chromatic tension (so the "auto" default never triggers
 * the custom-source clash warning). Pure — unit-tested next to {@link isSevenNoteScale}.
 */
export function defaultChordSpecFor(melody: Pick<ScaleSpec, 'root' | 'type'>): {
  root: number;
  type: ScaleTypeId;
} {
  const { root, type } = melody;
  if (isSevenNoteScale(type)) return { root, type };
  switch (type) {
    case 'minorPentatonic':
    case 'blues':
      return { root, type: 'minor' };
    case 'pentatonic':
    case 'chromatic':
    default:
      return { root, type: 'major' };
  }
}

/** The seven note letters, in scale order from C. */
export const NOTE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type NoteLetter = (typeof NOTE_LETTERS)[number];

/** The letter each major key's tonic is conventionally spelled with, by root pitch class
 *  (Db, Eb, F#, Ab, Bb: the usual key signatures, F# preferred over Gb). */
const MAJOR_TONIC_LETTER: readonly NoteLetter[] = ['C', 'D', 'D', 'E', 'E', 'F', 'F', 'G', 'A', 'A', 'B', 'B'];
/** The same for minor keys (C#m, Ebm, F#m, G#m, Bbm). */
const MINOR_TONIC_LETTER: readonly NoteLetter[] = ['C', 'C', 'D', 'E', 'E', 'F', 'F', 'G', 'G', 'A', 'B', 'B'];

/**
 * The scale degree (0..6) whose note is spelled with `letter` in this key: the chord a
 * letter names when letters name chords "in their own key". The key's accidentals apply,
 * so in D major the letter F is F#, degree 2 (iii, F#m), and C is C#, degree 6 (vii°).
 *
 * The key is read through its seven-note embedding ({@link defaultChordSpecFor}), so a
 * pentatonic or blues key spells like its parent major or minor. Use the result with that
 * embedding's spec (see {@link letterChordSpec}): on a five-note scale the degree would wrap.
 */
export function letterDegree(key: Pick<ScaleSpec, 'root' | 'type'>, letter: NoteLetter): number {
  const parent = defaultChordSpecFor(key);
  const root = ((parent.root % 12) + 12) % 12;
  const minorish = SCALE_TYPES[parent.type].intervals[2] === 3;
  const tonic = (minorish ? MINOR_TONIC_LETTER : MAJOR_TONIC_LETTER)[root]!;
  return (NOTE_LETTERS.indexOf(letter) - NOTE_LETTERS.indexOf(tonic) + 7) % 7;
}

const NATURAL_PC: Readonly<Record<NoteLetter, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL: Readonly<Record<number, string>> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };

/** A pitch class spelled on a given letter: 10 on B is "Bb", 6 on F is "F#". */
export function spellOnLetter(pc: number, letter: NoteLetter): string {
  const d = ((((pc - NATURAL_PC[letter]) % 12) + 18) % 12) - 6;
  return letter + (ACCIDENTAL[d] ?? '?');
}

/** How a key is conventionally written: "Bb", "F#", "C#m"-style roots (the tonic letter of
 *  {@link letterDegree}'s tables), so a key picker and the letter chords agree on spelling. */
export function keyName(key: Pick<ScaleSpec, 'root' | 'type'>): string {
  const parent = defaultChordSpecFor(key);
  const root = ((parent.root % 12) + 12) % 12;
  const minorish = SCALE_TYPES[parent.type].intervals[2] === 3;
  return spellOnLetter(root, (minorish ? MINOR_TONIC_LETTER : MAJOR_TONIC_LETTER)[root]!);
}

/** The seven-note spec letter chords are built on: the key's own when it has seven notes,
 *  else its embedding ({@link defaultChordSpecFor}), keeping the register fields. */
export function letterChordSpec<S extends Pick<ScaleSpec, 'root' | 'type'>>(key: S): S {
  return { ...key, ...defaultChordSpecFor(key) };
}

/** The distinct pitch classes (0..11) a scale sounds — its root plus intervals, mod 12. */
export function scalePitchClasses(root: number, type: ScaleTypeId): Set<number> {
  return new Set(SCALE_TYPES[type].intervals.map((iv) => ((((root + iv) % 12) + 12) % 12)));
}

/**
 * Whether a melody scale "lives inside" a chord-source scale — every melody pitch
 * class is also a chord-scale pitch class (`pcset(melody) ⊆ pcset(chord)`). This is
 * the musically-correct coherence condition (#75): when true, every note the hand
 * can play is harmonized by the chord scale, so the two never clash. Drives the
 * non-blocking custom-chord-source warning (the subset test is authoritative; the
 * explanatory detail is {@link melodyNotesOutsideChord}, NOT a union-size count —
 * the two heuristics disagree in both directions, so only subset is used).
 */
export function scaleIsSubset(
  melody: Pick<ScaleSpec, 'root' | 'type'>,
  chord: Pick<ScaleSpec, 'root' | 'type'>,
): boolean {
  const c = scalePitchClasses(chord.root, chord.type);
  for (const pc of scalePitchClasses(melody.root, melody.type)) if (!c.has(pc)) return false;
  return true;
}

/** The note names of the melody's pitch classes that fall OUTSIDE the chord-source
 *  scale (ascending) — the concrete, always-subset-consistent explanation for the
 *  custom-chord-source clash warning (e.g. `['F#']` → "F# is not in the chord scale").
 *  Empty when {@link scaleIsSubset} holds. */
export function melodyNotesOutsideChord(
  melody: Pick<ScaleSpec, 'root' | 'type'>,
  chord: Pick<ScaleSpec, 'root' | 'type'>,
): string[] {
  const c = scalePitchClasses(chord.root, chord.type);
  const out: string[] = [];
  for (const pc of [...scalePitchClasses(melody.root, melody.type)].sort((a, b) => a - b)) {
    if (!c.has(pc)) out.push(NOTES[pc]);
  }
  return out;
}

/**
 * Where each scale note sits along the normalized control axis (x in 0..1),
 * matching how {@link magneticPitch} maps x → MIDI (linear across the scale's
 * MIDI span). Used to draw a pitch/scale guide showing the player where each
 * note is. Returns ascending x; empty for an empty scale.
 */
export function scaleGuide(scale: number[]): { midi: number; x: number }[] {
  if (scale.length === 0) return [];
  const min = scale[0];
  const spanMidi = scale[scale.length - 1] - min;
  return scale.map((midi) => ({ midi, x: spanMidi > 0 ? (midi - min) / spanMidi : 0 }));
}

/**
 * Map a normalized control value `x` in [0, 1] to a (possibly fractional) MIDI
 * note, snapping toward scale notes by a `magnetism` amount.
 *
 *  - `magnetism = 0`  : free continuous glide across the scale's MIDI range.
 *  - `magnetism = 1`  : hard snap to the nearest scale note (stepped).
 *  - in between       : an eased pull toward the nearer of the two surrounding
 *                       scale notes, giving expressive "in-tune-ish" portamento.
 *
 * This generalizes the magnetic pitch mapper from the original Thoremin synth,
 * but returns MIDI (not Hz) so it is pure and composable. Pair with
 * {@link midiToFreq} at the synthesis stage.
 */
export function magneticPitch(x: number, scale: number[], magnetism: number): number {
  if (scale.length === 0) return 60;
  if (scale.length === 1) return scale[0];

  const xc = clamp01(x);
  const midiMin = scale[0];
  const midiMax = scale[scale.length - 1];
  const v = midiMin + xc * (midiMax - midiMin); // continuous MIDI

  const p = clamp01(magnetism);
  if (p === 0) return v;

  // Find the two scale notes bracketing v.
  let lo = scale[0];
  let hi = scale[scale.length - 1];
  for (let i = 0; i < scale.length - 1; i++) {
    if (v >= scale[i] && v <= scale[i + 1]) {
      lo = scale[i];
      hi = scale[i + 1];
      break;
    }
  }
  if (lo === hi) return lo;

  const t = (v - lo) / (hi - lo); // 0..1 between lo and hi
  let tMapped: number;
  if (p === 1) {
    tMapped = t < 0.5 ? 0 : 1; // hard snap
  } else {
    // Push t toward 0 or 1 with an exponent that sharpens as p -> 1.
    const u = 2 * t - 1; // -1..1
    const sign = u >= 0 ? 1 : -1;
    tMapped = 0.5 + 0.5 * sign * Math.pow(Math.abs(u), 1 - p);
  }
  return lo + tMapped * (hi - lo);
}

/** Snap a continuous MIDI value to the nearest note actually in the scale. */
export function nearestScaleNote(midi: number, scale: number[]): number {
  if (scale.length === 0) return Math.round(midi);
  let best = scale[0];
  let bestDist = Math.abs(midi - best);
  for (const n of scale) {
    const d = Math.abs(midi - n);
    if (d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Linearly map `x` from [inMin, inMax] to [outMin, outMax], clamped to the
 * output range. The fundamental "knob" transform of the mapping layer.
 */
export function rangeMap(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMin;
  const t = (x - inMin) / (inMax - inMin);
  const tc = t < 0 ? 0 : t > 1 ? 1 : t;
  return outMin + tc * (outMax - outMin);
}
