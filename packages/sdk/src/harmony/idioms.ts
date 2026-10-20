/**
 * Idiom paths (#713): named chord paths a player can see ahead of them on a chord map as a ghost
 * trail, and follow: the hands confirm the next chord of the path or vary it, and the path keeps
 * its place. The schemata of galant music (Gjerdingen's Romanesca, Monte, Fonte), the
 * progressions every harmony class names (the circle of fifths, Pachelbel, the Andalusian
 * cadence) and the fifties' I vi IV V.
 *
 * An idiom is data: degree steps on the key's seven-note parent, a step optionally an applied
 * dominant (`of`: V/x) or a chord of another quality on the degree (the Andalusian cadence's
 * major V in a natural minor key). `idiomPath` realizes it in a key and says, per step, which
 * cell of a map of the key's seven chords it sits on: the key's own chord there (`exact`), or a
 * chord on that cell's root (`root`: V/ii is drawn on vi's cell, an applied dominant on its
 * root's). A step whose root is not one of the key's is off the map (`cell` null).
 *
 * Following is a pure cursor over the steps (`startFollow`, `followCommit`, `ahead`): a commit
 * of the next step's cell advances, a commit of the current cell keeps it, a commit of a cell
 * further along the path rejoins there (a skip), and any other commit leaves the path, the
 * cursor kept where it was so the trail still shows the way back. Pure.
 */
import { chordOfFunction, diatonicChords, type Chord, type Key } from './chord';
import type { QualityId } from './qualities';

/** One step of an idiom: a degree of the key (I = 0), or the dominant OF a degree, optionally
 *  with another quality than the key's own. */
export interface IdiomStep {
  degree: number;
  /** An applied dominant: the major chord a fifth above degree `of` (V/x); `degree` is then 4. */
  of?: number;
  /** The quality on the degree when it is not the key's own (the Andalusian's major V). */
  quality?: QualityId;
}

export interface Idiom {
  id: string;
  name: string;
  /** Where the name comes from and what it is. */
  description: string;
  /** The mode it is idiomatic in (it realizes in any key, on that key's degrees). */
  mode: 'major' | 'minor';
  steps: readonly IdiomStep[];
  /** It repeats (a ground, a loop) rather than ending. */
  loops: boolean;
}

const d = (...degrees: number[]): IdiomStep[] => degrees.map((degree) => ({ degree }));
const v = (of: number): IdiomStep => ({ degree: 4, of });

/** The built-in idioms, in the order a menu lists them. */
export const IDIOMS: readonly Idiom[] = [
  { id: 'circle', name: 'Circle of fifths', description: 'Every root a fifth below the last, down the key: I IV vii° iii vi ii V I.', mode: 'major', steps: d(0, 3, 6, 2, 5, 1, 4, 0), loops: false },
  { id: 'pachelbel', name: 'Pachelbel', description: "The Canon's ground: I V vi iii IV I IV V.", mode: 'major', steps: d(0, 4, 5, 2, 3, 0, 3, 4), loops: true },
  { id: 'romanesca', name: 'Romanesca', description: "Gjerdingen's galant schema, the bass falling by step under a fourth up, a fifth down: I V vi iii.", mode: 'major', steps: d(0, 4, 5, 2), loops: false },
  { id: 'monte', name: 'Monte', description: "Gjerdingen's rising sequence, each pair a dominant and its resolution one step higher: V/IV IV V/V V.", mode: 'major', steps: [v(3), ...d(3), v(4), ...d(4)], loops: false },
  { id: 'fonte', name: 'Fonte', description: "Gjerdingen's falling sequence, a minor pair then the major one a step lower: V/ii ii V I.", mode: 'major', steps: [v(1), ...d(1, 4, 0)], loops: false },
  { id: 'thirds', name: 'Descending thirds', description: 'Every root a third below the last: I vi IV ii.', mode: 'major', steps: d(0, 5, 3, 1), loops: true },
  { id: 'fifties', name: 'The fifties progression', description: 'Doo-wop\'s loop: I vi IV V.', mode: 'major', steps: d(0, 5, 3, 4), loops: true },
  { id: 'deceptive', name: 'Deceptive cadence', description: 'A cadence that lands on vi instead of I: ii V vi.', mode: 'major', steps: d(1, 4, 5), loops: false },
  { id: 'andalusian', name: 'Andalusian cadence', description: 'The flamenco descent in a minor key, its V major as in harmonic minor: i VII VI V.', mode: 'minor', steps: [...d(0, 6, 5), { degree: 4, quality: 'maj' }], loops: true },
];

