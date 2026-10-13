/**
 * The quiz (#385 E7, the carve design's C.4.9): can the player make each of their categories
 * again, on demand? The tool names the categories in a random order, each a few times, with a
 * relax between, and watches the settled reading: a category entered within `hitMs` and held for
 * `holdMs` is a **hit**, one entered later (before `timeoutMs`) is **slow**, and one never held
 * is a **miss** (with what it read instead, the confusion a hint can act on).
 *
 * Reproducibility is what the separation chips cannot see: two categories can be far apart in
 * the take and still be a face the player cannot find again tomorrow. MAGIC measured the same
 * thing for gesture designers (consistency of a gesture with itself), and the per-category
 * result is kept with the categorizer so a later quiz shows drift.
 *
 * Pure and modality-free: readings are `{ categoryId }` (the tracker's settled category, null for
 * none of these) on the caller's clock, as the cue runner is driven. No timers, no React.
 */
import { z } from 'zod';
import type { FeatureVector } from './types';

export const QUIZ_DEFAULTS = {
  /** How many times each category is asked. */
  repeats: 2,
  /** The relax before each prompt (ms). */
  relaxMs: 2000,
  /** A category entered within this long after the prompt is a hit (ms). */
  hitMs: 2000,
  /** ...and must be held this long, unbroken, to count (ms). */
  holdMs: 1000,
  /** A category entered after `hitMs` but before this is slow; past it, a miss (ms). A run begun
   *  before it may finish. */
  timeoutMs: 5000,
  /** What a slow answer is worth in the score (a hit is 1, a miss 0). */
  slowWeight: 0.5,
} as const;

export type QuizOptions = Partial<Omit<typeof QUIZ_DEFAULTS, 'repeats' | 'slowWeight'>>;

export type QuizOutcome = 'hit' | 'slow' | 'miss';

/** One prompt's result. */
export interface QuizTrial {
  categoryId: string;
  outcome: QuizOutcome;
  /** From the prompt to the entry of the run that was held (ms); null for a miss. */
  timeToHitMs: number | null;
  /** What was read most while this category was asked and not held (another category id), or
   *  null (none of these, or nothing else). */
  confusedWith: string | null;
  /** The mean live vector over the held run, when the caller passed vectors: a hit's face is a
   *  labelled hold the player can keep as a sample. */
  vector?: FeatureVector;
}

/** What the quiz asks now. */
export type QuizStep =
  | { kind: 'idle' }
  | { kind: 'relax'; index: number; total: number; next: string; remainingMs: number }
  | { kind: 'ask'; index: number; total: number; categoryId: string; elapsedMs: number; heldMs: number }
  | { kind: 'done'; total: number };

export interface Quiz {
  start(tMs: number): void;
  /** Feed the settled reading at `tMs` (and the live vector, for the hits' samples). */
  push(reading: { categoryId: string | null }, tMs: number, vector?: FeatureVector): void;
  step(tMs?: number): QuizStep;
  trials(): readonly QuizTrial[];
  done(): boolean;
}

/**
 * The order: each id `repeats` times, shuffled by `random` (Fisher-Yates), then nudged so no id
 * is asked twice in a row where another order allows it (a repeat in a row tests holding, not
 * finding).
 */
