/**
 * The key signatures and chord symbols of a parsed MusicXML (or ABC) score, placed in the
 * {@link ScoreDoc}'s beats.
 *
 * Positions come from two walks. Within a measure, an entry's offset is the running sum of the
 * notes, backups and forwards before it, in the measure's divisions. Across measures, the
 * timing sidecar of the MIDI export says where each measure starts in PLAYBACK order (repeats
 * unrolled), so a measure played twice gets its symbols twice. The sidecar names a measure only by
 * its number, and numbers are not unique (a file with several movements restarts them), so each
 * run of breakpoints is matched to the written measure that follows the previous one, or to the
 * nearest earlier one with that number (a repeat's jump back).
 *
 * Keys are in concert pitch: they are read from the first part with no `<transpose>`, or, when
 * every part transposes, from the first part with its transposition undone. The key in force at a
 * measure is the last one written at or before it in WRITTEN order, so a jump back into a section
 * returns to that section's key.
 */
import type { parseAuto } from 'musicxml-io/browser';
import { QUALITIES, type QualityId } from '@thoremin/sdk/harmony/qualities';
import { KEY_MODES, normalizeFifths, type HarmonySymbol, type KeyMode, type KeySignature } from '@thoremin/sdk/score/schema';

type Score = ReturnType<typeof parseAuto>;
type Part = Score['parts'][number];
type Measure = Part['measures'][number];
type Entry = Measure['entries'][number];

/** One sidecar breakpoint: what the MIDI export says about a moment of playback. */
export interface Breakpoint {
  midiSec: number;
  quarterPos: number;
  measureNumber: string;
  beatInMeasure: number;
}

/** A written measure as played: its index in the part and its start in quarter notes. */
export interface Occurrence {
  index: number;
  start: number;
}

const EPS = 1e-6;

/** Every playback occurrence of a written measure, in playback order. */
export function measureOccurrences(breakpoints: readonly Breakpoint[], measures: readonly Pick<Measure, 'number'>[]): Occurrence[] {
  const out: (Occurrence & { number: string })[] = [];
  let cur = -1;
  for (const bp of breakpoints) {
    const start = bp.quarterPos - bp.beatInMeasure;
    const last = out[out.length - 1];
    if (last && last.number === bp.measureNumber && Math.abs(last.start - start) < EPS) continue;
    let index = -1;
    if (measures[cur + 1]?.number === bp.measureNumber) index = cur + 1;
    else {
      for (let j = cur; j >= 0; j--) if (measures[j].number === bp.measureNumber) { index = j; break; }
      if (index < 0) for (let j = cur + 2; j < measures.length; j++) if (measures[j].number === bp.measureNumber) { index = j; break; }
    }
    if (index < 0) continue;
    out.push({ index, start, number: bp.measureNumber });
    cur = index;
  }
  return out.map(({ index, start }) => ({ index, start }));
}

/** An entry with its offset in the measure, in quarter notes. */
interface Placed<E> {
  entry: E;
  /** Quarter notes from the measure's start. */
  offset: number;
}

/** A part's measures walked once: each measure's key changes and chord symbols, at their offsets. */
interface Walked {
  keys: Placed<NonNullable<Measure['attributes']>['key'] & object>[][];
  harmonies: Placed<Extract<Entry, { type: 'harmony' }>>[][];
  /** The chromatic transposition the part declares (0 = concert pitch), and whether it does. */
  chromatic: number;
  transposes: boolean;
}

function walkPart(part: Part): Walked {
  let divisions = 1;
  let chromatic = 0;
  let transposes = false;
  const keys: Walked['keys'] = [];
  const harmonies: Walked['harmonies'] = [];
  const readAttributes = (a: Measure['attributes'] | undefined, offset: number, into: Walked['keys'][number]) => {
    if (!a) return;
    if (a.divisions && a.divisions > 0) divisions = a.divisions;
    const t = a.transpose ?? a.transposes?.[0];
    if (t) {
      transposes = true;
      chromatic = t.chromatic + 12 * (t.octaveChange ?? 0);
    }
    const key = a.key ?? a.keys?.[0];
    if (key) into.push({ entry: key, offset });
  };
  for (const measure of part.measures) {
    const mk: Walked['keys'][number] = [];
    const mh: Walked['harmonies'][number] = [];
    readAttributes(measure.attributes, 0, mk);
    let pos = 0;
    for (const e of measure.entries) {
      if (e.type === 'attributes') readAttributes(e.attributes, pos / divisions, mk);
      else if (e.type === 'harmony') mh.push({ entry: e, offset: (pos + (e.offset ?? 0)) / divisions });
      else if (e.type === 'note') {
        if (!e.chord && !(e as { grace?: unknown }).grace) pos += e.duration;
      } else if (e.type === 'backup') pos -= e.duration;
      else if (e.type === 'forward') pos += e.duration;
    }
    keys.push(mk);
    harmonies.push(mh);
  }
  return { keys, harmonies, chromatic, transposes };
}

const modeOf = (m: string | undefined): KeyMode => ((KEY_MODES as readonly string[]).includes(m ?? '') ? (m as KeyMode) : 'major');

