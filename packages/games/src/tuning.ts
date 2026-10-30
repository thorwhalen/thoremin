/**
 * The knobs a player turns while practising, shared by the games that have them: how smooth the
 * voice's dot is, how big the targets are, how long a hold takes. One smoothing number, 0..1, for
 * every cursor: 0.5 is each cursor's measured default, each step of 1/6 halves or doubles its
 * filters' cutoffs (smoother is slower to follow), and the vowel cursor's median grows with it.
 *
 * Pure.
 */
import type { OneEuroOptions } from '@thoremin/stats/smooth';

/** What a cursor can be retuned to while it runs. */
export interface CursorTuning {
  /** 0 (follows every wobble) .. 1 (very steady, slower). Default 0.5. */
  smoothing?: number;
}

export const SMOOTHING_DEFAULT = 0.5;
/** Octaves of cutoff from the default to either end of the range. */
const SMOOTHING_OCTAVES = 3;

/** The factor a cursor's default cutoffs are multiplied by at a smoothing: 8 at 0, 1 at 0.5, 1/8 at 1. */
export const smoothingFactor = (s: number = SMOOTHING_DEFAULT): number => 2 ** ((SMOOTHING_DEFAULT - clamp01(s)) * 2 * SMOOTHING_OCTAVES);

/** A 1-euro filter's options at a smoothing: both its cutoff and its speed coefficient scaled. */
export function smoothedAt(base: OneEuroOptions, s?: number): OneEuroOptions {
  const k = smoothingFactor(s);
  return { ...base, ...(base.minCutoff !== undefined ? { minCutoff: base.minCutoff * k } : {}), ...(base.beta !== undefined ? { beta: base.beta * k } : {}) };
}

function clamp01(u: number): number {
  return Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : SMOOTHING_DEFAULT;
}

/** The ranges a page's controls and a spec's settings are held to. */
export const TUNING_RANGES = {
  size: { min: 0.4, max: 2.5, step: 0.05, default: 1 },
  holdS: { min: 0.1, max: 4, step: 0.05 },
  smoothing: { min: 0, max: 1, step: 0.05, default: SMOOTHING_DEFAULT },
  tolerance: { min: 5, max: 150, step: 5 },
} as const;
