/**
 * The conductor's dancer-lead state (split from `conductor.ts`, #557): the dance lead
 * itself, the relation the last one followed (kept across a switch of leader, #506) and the
 * last pulse cycle already handed to the expression. The beat arithmetic stays in the node;
 * this only owns what outlives a tick.
 */
import { createDanceLead, type Anchor, type DanceLead, type PulseState } from '@thoremin/ictus';

export interface DanceState {
  /** The lead in charge, or null while another source leads. */
  readonly lead: DanceLead | null;
  /** Make the lead on first use, starting from `beat`; a relation the last lead followed is
   *  carried into it, so the dancer chosen again and related the same way re-starts on its
   *  next cycle with no new persistence (#506). Returns the lead in charge. */
  enter(beat: number): DanceLead;
  /** Another source leads: remember the relation the lead FOLLOWED (never a candidate still
   *  persisting), and let the lead go. */
  leave(): void;
  /** The conductor is off: the lead and the remembered relation are forgotten. */
  forget(): void;
  /** The dancer's "stroke" for the expression (A6's note): the cycle the follower fitted,
   *  once per cycle, else null. */
  cycle(pulse: PulseState): Anchor | null;
}

export function createDanceState(): DanceState {
  let dance: DanceLead | null = null;
  /** Checked against the marked tempo in force on return (a new piece relates afresh);
   *  forgotten when the conductor is switched off. */
  let danceRatio: number | null = null;
  let lastCycleAt: number | undefined;
  return {
    get lead() {
      return dance;
    },
    enter(beat) {
      if (!dance) {
        dance = createDanceLead();
        dance.reset(beat, danceRatio !== null ? { ratio: danceRatio } : undefined);
        lastCycleAt = undefined;
      }
      return dance;
    },
    leave() {
      const r = dance?.followed();
      if (r !== undefined && r !== null && Number.isFinite(r) && r > 0) danceRatio = r;
      dance = null;
    },
    forget() {
      dance = null;
      danceRatio = null;
    },
    cycle(pulse) {
      if (pulse.lastAnchorAt === undefined || pulse.lastAnchorAt === lastCycleAt) return null;
      lastCycleAt = pulse.lastAnchorAt;
      return { t: pulse.lastAnchorAt, confidence: pulse.confidence, strength: 1, sharpness: NaN, lateral: 0 };
    },
  };
}
