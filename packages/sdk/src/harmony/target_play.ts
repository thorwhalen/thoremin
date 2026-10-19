/**
 * Playing targets (H6 of #613): the small state a category-driven chord instrument needs once a
 * category can stand for a MOVE, a FUNCTION or the SEVENTH (`./target`) rather than a fixed
 * degree. The face chord, a personal face categorizer and a hand-shape or pose categorizer's
 * chords share it, so a target means the same thing whichever categorizer reads it.
 *
 * - the degree in force: what a move or a function starts from (the tonic before anything played);
 * - a move or a function is applied ONCE, when its category begins (a held category keeps the
 *   chord it reached); a degree sets the chord, as before;
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
}

export function createTargetPlayer(): TargetPlayer {
  let current = -1;
  let lastCategory: string | null = null;
  return {
    step({ category, target, degree, spec }) {
      const entered = category !== lastCategory;
      lastCategory = category;
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
      if (play.degree >= 0) current = play.degree;
      return play;
    },
  };
}
