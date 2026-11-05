/**
 * A commit gate: a reading that changes (a chord letter signed, a chord heard) takes effect
 * only once it has been read for long enough, so a passing reading (a shape on the way from
 * one sign to the next, a hand that is not playing read as a letter for a few frames) does not.
 *
 * Two rules, one gate:
 *
 * - **dwell**: the reading commits after `dwellS` seconds of being read without a break;
 * - **evidence** (optional): it commits sooner when the reader is sure of it. Each push says how
 *   far above its naming threshold the reading is (its margin, {@link labelMargin}); once the
 *   margin summed over the seconds the reading lasts reaches `evidence`, it commits. A clear
 *   reading builds that sum in a few frames; a marginal one (just over the threshold) barely
 *   builds it and waits for the dwell, which stays the longest wait.
 *
 * Measured on real hands (thoremin-asl's ASL Chords, `evidence` 0.02, `dwellS` 0.2): on the
 * player's own take the chord follows the label a median 0.10 s after it appears instead of
 * 0.23 s, and a choir conductor's hand, read as a weak C (0.48 to 0.56 for six frames over a
 * 0.45 threshold), still plays nothing (its sum stops at 0.015).
 *
 * Pure, no clock of its own: the caller passes the time.
 */

export interface CommitGateOptions<T> {
  /** Seconds a reading must last to commit: the longest wait. */
  dwellS: number;
  /** Margin times seconds that commits a reading sooner (e.g. 0.02: 0.1 s of a reading 0.2 over
   *  its threshold); 0 or absent: the dwell alone. */
  evidence?: number | null;
  /** Whether two readings are the same one (default `Object.is`). */
  same?: (a: T, b: T) => boolean;
  /** Slack on the dwell, seconds: a dwell of exactly k frames commits on the k-th frame despite
   *  floating-point rounding (default 0: the strict comparison the chord follower always made). */
  slackS?: number;
}

export interface CommitGate<T> {
  /** The reading at `now` seconds (null: nothing read) and its margin over its threshold (0..1,
   *  default 0: no evidence, the dwell alone): true once it has lasted long enough to commit, and
   *  on every later push of it. */
  push(read: T | null, now: number, margin?: number): boolean;
  /** Forget the reading being timed. */
  reset(): void;
}

/** A gate that times one reading at a time; a different reading starts it over. */
export function createCommitGate<T>({ dwellS, evidence = null, same = Object.is, slackS = 0 }: CommitGateOptions<T>): CommitGate<T> {
  let candidate: T | null = null;
  let since = 0;
  let last = 0;
  let sum = 0;
  return {
    push(read, now, margin = 0) {
      if (read === null) {
        candidate = null;
        return false;
      }
      if (candidate === null || !same(read, candidate)) {
        candidate = read;
        since = last = now;
        sum = 0;
      } else if (now > last) {
        // A frame repeated or out of order adds nothing (and is not counted twice later).
        sum += Math.max(0, margin) * (now - last);
        last = now;
      }
      return now - since >= dwellS - slackS || (!!evidence && evidence > 0 && sum >= evidence - 1e-12);
    },
    reset() {
      candidate = null;
    },
  };
}

/** What {@link labelMargin} reads: a sign or category reading (`CategoryScores`, ASL's `SignScores`). */
export interface ScoredReading {
  label: string | null;
  labels: readonly string[];
  scores: readonly number[];
  /** The score a class needs to be named; absent: the reader does not say, so no margin. */
  floor?: number;
  /** The reading was kept through a short loss of the input: nothing new was read. */
  held?: boolean;
}

/** How far the named class's score is above the reader's threshold: a commit gate's evidence.
 *  0 when nothing is named, the reading is held over a lost frame, or the reader gives no threshold. */
export function labelMargin(r: ScoredReading | null | undefined): number {
  if (!r?.label || r.held || r.floor === undefined) return 0;
  const score = r.scores[r.labels.indexOf(r.label)];
  return score === undefined ? 0 : Math.max(0, score - r.floor);
}
