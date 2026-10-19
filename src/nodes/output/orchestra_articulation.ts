/**
 * Articulation as a program change (#332): a sharp conducting stroke plays the strings pizzicato
 * (GM 45, in the cut bank since #334), a smooth one bowed again. Pure, with the hysteresis the
 * switch needs: a program change mid-phrase is audible, so the stroke must be clearly sharp to go
 * pizzicato, clearly smooth to come back, and each state is kept for a minimum time. Notes already
 * sounding are not touched (a program change reaches the notes that start after it).
 *
 * Gated by the `conductor.orchestra.pizzicato` dial (off by default: the rule only changes what is
 * heard when the player turns it on). Whether it sounds right needs ears (#146).
 */

/** The GM program (zero-based) of the pizzicato strings. */
export const PIZZICATO_PROGRAM = 45;

/** The bowed string programs the rule applies to: violin, viola, cello, contrabass and the two
 *  ensembles. (Not the harp, the tremolo or the pizzicato patch itself.) */
const BOWED_PROGRAMS: ReadonlySet<number> = new Set([40, 41, 42, 43, 48, 49]);

/** The program a channel plays when pizzicato is on, else its own. */
export function articulatedProgram(program: number, pizzicato: boolean): number {
  return pizzicato && BOWED_PROGRAMS.has(program) ? PIZZICATO_PROGRAM : program;
}

export const ARTICULATION_SWITCH_DEFAULTS = {
  /** Articulation (0 legato .. 1 staccato) at or above which the strings go pizzicato. */
  on: 0.8,
  /** ... and at or below which they come back to the bow. Below `on`: the band between is the hysteresis. */
  off: 0.55,
  /** The shortest time either state is kept, seconds, so a stroke on the line cannot chatter. */
  holdS: 1,
} as const;

export interface ArticulationSwitch {
  /** One reading of the conductor's articulation at engine time `t`; whether pizzicato is on after it. */
  step(articulation: number, t: number): boolean;
  readonly pizzicato: boolean;
  /** Back to bowed, as at the start of a piece. */
  reset(): void;
}

export function createArticulationSwitch(options: Partial<typeof ARTICULATION_SWITCH_DEFAULTS> = {}): ArticulationSwitch {
  const o = { ...ARTICULATION_SWITCH_DEFAULTS, ...options };
  let pizz = false;
  let since = -Infinity;
  return {
    step(articulation, t) {
      if (!Number.isFinite(articulation)) return pizz;
      if (t - since < o.holdS) return pizz;
      if (!pizz && articulation >= o.on) {
        pizz = true;
        since = t;
      } else if (pizz && articulation <= o.off) {
        pizz = false;
        since = t;
      }
      return pizz;
    },
    get pizzicato() {
      return pizz;
    },
    reset() {
      pizz = false;
      since = -Infinity;
    },
  };
}
