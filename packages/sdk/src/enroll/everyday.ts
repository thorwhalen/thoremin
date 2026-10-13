/**
 * The everyday check (#385 E7, the carve design's C.3.3): talk, look around and play normally
 * for a minute, and count which categories fire by accident. MAGIC tested a gesture against an
 * Everyday Gesture Library for the same reason: a category the player makes on purpose is only
 * usable if the rest of their life does not make it too. A flagged category is one to make
 * bigger (a larger per-category size), to record bigger, or to merge.
 *
 * A fire is an ENTRY: the settled reading changing to a category it was not on (the tracker's
 * hysteresis already filters a one-frame flicker). Neutral and "none of these" never count, and
 * neither does the category the first reading is already on (the face held as the check began).
 *
 * Pure and modality-free, on the caller's clock, like the quiz.
 */
import { z } from 'zod';

export const EVERYDAY_DEFAULTS = {
  /** How long the check runs (ms). */
  durationMs: 60_000,
  /** A category firing at least this often (per minute) is flagged. */
  flagPerMinute: 1,
} as const;

export interface EverydayCheck {
  start(tMs: number): void;
  /** Feed the settled reading at `tMs`. Ignored before start and once done. */
  push(reading: { categoryId: string | null }, tMs: number): void;
  /** Time run so far (ms), at most the duration. */
  elapsedMs(tMs: number): number;
  done(tMs: number): boolean;
  /** Fires so far, per category id. */
  fires(): Readonly<Record<string, number>>;
}

export function createEverydayCheck({ durationMs = EVERYDAY_DEFAULTS.durationMs }: { durationMs?: number } = {}): EverydayCheck {
  let t0: number | null = null;
  let current: string | null = null;
  let primed = false;
  const fires: Record<string, number> = {};
  const over = (tMs: number) => t0 !== null && tMs - t0 >= durationMs;
  return {
    start(tMs) {
      t0 = tMs;
      current = null;
      primed = false;
      for (const k of Object.keys(fires)) delete fires[k];
    },
    push(reading, tMs) {
      if (t0 === null || over(tMs)) return;
      const id = reading.categoryId;
      if (primed && id !== null && id !== current) fires[id] = (fires[id] ?? 0) + 1;
      primed = true;
      current = id;
    },
    elapsedMs: (tMs) => (t0 === null ? 0 : Math.min(durationMs, Math.max(0, tMs - t0))),
    done: over,
    fires: () => fires,
  };
}

/** An everyday check's result, as kept with the categorizer. */
export const EverydayResultSchema = z.object({
  at: z.string(),
  durationMs: z.number().positive(),
  /** Accidental entries per category id. */
  fires: z.record(z.string(), z.number().int().min(0)),
  /** Each category's name at the time (a re-cut can give its id to another face). */
  labels: z.record(z.string(), z.string()),
});
export type EverydayResult = z.infer<typeof EverydayResultSchema>;

export function everydayResult(check: EverydayCheck, tMs: number, labels: ReadonlyMap<string, string>, at: string): EverydayResult {
  const durationMs = Math.max(1, check.elapsedMs(tMs));
  return { at, durationMs, fires: { ...check.fires() }, labels: Object.fromEntries(labels) };
}

/** One flagged category: it fired this often while the player did nothing in particular. */
export interface EverydayFlag {
  categoryId: string;
  label: string;
  fires: number;
  perMinute: number;
}

/** The categories that fired at least `flagPerMinute`, most often first. */
export function everydayFlags(result: EverydayResult, { flagPerMinute = EVERYDAY_DEFAULTS.flagPerMinute }: { flagPerMinute?: number } = {}): EverydayFlag[] {
  const minutes = result.durationMs / 60_000;
  return Object.entries(result.fires)
    .map(([categoryId, fires]) => ({ categoryId, label: result.labels[categoryId] ?? categoryId, fires, perMinute: fires / minutes }))
    .filter((f) => f.fires > 0 && f.perMinute >= flagPerMinute)
    .sort((a, b) => b.fires - a.fires);
}
