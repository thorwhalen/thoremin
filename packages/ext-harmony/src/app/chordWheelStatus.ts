/**
 * chordWheelStatus: the live chord-wheel state the engine loop reports, for its settings section
 * and the Instruments view (the key, the chord in force, whether the wheel is armed, the last move).
 * The `chordMapStatus` pattern: the DAG produces it, React only displays it.
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_CHORD_WHEEL_STATUS, type ChordWheelStatus } from '../nodes/chord_wheel';

export const CHORD_WHEEL_NODE_ID = 'chordWheel';

export type ChordWheelStatusState = StatusState<ChordWheelStatus, 'live'>;

/** What to tell the player, per state. */
export function describeChordWheelLive(live: ChordWheelStatus): string {
  if (!live.enabled) return 'Off. Tick "Play the chord wheel" (the Chord Wheel and Tonnetz Wheel instruments have it on).';
  if (live.steer === 'signs' || live.steer === 'categorizer') {
    const chord = live.chord ?? '-';
    const what = live.steer === 'signs' ? 'Sign a letter A to G to go to its chord' : 'Hold one of your poses: each makes a move';
    if (live.category === null) return `${chord}. ${what}.`;
    return `${chord}${live.lastMove ? `, after ${live.lastMove}` : ''}. Reading: ${live.category}.`;
  }
  if (live.steer === 'face') {
    const chord = live.chord ? `${live.chord}${live.numeral ? ` (${live.numeral})` : ''}` : '';
    if (live.face === null) return `${chord}. Show your face: each expression makes a move, a neutral face gets ready for the next.`;
    return `${chord}${live.lastMove ? `, after ${live.lastMove}` : ''}. Reading: ${live.face}.`;
  }
  if (!live.steering) return 'Show your steering hand: hold its palm over the middle of the wheel.';
  const chord = live.chord ? `${live.chord}${live.numeral ? ` (${live.numeral})` : ''}` : '';
  if (live.rejected) return `${chord}: that move does not apply to this chord. Choose another.`;
  if (live.walking) return `${chord}, walking ${live.lastMove ?? 'the move'} on the beat. Leave the wedge to stop.`;
  if (!live.armed) return `${chord}${live.lastMove ? `, after ${live.lastMove}` : ''}. Back to the middle for the next move.`;
  return `${chord}. Push toward a move and hold it.`;
}

export function chordWheelLiveKey(l: ChordWheelStatus): string {
  return [l.enabled ? 1 : 0, l.moves, l.steer, l.face ?? '-', l.category ?? '-', l.key, l.steering ? 1 : 0, l.chord ?? '-', l.numeral, l.armed ? 1 : 0, l.moveCount, l.lastMove ?? '-', l.rejected ?? '-', l.walking ? 1 : 0].join('|');
}

/** The chord wheel's readout store, reporter and status hook (the shared readout store, #969). */
export const CHORD_WHEEL_STATUS = createStatusStore(CHORD_WHEEL_NODE_ID, { absent: IDLE_CHORD_WHEEL_STATUS, keyOf: chordWheelLiveKey, field: 'live' });

export const useChordWheelStatus = CHORD_WHEEL_STATUS.useStatus;

/** The per-frame sink over the chord wheel node (to this store by default). */
export const makeChordWheelReporter = CHORD_WHEEL_STATUS.makeReporter;