export const IDIOM_IDS = IDIOMS.map((i) => i.id);

/** The idiom an id names, or undefined. */
export function idiomById(id: string): Idiom | undefined {
  return IDIOMS.find((i) => i.id === id);
}

/** A step realized in a key: its chord, and the cell of the key's seven it is drawn on. */
export interface PathStep {
  chord: Chord;
  /** The degree whose cell shows it, or null when its root is not the key's. */
  cell: number | null;
  /** `exact`: the key's own chord on that cell; `root`: another chord on its root. */
  fit: 'exact' | 'root' | null;
}

/** The chord a step names in a key. */
export function stepChord(step: IdiomStep, key: Key): Chord {
  if (step.of !== undefined) return chordOfFunction({ degree: 4, of: step.of }, key);
  const own = diatonicChords(key)[((step.degree % 7) + 7) % 7];
  return step.quality ? { root: own.root, quality: step.quality } : own;
}

/** An idiom realized in a key, step by step. */
export function idiomPath(idiom: Idiom, key: Key): PathStep[] {
  const chords = diatonicChords(key);
  return idiom.steps.map((step) => {
    const chord = stepChord(step, key);
    const cell = chords.findIndex((c) => c.root === chord.root);
    if (cell < 0) return { chord, cell: null, fit: null };
    return { chord, cell, fit: chords[cell].quality === chord.quality ? 'exact' : 'root' };
  });
}

// ---- Following ------------------------------------------------------------------------------

/** Where a player is on a path: the step last confirmed (-1 before the first), whether the last
 *  commit kept to the path, and how many commits rejoined it further along (a skip). */
export interface FollowCursor {
  position: number;
  onPath: boolean;
  skips: number;
}

export const startFollow = (): FollowCursor => ({ position: -1, onPath: true, skips: 0 });

/** The step after `position`, wrapping when the idiom loops, or null at the end. */
function nextIndex(idiom: Idiom, position: number): number | null {
  const n = idiom.steps.length;
  if (n === 0) return null;
  if (position + 1 < n) return position + 1;
  return idiom.loops ? 0 : null;
}

/**
 * The cursor after the player commits the chord on `cell` (a degree of the map): the next step's
 * cell advances; the current step's cell keeps the cursor; a cell further along rejoins at the
 * first step on it (counted as a skip); any other leaves the path with the cursor where it was.
 */
export function followCommit(idiom: Idiom, key: Key, cursor: FollowCursor, cell: number): FollowCursor {
  const path = idiomPath(idiom, key);
  const n = path.length;
  if (n === 0) return { ...cursor, onPath: false };
  const next = nextIndex(idiom, cursor.position);
  if (next !== null && path[next].cell === cell) return { position: next, onPath: true, skips: cursor.skips };
  if (cursor.position >= 0 && path[cursor.position].cell === cell) return { ...cursor, onPath: true };
  // Look further along, once round when it loops, to the end when it does not.
  const reach = idiom.loops ? n - 1 : n - 1 - cursor.position;
  let at = cursor.position;
  for (let k = 1; k <= reach; k++) {
    const i = nextIndex(idiom, at);
    if (i === null) break;
    at = i;
    if (k > 1 && path[i].cell === cell) return { position: i, onPath: true, skips: cursor.skips + 1 };
  }
  return { ...cursor, onPath: false };
}

/** The next `count` steps from the cursor (what the ghost trail draws), in order; fewer at the
 *  end of a path that does not loop. */
export function ahead(idiom: Idiom, key: Key, cursor: FollowCursor, count: number): PathStep[] {
  const path = idiomPath(idiom, key);
  const out: PathStep[] = [];
  let at = cursor.position;
  for (let k = 0; k < count; k++) {
    const i = nextIndex(idiom, at);
    if (i === null) break;
    out.push(path[i]);
    at = i;
  }
  return out;
}

/** The step the path suggests next, or null at its end. */
export function suggested(idiom: Idiom, key: Key, cursor: FollowCursor): PathStep | null {
  return ahead(idiom, key, cursor, 1)[0] ?? null;
}
