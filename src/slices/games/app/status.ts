/**
 * The listening game's status as the engine loop reports it (phase, running accuracy, the results
 * and a calibration estimate), change-gated, in a zustand store the editor section reads.
 */
import { create } from 'zustand';
import type { OutputReader } from '@thoremin/sdk-ui/types';
import { IDLE_GAMES_STATUS, type GamesStatus } from '../nodes/listening_game';

export interface GamesStatusState {
  live: GamesStatus;
  report(live: GamesStatus): void;
  reset(): void;
}

export const useGamesStatus = create<GamesStatusState>((set) => ({
  live: IDLE_GAMES_STATUS,
  report: (live) => set({ live }),
  reset: () => set({ live: IDLE_GAMES_STATUS }),
}));

const keyOf = (s: GamesStatus): string =>
  `${s.notice ?? ''}|${s.enabled ? 1 : 0}|${s.mode}|${s.lesson}|${s.phase}|${Math.round(s.accuracy * 100)}|${s.results?.summary ?? ''}|${s.calibration ? Math.round(s.calibration.offset * 1000) : ''}`;

export function makeGamesReporter(engine: OutputReader, nodeId: string, store: Pick<GamesStatusState, 'report'> = useGamesStatus.getState()): () => void {
  let last = '';
  return () => {
    const status = engine.getOutput(nodeId, 'status') as GamesStatus | undefined;
    if (!status) return;
    const key = keyOf(status);
    if (key === last) return;
    last = key;
    store.report(status);
  };
}

/** One line for the player, per phase. */
export function describeGame(live: GamesStatus): string {
  if (!live.enabled) return 'Off. Load Sing, Play Along or Match the Note from the instruments.';
  if (live.notice) return live.notice;
  if (live.phase === 'idle') return 'Ready. Press Start; use headphones if a speaker plays near the microphone.';
  if (live.phase === 'count-in') return 'Count-in...';
  if (live.phase === 'playing') return `Playing: ${Math.round(live.accuracy * 100)} % so far.`;
  return live.results?.summary ?? 'Done.';
}
