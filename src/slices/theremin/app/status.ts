/**
 * The physical theremin's live status as the engine loop reports it: whether each hand is on its
 * antenna, the note and hertz, the volume. Human-rate and change-gated (the note to the cent, the
 * volume to the percent), a zustand store the editor section reads.
 */
import { create } from 'zustand';
import type { OutputReader } from '@thoremin/sdk-ui/types';
import { IDLE_PHYSICAL_THEREMIN_STATUS, type PhysicalThereminStatus } from '../nodes/physical_theremin';
import { noteReadout } from '../nodes/overlay/antennas';

export interface PhysicalThereminStatusState {
  live: PhysicalThereminStatus;
  report(live: PhysicalThereminStatus): void;
  reset(): void;
}

export const usePhysicalThereminStatus = create<PhysicalThereminStatusState>((set) => ({
  live: IDLE_PHYSICAL_THEREMIN_STATUS,
  report: (live) => set({ live }),
  reset: () => set({ live: IDLE_PHYSICAL_THEREMIN_STATUS }),
}));

/** What to tell the player, per state. */
export function describeThereminLive(live: PhysicalThereminStatus): string {
  if (!live.enabled) return 'Off. Tick "Play the physical theremin" (the Physical Theremin instrument has it on).';
  if (!live.pitchHand) return 'Raise your right hand near the pitch antenna (the rod on the right).';
  const note = live.midi !== null ? noteReadout(live.midi) : '';
  if (!live.sounding) return `${note}. Lift your left hand off the loop to hear it.`;
  return `${note}, ${live.hz?.toFixed(0)} Hz, volume ${Math.round(live.volume * 100)}%${live.vibrato > 0.5 ? ', vibrato' : ''}.`;
}

const liveKey = (l: PhysicalThereminStatus): string =>
  `${l.enabled ? 1 : 0}|${l.pitchHand ? 1 : 0}|${l.volumeHand ? 1 : 0}|${l.midi === null ? '-' : Math.round(l.midi * 100)}|${Math.round(l.volume * 100)}|${l.vibrato > 0.5 ? 1 : 0}|${l.sounding ? 1 : 0}`;

export function makeThereminReporter(engine: OutputReader, nodeId: string, store: Pick<PhysicalThereminStatusState, 'report'> = usePhysicalThereminStatus.getState()): () => void {
  let lastKey = '';
  return () => {
    const status = engine.getOutput(nodeId, 'status') as PhysicalThereminStatus | undefined;
    if (!status) return;
    const key = liveKey(status);
    if (key === lastKey) return;
    lastKey = key;
    store.report(status);
  };
}
