/**
 * A classifier's live reading on the DAG's edges. Part of the domain types (`../domain.ts`
 * re-exports it).
 */

/**
 * A classifier's live reading, in the one shape the overlay's category cues draw: a score
 * per class, the class currently named, and how to write it. Any recogniser can emit it
 * (the ASL sign reader is the first); the overlay draws the named class large
 * (`categoryLabel`) and every class as a bar (`categoryBars`).
 */
export interface CategoryScores {
  /** Something is being read (a hand in view). */
  present: boolean;
  /** The class currently named, or null. */
  label: string | null;
  /** How the named class is written large ("THANK YOU"); defaults to `label`. */
  text?: string;
  /** Every class's short bar label, in bar order. */
  labels: readonly string[];
  /** 0..1 per class, aligned with `labels`. */
  scores: readonly number[];
  /** Each class's id, aligned with `labels`, when the reader has ids (a player's categorizer): what
   *  a per-category setting is keyed by (#372). */
  ids?: readonly string[];
  /** A small title over the bars ("ASL"). */
  title?: string;
}
