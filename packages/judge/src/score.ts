/**
 * Score folds: what a take's judgments add up to.
 *
 * Accuracy is a weighted mean over targets (a tier's weight, a miss 0), so it reads the same for
 * a 12-note lesson and a 300-note song; strays can cost a share of a hit each (`strayCost`), so
 * that hitting all the time scores below playing the chart. Combo is the run of consecutive
 * targets hit in a tier at or above `comboTier`. The timing summary (mean and spread of the
 * offsets, early and late counts) is what a tutor shows as "you rush" or "you drag", and what a
 * later calibration can be checked against.
 *
 * Pure: no DOM, no clock.
 */
import type { OnsetJudgment } from './onsets';

export interface ScoreOptions {
  /** Weight per tier name (0..1); a tier missing here weighs 0.5. Default perfect 1, great 0.75, good 0.4. */
  weights?: Readonly<Record<string, number>>;
  /** What a stray costs, in targets' worth of weight. Default 0 (strays reported, not charged). */
  strayCost?: number;
  /** Tiers that keep a combo going (default: every tier: any hit keeps it). */
  comboTiers?: readonly string[];
  /** An offset within this many seconds of the target is neither early nor late. Default 0.01. */
  onTime?: number;
}

export const DEFAULT_TIER_WEIGHTS: Readonly<Record<string, number>> = { perfect: 1, great: 0.75, good: 0.4 };

export interface ScoreSummary {
  targets: number;
  hits: number;
  misses: number;
  strays: number;
  /** Count per tier name, and `miss`. */
  counts: Record<string, number>;
  /** 0..1. */
  accuracy: number;
  combo: number;
  maxCombo: number;
  /** Mean of the hits' offsets (event - target), seconds; NaN with no hit. */
  meanOffset: number;
  /** Sample standard deviation of the offsets; NaN under two hits. */
  sdOffset: number;
  early: number;
  late: number;
}

export function scoreJudgments(judgments: readonly OnsetJudgment[], strays = 0, opts: ScoreOptions = {}): ScoreSummary {
  const weights = opts.weights ?? DEFAULT_TIER_WEIGHTS;
  const onTime = opts.onTime ?? 0.01;
  const comboTiers = opts.comboTiers ? new Set(opts.comboTiers) : null;
  const counts: Record<string, number> = {};
  const offsets: number[] = [];
  let weight = 0;
  let combo = 0;
  let maxCombo = 0;
  let early = 0;
  let late = 0;
  for (const j of judgments) {
    const key = j.kind === 'hit' ? j.tier : 'miss';
    counts[key] = (counts[key] ?? 0) + 1;
    if (j.kind === 'hit') {
      weight += weights[j.tier] ?? 0.5;
      offsets.push(j.offset);
      if (j.offset < -onTime) early++;
      else if (j.offset > onTime) late++;
    }
    const keeps = j.kind === 'hit' && (comboTiers === null || comboTiers.has(j.tier));
    combo = keeps ? combo + 1 : 0;
    maxCombo = Math.max(maxCombo, combo);
  }
  const n = judgments.length;
  const charged = Math.max(0, weight - strays * (opts.strayCost ?? 0));
  const mean = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : NaN;
  const sd = offsets.length > 1 ? Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / (offsets.length - 1)) : NaN;
  return {
    targets: n,
    hits: offsets.length,
    misses: counts.miss ?? 0,
    strays,
    counts,
    accuracy: n === 0 ? 0 : charged / n,
    combo,
    maxCombo,
    meanOffset: mean,
    sdOffset: sd,
    early,
    late,
  };
}
