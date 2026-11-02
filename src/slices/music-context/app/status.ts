/**
 * The `music-context` node's status, mirrored for the panel: a store the status hook writes when
 * what it says changes (the key, the chord, whether it moves or owns the scale), never on every tick.
 */
import { create } from 'zustand';
import type { OutputReader } from '@thoremin/sdk-ui/types';
import { IDLE_MUSIC_CONTEXT_STATUS, MUSIC_CONTEXT_NODE_ID, type MusicContextStatus } from '@thoremin/sdk/context/reading';

export interface MusicContextStatusState {
  status: MusicContextStatus;
  report(status: MusicContextStatus): void;
  reset(): void;
}

export const useMusicContextStatus = create<MusicContextStatusState>((set) => ({
  status: IDLE_MUSIC_CONTEXT_STATUS,
  report: (status) => set({ status }),
  reset: () => set({ status: IDLE_MUSIC_CONTEXT_STATUS }),
}));

/** What a change worth re-rendering is (the position moves every tick; the panel does not show it). */
const signature = (s: MusicContextStatus) => [s.active, s.source, s.clock, s.moving, s.key, s.chord, s.ownsScale].join('|');

/** The per-tick sink: reads the node's status and reports it when it changed. */
export function makeMusicContextReporter(engine: OutputReader, store: { getState(): Pick<MusicContextStatusState, 'report'> } = useMusicContextStatus): () => void {
  let last = '';
  return () => {
    const status = engine.getOutput(MUSIC_CONTEXT_NODE_ID, 'status') as MusicContextStatus | undefined;
    if (!status) return;
    const sig = signature(status);
    if (sig === last) return;
    last = sig;
    store.getState().report(status);
  };
}
