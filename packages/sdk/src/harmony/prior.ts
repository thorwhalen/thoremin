/**
 * A transition prior: how likely each next chord is from the one in force (H10 of #613,
 * `docs/design/harmonic-layers.md` §3 and choice 3 of #614). Theory first: Walter Piston's
 * "table of usual root progressions" (Harmony, 1941), which a harmony class still teaches, needs
 * no corpus and raises no licence question. Each degree is followed USUALLY by some degrees,
 * SOMETIMES by others, LESS OFTEN by the rest it names; a degree it does not name is rare.
 *
 * The table is Piston's for major; a minor key reads it by degree as a choice (VII to III reads
 * as vii° to iii), which keeps one table until a minor-mode prior earns its place.
 *
 * Like tension, a prior is a model and is named wherever it orders anything: a corpus prior
 * (an open one whose licence is confirmed) is the other implementation this seam waits for.
 * Pure.
 */

export const PRIOR_IDS = ['piston'] as const;
export type PriorId = (typeof PRIOR_IDS)[number];

export interface TransitionPrior {
  id: PriorId;
  /** The name an ordering shows. */
  name: string;
  /** How likely degree `to` follows degree `from` (0-based, in a seven-note key): larger is
   *  likelier; only the order matters. */
  weight(from: number, to: number): number;
}

/** Piston's three words as weights; a progression the table does not name. */
const USUALLY = 3;
const SOMETIMES = 2;
const LESS_OFTEN = 1;
const RARELY = 0;

/** Piston's table, by degree (I = 0): [usually, sometimes, less often]. */
const PISTON: readonly [readonly number[], readonly number[], readonly number[]][] = [
  [[3, 4], [5], [1, 2]], // I: IV or V, sometimes vi, less often ii or iii
  [[4], [3, 5], [0, 2]], // ii: V, sometimes IV or vi, less often I or iii
  [[5], [3], [1, 4]], // iii: vi, sometimes IV, less often ii or V
  [[4], [0, 1], [2, 5]], // IV: V, sometimes I or ii, less often iii or vi
  [[0], [3, 5], [1, 2]], // V: I, sometimes IV or vi, less often ii or iii
  [[1, 4], [2, 3], [0]], // vi: ii or V, sometimes iii or IV, less often I
  [[2], [0], []], // vii°: iii, sometimes I
];

const piston: TransitionPrior = {
  id: 'piston',
  name: "Piston's usual root progressions",
  weight(from, to) {
    const row = PISTON[((from % 7) + 7) % 7];
    if (row[0].includes(to)) return USUALLY;
    if (row[1].includes(to)) return SOMETIMES;
    if (row[2].includes(to)) return LESS_OFTEN;
    return RARELY;
  },
};

export const TRANSITION_PRIORS: Readonly<Record<PriorId, TransitionPrior>> = { piston };

/**
 * Indices ordered most likely first: `targets[i]` is the degree item i leads to (null: it leaves
 * the key, or does not apply), ranked by the prior from `from`; ties keep their given order, and
 * a target outside the key goes last. The ranked ("next chord") wheel puts the first on top.
 */
export function rankByPrior(prior: TransitionPrior, from: number, targets: readonly (number | null)[]): number[] {
  const w = (t: number | null) => (t === null ? -1 : prior.weight(from, t));
  return targets.map((_, i) => i).sort((a, b) => w(targets[b]) - w(targets[a]) || a - b);
}

/** The likeliest weight a prior gives (Piston's "usually") and its least (unnamed). */
const MAX_WEIGHT = 3;
const MIN_WEIGHT = 0;

/**
 * Indices ordered by surprise (#672, the design's 6.2): 0 puts the likeliest first (as
 * `rankByPrior`), 1 the least likely, and a value between puts first the moves whose likelihood
 * is nearest the target that much of the way down: at a half, the "sometimes" and "less often"
 * progressions, where listeners' pleasure peaks between the expected and the strange (Cheung et
 * al., 2019). Ties keep their given order; a target outside the key still goes last.
 */
export function rankBySurprise(prior: TransitionPrior, from: number, targets: readonly (number | null)[], surprise: number): number[] {
  const s = Math.max(0, Math.min(1, Number.isFinite(surprise) ? surprise : 0));
  const want = MAX_WEIGHT - s * (MAX_WEIGHT - MIN_WEIGHT);
  const distance = (t: number | null) => (t === null ? Infinity : Math.abs(prior.weight(from, t) - want));
  return targets.map((_, i) => i).sort((a, b) => distance(targets[a]) - distance(targets[b]) || a - b);
}
