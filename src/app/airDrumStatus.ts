/**
 * airDrumStatus — a tiny store the engine loop writes the live air-drum state into
 * (#233), so the Air drum tool panel can show what the instrument is doing: whether
 * each hand's floor has been learned, how many hits, whether the last one was
 * predicted ahead of the strike and by how much. Ephemeral per-frame runtime state,
 * exactly like `conductorStatus`: the DAG produces it; React only displays it.
 *
 * {@link makeAirDrumReporter} is the per-frame sink the host loop registers beside
 * the other bridges in `useEngine.ts`: it reads the `air-drum` node's `status`
 * output and reports only when something a player can see changed.
 */
import { create } from 'zustand';
import { IDLE_STATUS, type AirDrumStatus } from '@/nodes/music/air_drum';

export type AirDrumLive = AirDrumStatus;
export const ABSENT_AIR_DRUM_LIVE: AirDrumLive = IDLE_STATUS;

/** The node id the reporter reads — the `airDrum` node in `graph.ts`. */
export const AIR_DRUM_NODE_ID = 'airDrum';

export interface AirDrumStatusState {
  live: AirDrumLive;
  report(live: AirDrumLive): void;
  reset(): void;
}

export const useAirDrumStatus = create<AirDrumStatusState>((set) => ({
  live: ABSENT_AIR_DRUM_LIVE,
  report: (live) => set({ live }),
  reset: () => set({ live: ABSENT_AIR_DRUM_LIVE }),
}));

export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/** Quantise what the panel shows (the lead to the millisecond). */
export function airDrumLiveKey(l: AirDrumLive): string {
  return `${l.enabled ? 1 : 0}|${l.hits}|${l.predicted}|${l.lastHand ?? '-'}|${Math.round(l.lastLead * 1000)}|${Math.round(l.lastPull * 1000)}|${l.ready.right ? 1 : 0}${l.ready.left ? 1 : 0}`;
}

export function makeAirDrumReporter(
  engine: OutputReader,
  store: Pick<AirDrumStatusState, 'report'> = useAirDrumStatus.getState(),
  nodeId: string = AIR_DRUM_NODE_ID,
): () => void {
  let lastKey = '';
  return () => {
    const status = engine.getOutput(nodeId, 'status') as AirDrumLive | undefined;
    if (!status) return;
    const key = airDrumLiveKey(status);
    if (key === lastKey) return;
    lastKey = key;
    store.report(status);
  };
}