/** The key signatures in force across the piece, a change per playback position. */
export function keysOf(score: Score, occurrences: readonly Occurrence[]): KeySignature[] {
  if (!score.parts.length) return [];
  const walked = score.parts.map(walkPart);
  const chosen = walked.find((w) => !w.transposes) ?? walked[0];
  // A transposing part's written fifths, moved to concert pitch: each semitone up is seven fifths.
  const shift = chosen.transposes ? 7 * chosen.chromatic : 0;
  const concert = (fifths: number) => (shift ? normalizeFifths(fifths + shift) : fifths);
  // The key in force at each measure's start, in written order, and the changes inside it.
  let inForce: { fifths: number; mode: KeyMode } | null = null;
  const atStart: ({ fifths: number; mode: KeyMode } | null)[] = [];
  const inside: { offset: number; key: { fifths: number; mode: KeyMode } }[][] = [];
  chosen.keys.forEach((changes) => {
    const within: (typeof inside)[number] = [];
    for (const c of changes) {
      const key = { fifths: concert(c.entry.fifths), mode: modeOf(c.entry.mode) };
      if (c.offset < EPS) inForce = key;
      else within.push({ offset: c.offset, key });
    }
    atStart.push(inForce);
    inside.push(within);
    if (within.length) inForce = within[within.length - 1].key;
  });
  const out: KeySignature[] = [];
  const push = (beat: number, key: { fifths: number; mode: KeyMode } | null) => {
    if (!key) return;
    const last = out[out.length - 1];
    if (last && last.fifths === key.fifths && last.mode === key.mode) return;
    if (last && Math.abs(last.beat - beat) < EPS) out.pop();
    out.push({ beat: Math.max(0, beat), fifths: key.fifths, mode: key.mode });
  };
  for (const occ of occurrences) {
    push(occ.start, atStart[occ.index] ?? null);
    for (const w of inside[occ.index] ?? []) push(occ.start + w.offset, w.key);
  }
  return out;
}

const STEP_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = (step: string | undefined, alter = 0): number | null => {
  const base = STEP_PC[(step ?? '').trim().toUpperCase()];
  return base === undefined ? null : (((base + Math.round(alter)) % 12) + 12) % 12;
};

/** MusicXML's `<kind>` values onto the SDK's qualities: the extended chords read as their
 *  seventh chord, the augmented sixths as the dominant seventh they sound like. `none` (no
 *  chord), `pedal` and `other` have no quality. */
export const HARMONY_KINDS: Readonly<Record<string, QualityId>> = {
  major: 'maj',
  minor: 'min',
  augmented: 'aug',
  diminished: 'dim',
  dominant: '7',
  'major-seventh': 'maj7',
  'minor-seventh': 'min7',
  'diminished-seventh': 'dim7',
  'augmented-seventh': '7',
  'half-diminished': 'hdim7',
  'major-minor': 'minmaj7',
  'major-sixth': 'maj6',
  'minor-sixth': 'min6',
  'dominant-ninth': '7',
  'major-ninth': 'maj7',
  'minor-ninth': 'min7',
  'dominant-11th': '7',
  'major-11th': 'maj7',
  'minor-11th': 'min7',
  'dominant-13th': '7',
  'major-13th': 'maj7',
  'minor-13th': 'min7',
  'suspended-second': 'sus2',
  'suspended-fourth': 'sus4',
  power: '5',
  Neapolitan: 'maj',
  Italian: '7',
  French: '7',
  German: '7',
  Tristan: 'hdim7',
};

/** A `<harmony>` as a chord symbol, or null for one with no chord (`N.C.`) or an unknown kind. */
export function chordOfHarmony(h: Extract<Entry, { type: 'harmony' }>): HarmonySymbol['chord'] | null {
  const quality = HARMONY_KINDS[h.kind];
  const root = pcOf(h.root?.rootStep, h.root?.rootAlter);
  if (!quality || !QUALITIES[quality] || root === null) return null;
  const bass = h.bass ? pcOf(h.bass.bassStep, h.bass.bassAlter) : null;
  return bass !== null && bass !== root ? { root, quality, bass } : { root, quality };
}

/** The chord symbols of the piece, in playback order (the first part's, where two parts write one
 *  at the same beat). */
export function harmonyOf(score: Score, occurrences: readonly Occurrence[]): HarmonySymbol[] {
  const byBeat = new Map<string, HarmonySymbol>();
  for (const w of score.parts.map(walkPart)) {
    for (const occ of occurrences) {
      for (const h of w.harmonies[occ.index] ?? []) {
        const chord = chordOfHarmony(h.entry);
        if (!chord) continue;
        const beat = Math.max(0, occ.start + h.offset);
        const id = beat.toFixed(6);
        if (byBeat.has(id)) continue;
        byBeat.set(id, { beat, chord, ...(h.entry.kindText ? { text: h.entry.kindText } : {}) });
      }
    }
  }
  return [...byBeat.values()].sort((a, b) => a.beat - b.beat);
}
