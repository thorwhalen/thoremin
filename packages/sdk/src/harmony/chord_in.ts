/**
 * Chord in: the chord someone else holds becomes the harmony (H8 of #613, `docs/design/
 * harmonic-layers.md` §6.5, "MIDI or audio chooses, the camera performs"). The held notes come
 * from a MIDI keyboard (or, later, a microphone's chroma); this module turns a stream of held
 * note sets into a chord:
 *
 * - `chordOfPitchClasses`: the chord a set of pitch classes spells in ANY inversion or spacing:
 *   each held pitch class is tried as the root, and the reading that accounts for the most held
 *   notes wins (E-G-B-C is Cmaj7, not E minor with a stray C), the bass breaking a tie; so E-G-C
 *   reads C, not the "E with a sixth" the bass-is-root rule would give;
 * - `createChordFollower`: a chord commits once the held set has stayed the same chord for a
 *   dwell (a passing tone or a hand changing shape note by note never flickers the harmony), and
 *   holds while the keys are released (a pianist lifts between chords); a new chord replaces it.
 *   A reader that says how sure it is (a signed letter's score) can commit a sure chord sooner
 *   (`evidence`, `util/commit_gate`).
 *
 * Pure: no Web MIDI, no audio.
 */
import { QUALITIES, qualityOfIntervals } from './qualities';
import { createCommitGate } from '../util/commit_gate';
import type { Chord } from './chord';

const pc = (n: number): number => ((Math.round(n) % 12) + 12) % 12;

/** The chord the held notes spell, any inversion (null: fewer than two pitch classes, or none). */
export function chordOfPitchClasses(midis: readonly number[]): Chord | null {
  const pcs = [...new Set(midis.map(pc))];
  if (pcs.length < 2) return null;
  const bass = midis.length ? pc(Math.min(...midis)) : pcs[0];
  // The reading that explains the most held notes; the bass first on a tie.
  const roots = [bass, ...pcs.filter((p) => p !== bass)];
  let best: Chord | null = null;
  let covered = 0;
  for (const root of roots) {
    const quality = qualityOfIntervals(pcs.map((p) => p - root));
    if (!quality || quality === '5') continue;
    const n = QUALITIES[quality].intervals.length;
    if (n > covered) {
      best = { root, quality };
      covered = n;
    }
  }
  return best;
}

export interface ChordFollowerOptions {
  /** Seconds a new chord must be held before it is the harmony; with `evidence`, the longest wait. */
  dwellS: number;
  /** Commit a chord read with a margin sooner (`pushChord`'s `margin`, `util/commit_gate`); absent: the dwell alone. */
  evidence?: number | null;
}

export interface ChordFollower {
  /** The notes held now (MIDI numbers) at `now` seconds: the chord in force, or null before any. */
  push(held: readonly number[], now: number): Chord | null;
  /** A chord read some other way (a microphone's chroma, a signed letter; null: nothing clear),
   *  with the same dwell, and how far the reading is above its reader's threshold (absent: no
   *  evidence, the dwell alone). */
  pushChord(read: Chord | null, now: number, margin?: number): Chord | null;
  reset(): void;
}

const same = (a: Chord | null, b: Chord | null): boolean => (a === null ? b === null : b !== null && a.root === b.root && a.quality === b.quality);

export function createChordFollower({ dwellS, evidence = null }: ChordFollowerOptions): ChordFollower {
  let current: Chord | null = null;
  const gate = createCommitGate<Chord>({ dwellS, evidence, same });
  const step = (read: Chord | null, now: number, margin?: number): Chord | null => {
    // Released keys, or a shape that is not a chord yet: the harmony stays.
    if (!read || same(read, current)) {
      gate.reset();
      return current;
    }
    if (gate.push(read, now, margin)) {
      current = read;
      gate.reset();
    }
    return current;
  };
  return {
    push: (held, now) => step(chordOfPitchClasses(held), now),
    pushChord: step,
    reset() {
      current = null;
      gate.reset();
    },
  };
}
