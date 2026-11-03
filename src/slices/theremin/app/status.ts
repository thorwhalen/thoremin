/**
 * The physical theremin's live status as the engine loop reports it: whether each hand is on its
 * antenna, the note and hertz, the volume. Human-rate and change-gated (the note to the cent, the
 * volume to the percent), a zustand store the editor section reads. The store, its reporter and the
 * status hook are the shared readout store's (`@thoremin/sdk-ui/statusStore`, #969).
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_PHYSICAL_THEREMIN_STATUS, type PhysicalThereminStatus } from '../nodes/physical_theremin';
import { noteReadout } from '../nodes/overlay/antennas';
import { PHYSICAL_THEREMIN_NODE_ID } from '..';

export type PhysicalThereminStatusState = StatusState<PhysicalThereminStatus, 'live'>;

/** What to tell the player, per state. */
export function describeThereminLive(live: PhysicalThereminStatus): string {
  if (!live.enabled) return 'Off. Tick "Play the physical theremin" (the Physical Theremin instrument has it on).';
  if (!live.pitchHand) return 'Raise your right hand near the pitch antenna (the rod on the right).';
  const note = live.midi !== null ? noteReadout(live.midi) : '';
  if (!live.sounding) return `${note}. Lift your left hand off the loop to hear it.`;
  return `${note}, ${live.hz?.toFixed(0)} Hz, volume ${Math.round(live.volume * 100)}%${live.vibrato > 0.5 ? ', vibrato' : ''}.`;
}

/** Quantise what the view shows (the note to the cent, the volume to the percent). */
const liveKey = (l: PhysicalThereminStatus): string =>
  `${l.enabled ? 1 : 0}|${l.pitchHand ? 1 : 0}|${l.volumeHand ? 1 : 0}|${l.midi === null ? '-' : Math.round(l.midi * 100)}|${Math.round(l.volume * 100)}|${l.vibrato > 0.5 ? 1 : 0}|${l.sounding ? 1 : 0}`;

/** The theremin's readout store, reporter and status hook. */
export const THEREMIN_STATUS = createStatusStore(PHYSICAL_THEREMIN_NODE_ID, { absent: IDLE_PHYSICAL_THEREMIN_STATUS, keyOf: liveKey, field: 'live' });

export const usePhysicalThereminStatus = THEREMIN_STATUS.useStatus;

/** The per-frame sink over the theremin node (to this store by default). */
export const makeThereminReporter = THEREMIN_STATUS.makeReporter;