export function quizOrder(ids: readonly string[], { repeats = QUIZ_DEFAULTS.repeats, random = Math.random }: { repeats?: number; random?: () => number } = {}): string[] {
  const out: string[] = [];
  for (let r = 0; r < Math.max(1, Math.floor(repeats)); r++) out.push(...ids);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  const clashAt = (k: number) => (k > 0 && out[k] === out[k - 1]) || (k + 1 < out.length && out[k] === out[k + 1]);
  for (let i = 1; i < out.length; i++) {
    if (out[i] !== out[i - 1]) continue;
    // Swap with the first later or earlier place that leaves neither spot next to its twin.
    for (let j = 0; j < out.length; j++) {
      if (out[j] === out[i]) continue;
      [out[i], out[j]] = [out[j], out[i]];
      if (!clashAt(i) && !clashAt(j)) break;
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

function meanOf(vectors: readonly FeatureVector[]): FeatureVector {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const v of vectors)
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (!Number.isFinite(x)) continue;
      sum[k] = (sum[k] ?? 0) + x;
      n[k] = (n[k] ?? 0) + 1;
    }
  const out: FeatureVector = {};
  for (const k of Object.keys(sum)) out[k] = sum[k] / n[k];
  return out;
}

/** A quiz over `order` (see {@link quizOrder}). */
export function createQuiz(order: readonly string[], options: QuizOptions = {}): Quiz {
  const o = { ...QUIZ_DEFAULTS, ...options };
  const trials: QuizTrial[] = [];
  let started = false;
  let index = 0;
  /** When the current relax or ask began. */
  let since = 0;
  let asking = false;
  let runStart: number | null = null;
  let runVectors: FeatureVector[] = [];
  let others = new Map<string, number>();
  let lastT = 0;

  const finish = (outcome: QuizOutcome, tMs: number, timeToHitMs: number | null, vector?: FeatureVector) => {
    const confusedWith = outcome === 'miss' ? ([...others.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;
    trials.push({ categoryId: order[index], outcome, timeToHitMs, confusedWith, ...(vector ? { vector } : {}) });
    index += 1;
    asking = false;
    since = tMs;
    runStart = null;
    runVectors = [];
    others = new Map();
  };

  return {
    start(tMs) {
      started = true;
      index = 0;
      trials.length = 0;
      asking = false;
      since = tMs;
      lastT = tMs;
      runStart = null;
      runVectors = [];
      others = new Map();
    },
    push(reading, tMs, vector) {
      if (!started || index >= order.length) return;
      lastT = Math.max(lastT, tMs);
      if (!asking) {
        if (tMs - since < o.relaxMs) return;
        asking = true;
        since = tMs;
      }
      const target = order[index];
      if (reading.categoryId === target) {
        if (runStart === null) {
          // A run must begin before the deadline; one under way may finish after it.
          if (tMs - since >= o.timeoutMs) return finish('miss', tMs, null);
          runStart = tMs;
          runVectors = [];
        }
        if (vector) runVectors.push(vector);
        if (tMs - runStart >= o.holdMs) {
          const entry = runStart - since;
          finish(entry <= o.hitMs ? 'hit' : 'slow', tMs, entry, runVectors.length > 0 ? meanOf(runVectors) : undefined);
        }
        return;
      }
      runStart = null;
      runVectors = [];
      if (reading.categoryId !== null) others.set(reading.categoryId, (others.get(reading.categoryId) ?? 0) + 1);
      if (tMs - since >= o.timeoutMs) finish('miss', tMs, null);
    },
    step(tMs = lastT) {
      if (!started) return { kind: 'idle' };
      const total = order.length;
      if (index >= total) return { kind: 'done', total };
      if (!asking) return { kind: 'relax', index, total, next: order[index], remainingMs: Math.max(0, o.relaxMs - (tMs - since)) };
      return { kind: 'ask', index, total, categoryId: order[index], elapsedMs: tMs - since, heldMs: runStart === null ? 0 : tMs - runStart };
    },
    trials: () => trials,
    done: () => started && index >= order.length,
  };
}

/** One category's reproducibility, as kept with the categorizer. */
export const ReproducibilitySchema = z.object({
  /** The category's name when it was asked (a re-cut can give its id to another face). */
  label: z.string(),
  asked: z.number().int().min(0),
  hits: z.number().int().min(0),
  slow: z.number().int().min(0),
  misses: z.number().int().min(0),
  /** Median time to the entry of the held run, over the hits and slow answers (ms). */
  medianTimeMs: z.number().nullable(),
  /** What it read most when missed, or null. */
  confusedWith: z.string().nullable(),
});
export type Reproducibility = z.infer<typeof ReproducibilitySchema>;

/** A quiz's result: when, and per category id. */
export const QuizResultSchema = z.object({
  at: z.string(),
  categories: z.record(z.string(), ReproducibilitySchema),
});
export type QuizResult = z.infer<typeof QuizResultSchema>;

/** The score of one category: hits, slow answers at {@link QUIZ_DEFAULTS.slowWeight}, over asked. */
export function reproducibilityScore(r: Pick<Reproducibility, 'asked' | 'hits' | 'slow'>, slowWeight: number = QUIZ_DEFAULTS.slowWeight): number {
  return r.asked > 0 ? (r.hits + slowWeight * r.slow) / r.asked : 0;
}

/** The trials folded per category (`labels` names each at quiz time). */
export function summarizeQuiz(trials: readonly QuizTrial[], labels: ReadonlyMap<string, string>, at: string): QuizResult {
  const categories: Record<string, Reproducibility> = {};
  const byId = new Map<string, QuizTrial[]>();
  for (const t of trials) byId.set(t.categoryId, [...(byId.get(t.categoryId) ?? []), t]);
  for (const [id, ts] of byId) {
    const times = ts.flatMap((t) => (t.timeToHitMs === null ? [] : [t.timeToHitMs])).sort((a, b) => a - b);
    const mid = times.length === 0 ? null : times.length % 2 ? times[(times.length - 1) / 2] : (times[times.length / 2 - 1] + times[times.length / 2]) / 2;
    const confusions = new Map<string, number>();
    for (const t of ts) if (t.confusedWith) confusions.set(t.confusedWith, (confusions.get(t.confusedWith) ?? 0) + 1);
    categories[id] = {
      label: labels.get(id) ?? id,
      asked: ts.length,
      hits: ts.filter((t) => t.outcome === 'hit').length,
      slow: ts.filter((t) => t.outcome === 'slow').length,
      misses: ts.filter((t) => t.outcome === 'miss').length,
      medianTimeMs: mid,
      confusedWith: [...confusions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    };
  }
  return { at, categories };
}

/** A category's last result, only while it is still the same category: its id kept AND its name
 *  unchanged (a re-cut renumbers ids; a name is the player's). */
export function reproducibilityOf(result: QuizResult | null | undefined, category: { id: string; label: string }): Reproducibility | null {
  const r = result?.categories[category.id];
  return r && r.label.trim().toLowerCase() === category.label.trim().toLowerCase() ? r : null;
}
