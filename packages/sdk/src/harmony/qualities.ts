/**
 * Chord qualities: the ONE table of what a chord's quality is (the harmonic-layers design,
 * `docs/design/harmonic-layers.md` §2.1, step H1 of #613).
 *
 * Before it, thoremin had two quality vocabularies: `ChordQuality` in `music/theory.ts` (what
 * the overlay classifies and names) and the air guitar's suffix table (what a player may type).
 * Both now derive from this table, and so does the harmonic layers' `Chord`.
 *
 * Each row carries, besides its intervals, the ROLE of each tone ('1', 'b3', 'b7', ...): what a
 * realization step needs to drop the fifth or keep the guide tones (reduction) or add a ninth
 * (coloration), and what tonal does not expose. Ids follow Harte's chord shorthands where one
 * exists (maj, min, dim, aug, maj7, 7, min7, hdim7, dim7, minmaj7, sus2, sus4, maj6, min6, 5).
 *
 * Pure data and no imports, so `music/theory.ts` and `harmony/chord.ts` can both build on it.
 */

/** A tone's role above the root, as a lead sheet spells it. */
export type ToneRole = '1' | 'b3' | '3' | '4' | 'b5' | '5' | '#5' | '6' | 'bb7' | 'b7' | '7' | '9' | '2';

export interface QualityDef {
  /** Semitones above the root, ascending, the root first. */
  intervals: readonly number[];
  /** One role per interval. */
  roles: readonly ToneRole[];
  /** How a chord name shows it after the root ("m", "°", "ø7"). */
  short: string;
  /** The lead-sheet suffix a parser reads and the overlay prints ("m", "dim", "m7b5"). */
  symbol: string;
  /** Roman analysis writes the numeral lowercase (minor-ish third). */
  minorish: boolean;
  /** The colour mark after a Roman numeral or a Nashville number ("°", "+", "7", "ø"). */
  functionMark: string;
}

/** The qualities, in no musical order (see {@link CLASSIFY_ORDER} for detection). */
export const QUALITIES = {
  maj: { intervals: [0, 4, 7], roles: ['1', '3', '5'], short: '', symbol: '', minorish: false, functionMark: '' },
  min: { intervals: [0, 3, 7], roles: ['1', 'b3', '5'], short: 'm', symbol: 'm', minorish: true, functionMark: '' },
  dim: { intervals: [0, 3, 6], roles: ['1', 'b3', 'b5'], short: '°', symbol: 'dim', minorish: true, functionMark: '°' },
  aug: { intervals: [0, 4, 8], roles: ['1', '3', '#5'], short: '+', symbol: 'aug', minorish: false, functionMark: '+' },
  '5': { intervals: [0, 7], roles: ['1', '5'], short: '5', symbol: '5', minorish: false, functionMark: '5' },
  maj7: { intervals: [0, 4, 7, 11], roles: ['1', '3', '5', '7'], short: 'maj7', symbol: 'maj7', minorish: false, functionMark: 'maj7' },
  '7': { intervals: [0, 4, 7, 10], roles: ['1', '3', '5', 'b7'], short: '7', symbol: '7', minorish: false, functionMark: '7' },
  min7: { intervals: [0, 3, 7, 10], roles: ['1', 'b3', '5', 'b7'], short: 'm7', symbol: 'm7', minorish: true, functionMark: '7' },
  hdim7: { intervals: [0, 3, 6, 10], roles: ['1', 'b3', 'b5', 'b7'], short: 'ø7', symbol: 'm7b5', minorish: true, functionMark: 'ø' },
  dim7: { intervals: [0, 3, 6, 9], roles: ['1', 'b3', 'b5', 'bb7'], short: '°7', symbol: 'dim7', minorish: true, functionMark: '°7' },
  minmaj7: { intervals: [0, 3, 7, 11], roles: ['1', 'b3', '5', '7'], short: 'm(maj7)', symbol: 'mMaj7', minorish: true, functionMark: 'maj7' },
  augmaj7: { intervals: [0, 4, 8, 11], roles: ['1', '3', '#5', '7'], short: '+maj7', symbol: 'augMaj7', minorish: false, functionMark: '+maj7' },
  sus2: { intervals: [0, 2, 7], roles: ['1', '2', '5'], short: 'sus2', symbol: 'sus2', minorish: false, functionMark: 'sus2' },
  sus4: { intervals: [0, 5, 7], roles: ['1', '4', '5'], short: 'sus4', symbol: 'sus4', minorish: false, functionMark: 'sus4' },
  maj6: { intervals: [0, 4, 7, 9], roles: ['1', '3', '5', '6'], short: '6', symbol: '6', minorish: false, functionMark: '6' },
  min6: { intervals: [0, 3, 7, 9], roles: ['1', 'b3', '5', '6'], short: 'm6', symbol: 'm6', minorish: true, functionMark: '6' },
  add9: { intervals: [0, 2, 4, 7], roles: ['1', '9', '3', '5'], short: 'add9', symbol: 'add9', minorish: false, functionMark: 'add9' },
} as const satisfies Record<string, QualityDef>;

export type QualityId = keyof typeof QUALITIES;
export const QUALITY_IDS = Object.keys(QUALITIES) as [QualityId, ...QualityId[]];

/**
 * The qualities a set of tones is tested against, most specific first (a maj7 contains a major
 * triad, so the sevenths come before the triads), with the intervals each one must NOT have (a
 * power chord is a fifth with no third). The order and the tests are the overlay's classifier as
 * it was before this table (`classifyChord`); the sus, sixth and add9 qualities are not detected
 * (a C6 is an Am7 over C, a choice detection should not make silently).
 */
export const CLASSIFY_ORDER: readonly { id: QualityId; excludes?: readonly number[] }[] = [
  { id: 'maj7' },
  { id: '7' },
  { id: 'min7' },
  { id: 'hdim7' },
  { id: 'dim7' },
  { id: 'minmaj7' },
  { id: 'augmaj7' },
  { id: 'maj' },
  { id: 'min' },
  { id: 'dim' },
  { id: 'aug' },
  { id: '5', excludes: [3, 4] },
];

/**
 * The quality of a set of tones whose lowest is the root, or null for none of the detected
 * shapes. `intervals` are semitones above that lowest tone (any octave, any order).
 */
export function qualityOfIntervals(intervals: Iterable<number>): QualityId | null {
  const iv = new Set<number>();
  for (const i of intervals) iv.add(((i % 12) + 12) % 12);
  for (const { id, excludes } of CLASSIFY_ORDER) {
    if (QUALITIES[id].intervals.every((i) => iv.has(i)) && !(excludes ?? []).some((i) => iv.has(i))) return id;
  }
  return null;
}
