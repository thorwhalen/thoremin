/**
 * airGuitarStatus — the live air-guitar state the engine loop reports (#249): the held
 * chord, strums, the last strum's lead. Human-rate, change-gated, a zustand store. (The
 * chord hand's per-frame shape vector, for enrolment, goes through `air/shapeTap.ts`.)
 */
import { create } from 'zustand';
import { IDLE_AIR_GUITAR_STATUS, type AirGuitarStatus } from '../nodes/air_guitar';

export type AirGuitarLive = AirGuitarStatus;
export const ABSENT_AIR_GUITAR_LIVE: AirGuitarLive = IDLE_AIR_GUITAR_STATUS;

/** The node id the reporters read — the `airGuitar` node in `graph.ts`. */
export const AIR_GUITAR_NODE_ID = 'airGuitar';

export interface AirGuitarStatusState {
  live: AirGuitarLive;
  report(live: AirGuitarLive): void;
  reset(): void;
}

export const useAirGuitarStatus = create<AirGuitarStatusState>((set) => ({
  live: ABSENT_AIR_GUITAR_LIVE,
  report: (live) => set({ live }),
  reset: () => set({ live: ABSENT_AIR_GUITAR_LIVE }),
}));

/** What to tell the player, per state. */
export function describeGuitarLive(live: AirGuitarLive): string {
  if (!live.enabled) return 'Off. Tick "Play the air guitar" (the Air Guitar instrument has it on).';
  if (live.known === 0) return 'Teach it your chords first: open the gear, name a chord, hold its shape.';
  if (live.chord === null) return live.fretting ? 'Make one of your chord shapes.' : 'Show your chord hand: it holds the shapes you taught.';
  // The tracker HOLDS the last chord with the chord hand out of view, and a strum plays it.
  if (!live.fretting) return `Holding ${live.chord} (chord hand out of view). Strum to play it.`;
  if (!live.playable) return `"${live.chord}" is not a chord name it can play. Rename it (G, Em, C7, ...).`;
  if (!live.ready) return `${live.chord}. Strum down once to teach it your stroke.`;
  if (live.strums === 0 || live.lastChord === null) return `${live.chord}. Strum.`;
  const ms = Math.round(Math.abs(live.lastLead) * 1000);
  return live.lastLead >= 0 ? `${live.chord}. Last strum (${live.lastChord}) predicted ${ms} ms ahead.` : `${live.chord}. Last strum (${live.lastChord}) sounded ${ms} ms late.`;
}

export interface OutputReader {
  getOutput(nodeId: string, port: string): unknown;
}

/** Quantise what the view shows. */
export function airGuitarLiveKey(l: AirGuitarLive): string {
  return `${l.enabled ? 1 : 0}|${l.known}|${l.fretting ? 1 : 0}|${l.chord ?? '-'}|${l.playable ? 1 : 0}|${l.strums}|${l.predicted}|${l.lastChord ?? '-'}|${Math.round(l.lastLead * 1000)}|${l.ready ? 1 : 0}`;
}

export function makeAirGuitarReporter(
  engine: OutputReader,
  store: Pick<AirGuitarStatusState, 'report'> = useAirGuitarStatus.getState(),
  nodeId: string = AIR_GUITAR_NODE_ID,
): () => void {
  let lastKey = '';
  return () => {
    const status = engine.getOutput(nodeId, 'status') as AirGuitarLive | undefined;
    if (!status) return;
    const key = airGuitarLiveKey(status);
    if (key === lastKey) return;
    lastKey = key;
    store.report(status);
  };
}
