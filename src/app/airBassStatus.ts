/**
 * airBassStatus — the live air-bass state the engine loop reports (#249), for the
 * Instruments view: whether both hands are in view, the note under the fretting hand,
 * how many notes, and whether the last one was predicted ahead of the pluck. Ephemeral
 * per-frame runtime state on the `airDrumStatus` pattern: the DAG produces it, React
 * only displays it.
 */
import { create } from 'zustand';
import { IDLE_AIR_BASS_STATUS, type AirBassStatus } from '@/nodes/music/air_bass';
import { midiToName } from '@/music/theory';

export type AirBassLive = AirBassStatus;
export const ABSENT_AIR_BASS_LIVE: AirBassLive = IDLE_AIR_BASS_STATUS;

/** The node id the reporter reads — the `airBass` node in `graph.ts`. */
export const AIR_BASS_NODE_ID = 'airBass';

export interface AirBassStatusState {
  live: AirBassLive;
  report(live: AirBassLive): void;
  reset(): void;
}

export const useAirBassStatus = create<AirBassStatusState>((set) => ({
  live: ABSENT_AIR_BASS_LIVE,
  report: (live) => set({ live }),
  reset: () => set({ live: ABSENT_AIR_BASS_LIVE }),
}));

/** What to tell the player, per state. */
export function describeBassLive(live: AirBassLive): string {
  if (!live.enabled) return 'Off. Tick "Play the air bass" (the Air Bass instrument has it on).';
  if (!live.fretting) return 'Show both hands: one holds the neck, the other plucks.';
  if (!live.ready) return 'Pluck down once with your plucking hand to teach it your stroke.';
  if (live.notes === 0 || live.lastMidi === null) return 'Ready. Slide along the neck and pluck.';
  const ms = Math.round(Math.abs(live.lastLead) * 1000);
  return live.lastLead >= 0 ? `${midiToName(live.lastMidi)}: predicted ${ms} ms before the pluck.` : `${midiToName(live.lastMidi)}: sounded ${ms} ms after the pluck.`;
}

export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/** Quantise what the view shows. */
export function airBassLiveKey(l: AirBassLive): string {
  return `${l.enabled ? 1 : 0}|${l.fretting ? 1 : 0}|${l.fretMidi ?? '-'}|${l.notes}|${l.predicted}|${l.lastMidi ?? '-'}|${Math.round(l.lastLead * 1000)}|${l.ready ? 1 : 0}`;
}

export function makeAirBassReporter(
  engine: OutputReader,
  store: Pick<AirBassStatusState, 'report'> = useAirBassStatus.getState(),
  nodeId: string = AIR_BASS_NODE_ID,
): () => void {
  let lastKey = '';
  return () => {
    const status = engine.getOutput(nodeId, 'status') as AirBassLive | undefined;
    if (!status) return;
    const key = airBassLiveKey(status);
    if (key === lastKey) return;
    lastKey = key;
    store.report(status);
  };
}
