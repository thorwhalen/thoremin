/**
 * The level relation: which metrical level a leader marks, against a target's beat
 * (#376, body-movement A4; the design's §3.5; absorbs #364 item 2).
 *
 * A leader (a dancer's pulse, a conductor's strokes) and a target (a song's tracked beat,
 * a score's marked tempo) each have a period, and nothing says they count the same
 * level: a dancer's stride repeats once a bar, a body conductor may bounce every other
 * beat, a beat tracker may lock at double time. The two are related by a RATIO chosen
 * from a stated set, `ratio` = target beats per leader beat, and the ratio chosen is the
 * one whose matching `rate` (`ratio * targetPeriod / leaderPeriod`: the factor the
 * target's tempo must be scaled by for one leader beat to be `ratio` target beats) is
 * nearest `base` in log terms. A ratio further than `captureRange` from `base` is no
 * relation at all.
 *
 * Two leaders, two ratio sets, one function:
 *
 * - the dancer's `1..8` and `1/2..1/8` ({@link paceRatios}): integers, never an octave
 *   fold (the Que Calor stride is four beats, the head six);
 * - a conductor's `{1/2, 1, 2}`, plus `beatsPerBar` when the player marks bars
 *   ({@link conductorRatios}).
 *
 * {@link relateLevel} is the instantaneous relation. {@link createLevelHold} holds one
 * over time: a relation is followed only once it has persisted `persistS` (the first one
 * and every change; the red-noise guard of #339), and with `sticky` the followed ratio
 * is kept while it is still in capture even when another one is nearer (a conductor at
 * 70 % of the marked tempo is conducting slowly, not at double time).
 *
 * Pure, causal and clock-free like the rest of ictus: the caller passes the time.
 */

/** The instantaneous relation: the ratio, and the rate that matches the two periods. */
export interface LevelMatch {
  /** Target beats per leader beat. */
  ratio: number;
  /** `ratio * targetPeriod / leaderPeriod`: the factor the target's tempo must be scaled
   *  by (1 = the two already agree at this ratio). */
  rate: number;
}

export interface RelateLevelOptions {
  /** The ratios tried, target beats per leader beat. Order breaks a tie (the first wins). */
  ratios: readonly number[];
  /** A ratio whose rate is further than this from `base` (a fraction) is no relation.
   *  Infinity (the default): the nearest always relates. */
  captureRange?: number;
  /** The rate the relation should be nearest: the target's own tempo (1) by default, the
   *  player's chosen tempo for a song (`songPrefs.rate`). */
  base?: number;
}

/** The dancer's ratio set: `1..maxRatio`, then `1/2..1/maxRatio`. */
export function paceRatios(maxRatio: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= maxRatio; k++) out.push(k);
  for (let k = 2; k <= maxRatio; k++) out.push(1 / k);
  return out;
}

/** A conductor's ratio set: `{1, 1/2, 2}` and, when given, `beatsPerBar` (deduplicated).
 *  The beat first, so it wins a tie. */
export function conductorRatios(beatsPerBar?: number): number[] {
  const out = [1, 0.5, 2];
  if (beatsPerBar !== undefined && beatsPerBar > 0 && !out.includes(beatsPerBar)) out.push(beatsPerBar);
  return out;
}

const logDistance = (rate: number, base: number): number => Math.abs(Math.log(rate / base));

/** Whether a rate is within `captureRange` of `base`. */
export function inCapture(rate: number, base: number, captureRange: number): boolean {
  return logDistance(rate, base) <= Math.log(1 + captureRange);
}

/**
 * The ratio relating a leader's period to a target's, and the rate that matches them: the
 * ratio whose rate is nearest `base` (in log terms), or null when even that one is further
 * than `captureRange` from it (or a period is not a positive number). Both periods are
 * seconds per beat at their own level; `targetPeriod` is the target's OWN (a song's at
 * rate 1).
 */
