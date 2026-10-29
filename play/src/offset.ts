/**
 * The player's timing offset on a standalone page (the app keeps it as a device pref, `gamesPrefs`):
 * what Audio timing measured (the round trip plus the player's anticipation, seconds), kept in this
 * browser's storage (`./stored`) and subtracted by the timed games (Sing Along, Play Along Lessons).
 */
import { stored } from './stored';

export interface StoredOffset {
  offset: number;
  spread: number;
  /** ISO date of the take. */
  at: string;
}

const OFFSET = stored<StoredOffset>('funfon.playerOffset', (v): v is StoredOffset => typeof v === 'object' && v !== null && Number.isFinite((v as StoredOffset).offset));

export const readOffset = (): StoredOffset | null => OFFSET.read();
export const writeOffset = (v: StoredOffset): boolean => OFFSET.write(v);

/** One line for a page: the offset in use, or that there is none yet. */
export function offsetLine(v: StoredOffset | null): string {
  return v ? `Your timing: ${Math.round(v.offset * 1000)} ms (measured ${v.at.slice(0, 10)}).` : 'No timing measured yet: Audio timing measures it in half a minute.';
}
