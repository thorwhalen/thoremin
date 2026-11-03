/**
 * airFluteStatus — the live air-flute state the engine loop reports (#249): which
 * fingering is held, whether the breath is on, whether the hands and the face are in
 * view. Human-rate, change-gated, a zustand store. (The fingers' and the mouth's
 * per-frame vectors, for enrolment, go through `air/shapeTap.ts`.)
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_AIR_FLUTE_STATUS, type AirFluteStatus } from '../nodes/air_flute';

export type AirFluteLive = AirFluteStatus;
export const ABSENT_AIR_FLUTE_LIVE: AirFluteLive = IDLE_AIR_FLUTE_STATUS;

/** The node id the reporter reads — the `airFlute` node in `graph.ts`. */
export const AIR_FLUTE_NODE_ID = 'airFlute';

export type AirFluteStatusState = StatusState<AirFluteLive, 'live'>;

/** What to tell the player, per state. */
export function describeFluteLive(live: AirFluteLive): string {
  if (!live.enabled) return 'Off. Tick "Play the air flute" (the Air Flute instrument has it on).';
  if (live.knownFingers === 0) return 'Teach it your fingerings first: open the gear, name a note, hold the finger shape.';
  if (live.breath === 'mouth' && !live.mouthReady) return 'Teach it your blowing and resting mouth (in the gear), or set Breath to "fingers only".';
  if (!live.hands) return 'Show both hands, as if holding the flute.';
  if (live.note === null) return 'Make one of your fingerings.';
  if (!live.playable) return `"${live.note}" is not a note name. Rename it (D5, F#4, ...).`;
  if (live.breath === 'mouth' && !live.face) return `${live.note}. Face the camera: it listens to your mouth.`;
  return live.sounding ? `${live.note}, sounding.` : `${live.note}. ${live.breath === 'mouth' ? 'Blow to play it.' : ''}`.trim();
}

export function airFluteLiveKey(l: AirFluteLive): string {
  return `${l.enabled ? 1 : 0}|${l.breath}|${l.knownFingers}|${l.mouthReady ? 1 : 0}|${l.hands ? 1 : 0}|${l.face ? 1 : 0}|${l.note ?? '-'}|${l.playable ? 1 : 0}|${l.sounding ? 1 : 0}`;
}

/** The air flute's readout store, reporter and status hook (the shared readout store, #969). */
export const AIR_FLUTE_STATUS = createStatusStore(AIR_FLUTE_NODE_ID, { absent: ABSENT_AIR_FLUTE_LIVE, keyOf: airFluteLiveKey, field: 'live' });

export const useAirFluteStatus = AIR_FLUTE_STATUS.useStatus;

/** The per-frame sink over the air flute node (to this store by default). */
export const makeAirFluteReporter = AIR_FLUTE_STATUS.makeReporter;
