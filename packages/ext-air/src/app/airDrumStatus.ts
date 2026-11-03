/**
 * airDrumStatus — a tiny store the engine loop writes the live air-drum state into
 * (#233), so the Instruments view can show what the air drum is doing (#249: its
 * row in the Air instruments category, and its settings section): whether each hand's
 * floor has been learned, how many hits, whether the last one was predicted ahead of
 * the strike and by how much. Ephemeral per-frame runtime state,
 * exactly like `conductorStatus`: the DAG produces it; React only displays it.
 *
 * {@link AIR_DRUM_STATUS} is the shared readout store over it (#969): its status hook
 * reads the `air-drum` node's `status` output each frame and reports only when
 * something a player can see changed ({@link airDrumLiveKey}).
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_STATUS, type AirDrumStatus } from '../nodes/air_drum';

export type AirDrumLive = AirDrumStatus;
export const ABSENT_AIR_DRUM_LIVE: AirDrumLive = IDLE_STATUS;

/** The node id the reporter reads — the `airDrum` node in `graph.ts`. */
export const AIR_DRUM_NODE_ID = 'airDrum';

export type AirDrumStatusState = StatusState<AirDrumLive, 'live'>;

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
    if (live.subframe === 'off-stamps') return `${hand}: sounded ${ms} ms after the strike (prediction off: see below).`;
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

/**
 * Sub-frame prediction's standing in words (#318), or null while it is on: off when the
 * camera's frame stamps are too noisy to carry a fit finer than the frame.
 */
export function describeSubframe(live: AirDrumLive): string | null {
  if (!live.enabled || live.subframe !== 'off-stamps') return null;
  const noise = Number.isFinite(live.stampNoise) ? ` (${Math.round(live.stampNoise * 1000)} ms of jitter)` : '';
  return `Prediction off: this browser's frame timestamps are too noisy${noise} to time a stroke between frames, so hits sound when the camera sees them.`;
}

/** Quantise what the panel shows (the lead to the millisecond). */
export function airDrumLiveKey(l: AirDrumLive): string {
  return `${l.enabled ? 1 : 0}|${l.hits}|${l.predicted}|${l.lastHand ?? '-'}|${l.lastPad ?? '-'}|${Math.round((l.frameAspect ?? 0) * 100)}|${Math.round(l.lastLead * 1000)}|${Math.round(l.lastPull * 1000)}|${l.lastOnTime ?? 'yes'}|${Math.round((l.lastLateBy ?? 0) * 1000)}|${l.magnet ?? 'off'}|${Number.isFinite(l.magnetLag) ? Math.round(l.magnetLag * 1000) : '-'}|${l.ready.right ? 1 : 0}${l.ready.left ? 1 : 0}|${l.subframe ?? 'on'}|${Number.isFinite(l.stampNoise) ? Math.round(l.stampNoise * 1000) : '-'}`;
}

/** The air drum's readout store, reporter and status hook (the shared readout store, #969). */
export const AIR_DRUM_STATUS = createStatusStore(AIR_DRUM_NODE_ID, { absent: ABSENT_AIR_DRUM_LIVE, keyOf: airDrumLiveKey, field: 'live' });

export const useAirDrumStatus = AIR_DRUM_STATUS.useStatus;

/** The per-frame sink over the air drum node (to this store by default). */
export const makeAirDrumReporter = AIR_DRUM_STATUS.makeReporter;
