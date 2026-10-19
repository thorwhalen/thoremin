/**
 * Playing targets (H6 of #613): the small state a category-driven chord instrument needs once a
 * category can stand for a MOVE, a FUNCTION or the SEVENTH (`./target`) rather than a fixed
 * degree. The face chord, a personal face categorizer and a hand-shape or pose categorizer's
 * chords share it, so a target means the same thing whichever categorizer reads it.
 *
 * - the degree in force: what a move or a function starts from (the tonic before anything played);
 * - a move or a function is applied ONCE, when its category begins (a held category keeps the
 *   chord it reached); a degree sets the chord, as before. A category back after a gap shorter
 *   than `gapS` (a hand or a face lost for a frame or two) has not begun again;
 * - the seventh colours the chord in force while its category is held.
 *
 * Moves stay in the key (the instruments play degrees on the chord-source scale), and a five- or
 * six-note chord source plays degrees only. Pure.
 */
import { diatonicChords, keyOf } from './chord';
import { voiceLeadingCost } from './distance';
import { RELATIONS } from './space';
import { isDiatonicMove, parseTarget } from './target';
import { isSevenNoteScale, type ScaleSpec } from '../music/theory';

/** The degree a move from `from` reaches on the key's seven chords (the degree itself when the
 *  move does not apply or leaves the key: these instruments stay in their key). */
export function movedDegree(spec: ScaleSpec, from: number, relation: string): number {
  const key = keyOf(spec);
  const chords = diatonicChords(key);
  const to = RELATIONS.get(relation)?.apply(chords[from], key)[0];
  const d = to ? chords.findIndex((c) => c.root === to.root && c.quality === to.quality) : -1;
  return d >= 0 ? d : from;
}

/** The chords each Riemann function names on a major or minor key (iii names none). */
const FUNCTION_DEGREES: Readonly<Record<'T' | 'S' | 'D', readonly number[]>> = { T: [0, 5], S: [3, 1], D: [4, 6] };

/** The chord with that function nearest the chord in force (least voice-leading motion; on a tie
 *  the function's main chord: I, IV, V). */
export function functionDegree(spec: ScaleSpec, from: number, fn: 'T' | 'S' | 'D'): number {
  const key = keyOf(spec);
  const chords = diatonicChords(key);
  const options = FUNCTION_DEGREES[fn];
  return options.reduce((best, d) => (voiceLeadingCost(chords[from], chords[d]) < voiceLeadingCost(chords[from], chords[best]) ? d : best), options[0]);
}

export interface TargetStep {
  /** The category read now (null: none, or a reading that is not a category). */
  category: string | null;
  /** The category's stored target string ('' or absent: its degree). */
  target: string | undefined;
  /** The degree the category plays as a degree (its own, or Auto's): used when the target is the
   *  degree, and to set the chord in force. Negative is silence. */
  degree: number;
  spec: ScaleSpec | undefined;
  /** The tick's time in seconds, so a short gap is not a new entry; without it any gap is one. */
  now?: number;
}

export interface TargetPlay {
  /** The degree to play (negative: silence). */
  degree: number;
  /** The realization pipeline's coloration while held ('diatonicSeventh'), or undefined. */
  coloration?: string;
}

export interface TargetPlayer {
  /** One tick: what to play for this category and its target. */
  step(s: TargetStep): TargetPlay;
  /** Forget the chord in force and the category held (a new categorizer starts from the tonic). */
  reset(): void;
}

/** How long a category may be gone and still be the same entry when it returns, in seconds:
 *  longer than a tracker's dropout, shorter than a deliberate release and return. */
export const TARGET_REENTRY_GAP_S = 0.3;

export function createTargetPlayer({ gapS = TARGET_REENTRY_GAP_S }: { gapS?: number } = {}): TargetPlayer {
  let current = -1;
  /** The last category read (none: null), and the last one seen and when (a gap keeps it). */
  let previous: string | null = null;
  let lastCategory: string | null = null;
  let lastSeen = -Infinity;
  return {
    reset() {
      current = -1;
      previous = lastCategory = null;
      lastSeen = -Infinity;
    },
    step({ category, target, degree, spec, now }) {
      const entered =
        category !== null && (now === undefined ? category !== previous : !(category === lastCategory && now - lastSeen <= gapS));
      previous = category;
      if (category !== null) {
        lastCategory = category;
        if (now !== undefined) lastSeen = now;
      }
      let play: TargetPlay = { degree };
      if (category !== null && spec && isSevenNoteScale(spec.type)) {
        const t = parseTarget(target, { moves: isDiatonicMove });
        if (t.kind !== 'degree') {
          const from = current >= 0 ? current : 0;
          if (t.kind === 'control') play = { degree: from, coloration: 'diatonicSeventh' };
          else if (entered) play = { degree: t.kind === 'move' ? movedDegree(spec, from, t.relation) : functionDegree(spec, from, t.riemann) };
          else play = { degree: current >= 0 ? current : from };
        }
      }
      // Only a category sets the chord in force (no reading, or a gap, leaves it where it was).
      if (category !== null && play.degree >= 0) current = play.degree;
      return play;
    },
  };
}
