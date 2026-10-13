/**
 * airDrumStatus — a tiny store the engine loop writes the live air-drum state into
 * (#233), so the Instruments view can show what the air drum is doing (#249: its
 * row in the Air instruments category, and its settings section): whether each hand's
 * floor has been learned, how many hits, whether the last one was predicted ahead of
 * the strike and by how much. Ephemeral per-frame runtime state,
 * exactly like `conductorStatus`: the DAG produces it; React only displays it.
 *
 * {@link makeAirDrumReporter} is the per-frame sink the host loop registers beside
 * the other bridges in `useEngine.ts`: it reads the `air-drum` node's `status`
 * output and reports only when something a player can see changed.
 */
import { create } from 'zustand';
import { IDLE_STATUS, type AirDrumStatus } from '../nodes/air_drum';

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

/** What to tell the player, per state. */
export function describeLive(live: AirDrumLive): string {
  if (!live.enabled) return 'Off. Tick "Drum in the air" (the Air Drum instrument has it on), then strike down with a hand.';
  if (!live.ready.right && !live.ready.left) return 'Strike once to teach each hand where its drum is.';
  if (live.hits === 0) return 'Ready. Strike.';
  const ms = Math.round(Math.abs(live.lastLead) * 1000);
  const hand = live.lastHand === 'left' ? 'Left' : 'Right';
  if (live.lastLead < 0) {
    // A negative lead is either a stroke the predictor could not get ahead of, or a
    // predicted one the magnet pulled toward a beat that was already past (a negative
    // pull): different causes, different words.
    if (live.lastPull < 0) return `${hand}: pulled ${Math.round(-live.lastPull * 1000)} ms toward a beat already past; sounds ${Math.round((live.lastLateBy ?? -live.lastLead) * 1000)} ms late.`;
    return `${hand}: sounded ${ms} ms after the strike (too fast to predict).`;
  }
  // Predicted, but the audio output may eat the lead (step 0 of the timing plan): say so.
  const onTime = live.lastOnTime ?? 'yes';
  if (onTime === 'late') return `${hand}: predicted ${ms} ms ahead, but the audio output needs more: sounds ${Math.round((live.lastLateBy ?? 0) * 1000)} ms late.`;
  if (onTime === 'unknown-output') return `${hand}: predicted ${ms} ms before the strike (audio output latency unknown on this browser).`;
  return `${hand}: predicted ${ms} ms before the strike.`;
}

/**
 * The timing magnet's standing in words, or null when there is nothing to say (#239):
 * the magnet off, or pulling as asked. The two blocked states are the reasons every
 * pull of the last strokes came to nothing.
 */
export function describeMagnet(live: AirDrumLive): string | null {
  if (!live.enabled) return null;
  if (live.magnet === 'too-slow') return 'Timing magnet: pipeline too slow for timing magnetism on this machine (the strokes are heard too late to pull toward the beat).';
  if (live.magnet === 'grid-lag') {
    const lag = Number.isFinite(live.magnetLag) ? ` (${Math.round(Math.abs(live.magnetLag) * 1000)} ms ${live.magnetLag > 0 ? 'early' : 'late'})` : '';
    return `Timing magnet: paused, the conductor's beat sits off your strokes${lag}; pulling toward it would make the timing worse.`;
  }
  return null;
}

/** Quantise what the panel shows (the lead to the millisecond). */
export function airDrumLiveKey(l: AirDrumLive): string {
  return `${l.enabled ? 1 : 0}|${l.hits}|${l.predicted}|${l.lastHand ?? '-'}|${l.lastPad ?? '-'}|${Math.round((l.frameAspect ?? 0) * 100)}|${Math.round(l.lastLead * 1000)}|${Math.round(l.lastPull * 1000)}|${l.lastOnTime ?? 'yes'}|${Math.round((l.lastLateBy ?? 0) * 1000)}|${l.magnet ?? 'off'}|${Number.isFinite(l.magnetLag) ? Math.round(l.magnetLag * 1000) : '-'}|${l.ready.right ? 1 : 0}${l.ready.left ? 1 : 0}`;
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
