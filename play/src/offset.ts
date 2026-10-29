/**
 * The player's timing offset on a standalone page (the app keeps it as a device pref, `gamesPrefs`):
 * what Audio timing measured (the round trip plus the player's anticipation, seconds), kept in this
 * browser's storage and subtracted by the timed games (Sing Along, Play Along Lessons). Storage may
 * be refused (a private window): then there is no offset and the games play with none.
 */
const KEY = 'funfon.playerOffset';

export interface StoredOffset {
  offset: number;
  spread: number;
  /** ISO date of the take. */
  at: string;
}

export function readOffset(): StoredOffset | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredOffset;
    return Number.isFinite(v.offset) ? v : null;
  } catch {
    return null;
  }
}

export function writeOffset(v: StoredOffset): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

/** One line for a page: the offset in use, or that there is none yet. */
export function offsetLine(v: StoredOffset | null): string {
  return v ? `Your timing: ${Math.round(v.offset * 1000)} ms (measured ${v.at.slice(0, 10)}).` : 'No timing measured yet: Audio timing measures it in half a minute.';
}
