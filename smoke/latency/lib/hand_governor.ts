/**
 * A CANDIDATE policy for which hand a one-hand instrument gets when both are in view (#634,
 * #480 item 3), measured by `../hand_choice.mjs` and not wired into the app: on the conducting
 * clip it kept the right hand but gave back the whole saving of looking for one hand (see
 * `docs/research/latency-budget-and-browser-realtime.md`). Kept beside the tool so a real-GPU
 * run (#146) measures the same policy.
 *
 * Told to look for one hand (#325, #168 D13), the hand landmarker tracks whichever hand it
 * found first and skips the palm search while it holds it: about 40 % of a frame's cost. With
 * both hands in view it may hold the wrong one. While the host wants one hand and names the side
 * it prefers, the governor ESCALATES to two hands whenever the hand tracked is not that side,
 * and drops back to one once the preferred hand has been `alone` (or merely `present`) for
 * `dropAfterResults` results in a row.
 *
 * Fed once per RESULT, with the raw handedness labels. Pure.
 */

/** MediaPipe's raw handedness label. */
export type HandLabel = 'Left' | 'Right';

export interface HandGovernorOptions {
  /** Results in a row with the preferred hand alone before dropping back to one hand
   *  (about half a second of camera frames). */
  dropAfterResults?: number;
  /** When an escalated governor counts toward dropping back: the preferred hand `alone`
   *  (the landmarker then can only hold it), or merely `present` beside the other (a rebuilt
   *  one-hand graph searches again and may find the wrong one, escalating again). */
  dropWhen?: 'alone' | 'present';
}

export interface HandGovernor {
  /** One result: the count the host wants, the side it prefers (null: none), and the labels of
   *  the hands found. Updates whether the governor is escalated. */
  observe(input: { wanted: number; prefer: HandLabel | null; labels: readonly string[] }): void;
  /** The count to look for, given the host's: two while escalated from one, the host's otherwise. */
  count(wanted: number): number;
  /** Whether a one-hand request is running at two hands now. */
  readonly escalated: boolean;
  reset(): void;
}

export const DEFAULT_DROP_AFTER_RESULTS = 15;

export function createHandGovernor({ dropAfterResults = DEFAULT_DROP_AFTER_RESULTS, dropWhen = 'alone' }: HandGovernorOptions = {}): HandGovernor {
  let escalated = false;
  let alone = 0;
  return {
    observe({ wanted, prefer, labels }) {
      if (wanted !== 1 || prefer === null) {
        escalated = false;
        alone = 0;
        return;
      }
      if (!escalated) {
        if (labels.length > 0 && !labels.includes(prefer)) {
          escalated = true;
          alone = 0;
        }
        return;
      }
      const counts = dropWhen === 'alone' ? labels.length === 1 && labels[0] === prefer : labels.includes(prefer);
      alone = counts ? alone + 1 : 0;
      if (alone >= dropAfterResults) {
        escalated = false;
        alone = 0;
      }
    },
    count: (wanted) => (wanted === 1 && escalated ? 2 : wanted),
    get escalated() {
      return escalated;
    },
    reset() {
      escalated = false;
      alone = 0;
    },
  };
}
