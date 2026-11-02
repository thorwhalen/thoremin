/**
 * Which timeline is in force, from what the producers made (pure): the player's entries and the
 * loaded score. A chart or a tapped tempo is a timeline of its own, on the song's clock, and wins.
 * A key alone overlays whatever else is in force (it is timeless): the score's bars and chords
 * stay, its keys give way to the player's. Otherwise the score; otherwise nothing.
 */
import type { ActiveContext } from '@thoremin/sdk/context/reading';
import { USER_ANALYZER, type UserEntry } from '@thoremin/sdk/context/from_user';

export interface Layers {
  /** The player's timeline, and what they said (to tell a key alone from a chart). */
  user?: { active: ActiveContext; entry: UserEntry } | null;
  score?: ActiveContext | null;
}

export function combineLayers({ user, score }: Layers): ActiveContext | null {
  if (user && (user.entry.tempo !== null || user.entry.chart.trim() !== '')) return user.active;
  if (user && user.entry.key !== null && score) {
    const key = user.active.context.keys[0];
    const base = score.context;
    return {
      clock: score.clock,
      context: {
        ...base,
        source: 'user',
        analyzers: [...base.analyzers, USER_ANALYZER],
        keys: key ? [{ ...key, start: 0, end: Math.max(base.durationS, key.end) }] : [],
      },
    };
  }
  return user?.active ?? score ?? null;
}
