/**
 * The harmonic state: where the harmony is, and the intents that move it (H4 of #613,
 * `docs/design/harmonic-layers.md` §2.3). A navigator never sets the chord itself: it emits
 * intents (choose this chord, apply this move, release), and one pure reducer applies them in
 * order, so "the hands choose and the face colours" is two navigators on one state with no
 * special code, and a recorded take replays exactly.
 *
 * Pure: the chord model and the space's relations.
 */
import { chordOfFunction, functionOf, type Chord, type ChordFunction, type Key } from './chord';
import { RELATIONS, type Relation } from './space';
import type { RealizationControls } from './strategies';

export interface HarmonicState {
  key: Key;
  /** Null = silence (a release, or nothing chosen yet). */
  chord: Chord | null;
  fn: ChordFunction | null;
  /** When the chord took (or will take) effect, engine seconds. */
  at: number;
  /** The last chords, most recent first (bounded). */
  history: readonly { chord: Chord; at: number }[];
  /** Live realization controls the navigators set, merged by key. */
  controls: Readonly<Partial<RealizationControls>>;
  /** The choice a navigator is moving to but has not committed (drawn half-lit). */
  candidate: Chord | null;
  /** The last intent that could not apply (a move from a chord it does not apply to), so a
   *  navigator can show it; cleared by the next intent that applies. */
  rejected: string | null;
}

export type Intent =
  | { kind: 'choose'; chord: Chord; at: number }
  | { kind: 'step'; relation: string; at: number }
  | { kind: 'function'; fn: Pick<ChordFunction, 'degree' | 'alter' | 'of'>; at: number }
  | { kind: 'release'; at: number }
  | { kind: 'modulate'; key: Key; at: number }
  | { kind: 'controls'; controls: Partial<RealizationControls> }
  | { kind: 'candidate'; chord: Chord | null };

/** How many chords the history keeps. */
export const HISTORY_LENGTH = 16;

export function initialState(key: Key): HarmonicState {
  return { key, chord: null, fn: null, at: 0, history: [], controls: {}, candidate: null, rejected: null };
}

const same = (a: Chord | null, b: Chord | null) => !!a && !!b && a.root === b.root && a.quality === b.quality && a.bass === b.bass;

function enter(s: HarmonicState, chord: Chord, at: number): HarmonicState {
  if (same(s.chord, chord)) return { ...s, candidate: null, rejected: null };
  const history = s.chord ? [{ chord: s.chord, at: s.at }, ...s.history].slice(0, HISTORY_LENGTH) : s.history;
  return { ...s, chord, fn: functionOf(chord, s.key), at, history, candidate: null, rejected: null };
}

/** Apply intents in order (the navigators' pool priority). Pure and deterministic. */
export function applyIntents(state: HarmonicState, intents: readonly Intent[], relations: ReadonlyMap<string, Relation> = RELATIONS): HarmonicState {
  let s = state;
  for (const i of intents) {
    switch (i.kind) {
      case 'choose':
        s = enter(s, i.chord, i.at);
        break;
      case 'step': {
        const to = s.chord ? relations.get(i.relation)?.apply(s.chord, s.key)[0] : undefined;
        s = to ? enter(s, to, i.at) : { ...s, rejected: i.relation };
        break;
      }
      case 'function':
        s = enter(s, chordOfFunction(i.fn, s.key), i.at);
        break;
      case 'release':
        s = s.chord ? { ...s, chord: null, fn: null, at: i.at, history: [{ chord: s.chord, at: s.at }, ...s.history].slice(0, HISTORY_LENGTH), candidate: null } : s;
        break;
      case 'modulate':
        s = { ...s, key: i.key, fn: s.chord ? functionOf(s.chord, i.key) : null };
        break;
      case 'controls':
        s = { ...s, controls: { ...s.controls, ...i.controls } };
        break;
      case 'candidate':
        s = { ...s, candidate: i.chord };
        break;
    }
  }
  return s;
}