export function relateLevel(leaderPeriod: number, targetPeriod: number, opts: RelateLevelOptions): LevelMatch | null {
  const base = opts.base ?? 1;
  if (!(leaderPeriod > 0) || !(targetPeriod > 0) || !(base > 0) || !Number.isFinite(leaderPeriod) || !Number.isFinite(targetPeriod)) return null;
  let best: { ratio: number; rate: number; d: number } | null = null;
  for (const ratio of opts.ratios) {
    if (!(ratio > 0)) continue;
    const rate = (ratio * targetPeriod) / leaderPeriod;
    const d = logDistance(rate, base);
    if (!best || d < best.d) best = { ratio, rate, d };
  }
  const capture = opts.captureRange ?? Infinity;
  return best && best.d <= Math.log(1 + capture) ? { ratio: best.ratio, rate: best.rate } : null;
}

export interface LevelHoldOptions extends RelateLevelOptions {
  /** Seconds a relation must persist, related and unchanged, before it is followed. */
  persistS?: number;
  /** Whether the FIRST relation also has to persist (true) or is followed at once (a
   *  servo that must choose when the leader starts). Every later change persists. */
  persistFirst?: boolean;
  /** Keep the followed ratio while it is still in capture, even when another is nearer. */
  sticky?: boolean;
}

/**
 * - `waiting`: nothing related, and nothing followed yet.
 * - `locking`: a first relation is persisting, not yet followed.
 * - `following`: the followed ratio relates now.
 * - `switching`: following, and a DIFFERENT ratio is persisting.
 * - `holding`: was following; nothing relates now, so the followed ratio holds.
 */
export type LevelMode = 'waiting' | 'locking' | 'following' | 'switching' | 'holding';

export interface LevelHoldState {
  mode: LevelMode;
  /** The ratio followed (null before any). */
  ratio: number | null;
  /** This step's relation: the followed one while `following`, the persisting one while
   *  `locking` / `switching`, null otherwise. */
  match: LevelMatch | null;
  /** True on the step a ratio was adopted (the first one, or a change). */
  adopted: boolean;
}

export interface LevelHold {
  /** One observation. A leader period that is not a positive number (an untrusted
   *  leader) relates nothing; the followed ratio holds. `base` and `captureRange`
   *  override the options for this step (a player's live tempo and follow range). */
  step(t: number, leaderPeriod: number, targetPeriod: number, live?: { base?: number; captureRange?: number }): LevelHoldState;
  /** The ratio followed (null before any). */
  ratio(): number | null;
  /** Follow `ratio` at once (a stated level), or forget it (null). */
  set(ratio: number | null): void;
  reset(): void;
}

export const LEVEL_HOLD_DEFAULTS = { persistS: 3, persistFirst: true, sticky: false } as const;

export function createLevelHold(options: LevelHoldOptions): LevelHold {
  const o = { ...LEVEL_HOLD_DEFAULTS, ...options };
  let followed: number | null = null;
  let candidate: { ratio: number; since: number } | null = null;

  const unrelated = (): LevelHoldState => {
    candidate = null;
    return { mode: followed === null ? 'waiting' : 'holding', ratio: followed, match: null, adopted: false };
  };

  return {
    step(t, leaderPeriod, targetPeriod, live = {}) {
      const base = live.base ?? o.base ?? 1;
      const captureRange = live.captureRange ?? o.captureRange ?? Infinity;
      const opts = { ratios: o.ratios, captureRange, base };
      let rel = relateLevel(leaderPeriod, targetPeriod, opts);
      if (!rel) return unrelated();
      if (o.sticky && followed !== null && rel.ratio !== followed) {
        const kept = (followed * targetPeriod) / leaderPeriod;
        if (inCapture(kept, base, captureRange)) rel = { ratio: followed, rate: kept };
      }
      if (rel.ratio === followed) {
        candidate = null;
        return { mode: 'following', ratio: followed, match: rel, adopted: false };
      }
      if (followed === null && !o.persistFirst) {
        followed = rel.ratio;
        candidate = null;
        return { mode: 'following', ratio: followed, match: rel, adopted: true };
      }
      if (candidate?.ratio !== rel.ratio) candidate = { ratio: rel.ratio, since: t };
      if (t - candidate.since < o.persistS) return { mode: followed === null ? 'locking' : 'switching', ratio: followed, match: rel, adopted: false };
      followed = rel.ratio;
      candidate = null;
      return { mode: 'following', ratio: followed, match: rel, adopted: true };
    },
    ratio: () => followed,
    set(ratio) {
      followed = ratio;
      candidate = null;
    },
    reset() {
      followed = null;
      candidate = null;
    },
  };
}
