/**
 * The listening game's status as the engine loop reports it (phase, running accuracy, the results
 * and a calibration estimate), change-gated, in a zustand store the editor section reads. The store,
 * its reporter and the status hook are the shared readout store's (`@thoremin/sdk-ui/statusStore`,
 * #969).
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_GAMES_STATUS, type GamesStatus } from '../nodes/listening_game';
import { GAMES_NODE_ID } from '..';

export type GamesStatusState = StatusState<GamesStatus, 'live'>;

/** Quantise what the view shows (the accuracy to the percent, the offset to the millisecond). */
const keyOf = (s: GamesStatus): string =>
  `${s.notice ?? ''}|${s.enabled ? 1 : 0}|${s.mode}|${s.lesson}|${s.phase}|${Math.round(s.accuracy * 100)}|${s.results?.summary ?? ''}|${s.calibration ? Math.round(s.calibration.offset * 1000) : ''}`;

/** The listening game's readout store, reporter and status hook. */
export const GAMES_STATUS = createStatusStore(GAMES_NODE_ID, { absent: IDLE_GAMES_STATUS, keyOf, field: 'live' });

export const useGamesStatus = GAMES_STATUS.useStatus;

/** The per-frame sink over the game node (to this store by default). */
export const makeGamesReporter = GAMES_STATUS.makeReporter;

/** One line for the player, per phase. */
export function describeGame(live: GamesStatus): string {
  if (!live.enabled) return 'Off. Load Sing, Play Along or Match the Note from the instruments.';
  if (live.notice) return live.notice;
  if (live.phase === 'idle') return 'Ready. Press Start; use headphones if a speaker plays near the microphone.';
  if (live.phase === 'count-in') return 'Count-in...';
  if (live.phase === 'playing') return `Playing: ${Math.round(live.accuracy * 100)} % so far.`;
  return live.results?.summary ?? 'Done.';
}
