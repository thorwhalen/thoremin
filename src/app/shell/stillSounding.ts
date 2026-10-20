/**
 * The muted badge's tail (#600 S13): what keeps sounding while the player has muted, as each
 * listed extension contributes it (`ExtensionUi.stillSounding`: MIDI with its mute dial off), so
 * the badge never says "muted" while notes still reach the outside, and core names no output.
 */
import type { StillSounding } from '@thoremin/sdk-ui/types';
import { UI_CONTRIBUTIONS } from '../host/contributions';

/** Each contributed note for this hot-store state, ` · `-joined after the badge's own text. */
export function stillSoundingNote(state: Readonly<Record<string, unknown>>, hints: readonly StillSounding[] = UI_CONTRIBUTIONS.stillSounding): string {
  return hints.map((h) => h.whileMuted(state)).filter((n): n is string => !!n).map((n) => ` · ${n}`).join('');
}
