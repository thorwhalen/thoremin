/**
 * Which timeline is in force, from what the producers made (pure): the player's entries and the
 * loaded score.
 *
 * - The player's timeline wins when it stands on its own: a tapped tempo, or a chart its ruler
 *   placed (on the song's own beat grid). It plays on the song's clock.
 * - Otherwise, over a score: the score's bars, clock and melody stay; the player's key, when they
 *   gave one, replaces the score's keys, and the player's chart, when they wrote one, goes on the
 *   score's bars in place of its chords.
 * - Otherwise the player's (a key alone, or a chart waiting for a tempo), else the score's, else none.
 */
import type { ActiveContext } from '@thoremin/sdk/context/reading';
import { contextFromUser, USER_ANALYZER, type UserEntry } from '@thoremin/sdk/context/from_user';

export interface Layers {
  /** The player's timeline, and what they said (to tell a key alone from a chart). */
  user?: { active: ActiveContext; entry: UserEntry } | null;
  score?: ActiveContext | null;
}

export function combineLayers({ user, score }: Layers): ActiveContext | null {
  if (!user) return score ?? null;
  const { entry, active } = user;
  if (entry.tempo !== null || active.context.chords.length > 0) return active;
  if (!score) return active;
  const base = score.context;
  const key = active.context.keys[0];
  const chart = entry.chart.trim() ? contextFromUser({ ...entry, tempo: null }, { ruler: base.beats.map((b) => b.t), durationS: base.durationS }) : null;
  return {
    clock: score.clock,
    context: {
      ...base,
      source: 'user',
      analyzers: [...base.analyzers, USER_ANALYZER],
      keys: key ? [{ ...key, start: 0, end: Math.max(base.durationS, key.end) }] : base.keys,
      chords: chart ? chart.chords : base.chords,
    },
  };
}
