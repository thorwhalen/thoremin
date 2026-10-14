/**
 * Which of several channels a pulse follower should be listening to (#416): the
 * selector behind `body-pulse`'s `auto` channel. Every channel has its own follower
 * running all the time; this picks whose state to publish.
 *
 * The rule is the pace controller's persistence (#339 item 2) applied to a choice
 * instead of a ratio: the leader keeps the lead until a challenger has scored above it
 * by a margin for `switchAfterS` without a break; the first trusted channel is taken at
 * once (nothing to hold on to yet), and a leader that stops being trusted is replaced
 * only by a trusted challenger, after the same persistence (the pace controller holds
 * through an untrusted spell, so a brief dropout costs nothing). The score is the
 * follower's ACF strength while its state is trusted, 0 otherwise, so a channel that
 * only reaches the floor in red noise never scores. Pure and causal.
 */

export interface PulseSelectorOptions {
  /** How long a challenger must keep leading before it takes over, seconds. */
  switchAfterS?: number;
  /** How far (in strength) a challenger must beat the leader. */
  margin?: number;
}

export const PULSE_SELECT_DEFAULTS = { switchAfterS: 3, margin: 0.05 } as const;

export interface PulseSelector<Id extends string = string> {
  /** One update: the score of each channel (0 = untrusted) at time `t`. Returns the
   *  channel to follow, or null while none has ever been trusted. */
  update(t: number, scores: Readonly<Record<Id, number>>): Id | null;
  leader(): Id | null;
  reset(): void;
}

export function createPulseSelector<Id extends string = string>(options: PulseSelectorOptions = {}): PulseSelector<Id> {
  const o = { ...PULSE_SELECT_DEFAULTS, ...options };
  let leader: Id | null = null;
  let challenger: { id: Id; since: number } | null = null;
  return {
    update(t, scores) {
      const ids = Object.keys(scores) as Id[];
      let best: Id | null = null;
      for (const id of ids) if (scores[id] > 0 && (best === null || scores[id] > scores[best])) best = id;
      if (leader === null) {
        leader = best;
        return leader;
      }
      const own = scores[leader] ?? 0;
      // The challenger is the best channel other than the leader that beats it by the margin.
      let top: Id | null = null;
      for (const id of ids) if (id !== leader && scores[id] > 0 && scores[id] > own + o.margin && (top === null || scores[id] > scores[top])) top = id;
      if (top === null) {
        challenger = null;
      } else if (challenger === null || challenger.id !== top) {
        challenger = { id: top, since: t };
      } else if (t - challenger.since >= o.switchAfterS) {
        leader = top;
        challenger = null;
      }
      return leader;
    },
    leader: () => leader,
    reset() {
      leader = null;
      challenger = null;
    },
  };
}
