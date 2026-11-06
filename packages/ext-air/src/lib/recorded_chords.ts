/**
 * The air guitar's shipped chord shapes: measured on a player's recorded take, so the guitar
 * plays out of the box instead of starting silent until chords are enrolled.
 *
 * What ships is a SUMMARY, not frames: per chord the mean and the standard deviation of each
 * shape feature (the fretting hand's joint angles, spreads and span-normalised distances,
 * `hand_shape.ts`). The closed-set classifier reads only the means and the spreads pooled
 * over the chords (`trainVocabulary`: nearest centroid, distances in units of the pooled hold
 * jitter); each chord's own spread is what the enrolment list's "too close" warning reads. The recordings themselves are private; the numbers are made
 * by `scripts/air/recorded_chord_shapes.ts`, with how well they name the chords measured there
 * on frames held out of their making.
 *
 * The vocabulary's samples stay the SSOT of the classifier (`vocabulary.ts`), so the summary is
 * turned back into samples: {@link SEED_SAMPLES} points per chord, each the centroid moved by
 * a·sd up or down each feature, with signs from a Hadamard matrix's columns, so every chord's
 * samples have exactly its means and its standard deviations. Trained, they give the classifier the summary describes; a chord the player
 * enrols again replaces its seed entry like any other.
 *
 * A label may carry a voicing number, `G (2)`: a second way of holding the same chord, which
 * is its own shape to the classifier and plays the same chord ({@link chordOfLabel}).
 *
 * Pure and Node-safe.
 */
import { parseChordName } from '@thoremin/sdk/music/guitar';
import type { Vocabulary } from './vocabulary';
import recorded from './recorded_chords.json';

/** The shipped summary: what the derivation script writes. */
export interface RecordedChordSummary {
  /** The feature ids, in order (`chordShapeFeatureIds()` when it was made). */
  features: string[];
  /** Per chord: its label, and the mean and standard deviation of each feature it was
   *  measured on, over `frames` frames. */
  chords: { label: string; centroid: Record<string, number>; spread: Record<string, number>; frames: number }[];
  /** Where the numbers come from and how well they do; read by the docs and the panel. */
  source: { take: string; player: string; recordedOn: string; method: string };
  heldOut: { frames: number; chordAccuracy: number; shapeAccuracy: number; note: string };
}

export const RECORDED_CHORDS = recorded as RecordedChordSummary;

/** Rows of the 8×8 Sylvester-Hadamard matrix: every column but the first is balanced (four
 *  +1, four -1) and the columns are orthogonal. */
const H8 = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => (popcount(r & c) % 2 === 0 ? 1 : -1)));
function popcount(x: number): number {
  let n = 0;
  for (; x; x >>= 1) n += x & 1;
  return n;
}

/** Samples per seeded chord (at least `MIN_SAMPLES_PER_ENTRY`). */
export const SEED_SAMPLES = 8;
/** The step that makes eight ±a·sd points have a sample standard deviation (n - 1) of sd. */
const STEP = Math.sqrt((SEED_SAMPLES - 1) / SEED_SAMPLES);
const DECIMALS = 1e4;

/** A summary as a vocabulary whose samples reproduce its centroids and spread exactly. */
export function vocabularyFromSummary(summary: RecordedChordSummary): Vocabulary {
  return {
    features: [...summary.features],
    entries: summary.chords.map(({ label, centroid, spread }) => ({
      label,
      samples: H8.map((row) => {
        const s: Record<string, number> = {};
        summary.features.forEach((f, i) => {
          const c = centroid[f];
          if (c === undefined || !Number.isFinite(c)) return;
          const sign = row[1 + (i % 7)];
          s[f] = Math.round((c + sign * STEP * (spread[f] ?? 0)) * DECIMALS) / DECIMALS;
        });
        return s;
      }),
    })),
  };
}

/** The guitar's starting vocabulary: the recorded chords. */
export const recordedChordVocabulary = (): Vocabulary => vocabularyFromSummary(RECORDED_CHORDS);

const VOICING = /^(.*?)\s*\((\d+)\)\s*$/;

/** The chord a label plays: `G (2)` (a second voicing) plays G. */
export function chordOfLabel(label: string): string {
  const m = VOICING.exec(label);
  return m ? m[1] : label;
}

/** A typed chord label in the guitar's canonical spelling (`gmaj (2)` is `G (2)`), or null
 *  when its chord is not one the guitar can voice. */
export function canonicalChordLabel(typed: string): string | null {
  const m = VOICING.exec(typed);
  const name = parseChordName(m ? m[1] : typed)?.name ?? null;
  if (!name) return null;
  return m && Number(m[2]) > 1 ? `${name} (${Number(m[2])})` : name;
}
