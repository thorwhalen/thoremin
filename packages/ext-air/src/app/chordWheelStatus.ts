/**
 * chordWheelStatus: the live chord-wheel state the engine loop reports, for its settings section
 * and the Instruments view (the key, the chord in force, whether the wheel is armed, the last move).
 * The `chordMapStatus` pattern: the DAG produces it, React only displays it.
 */
import { create } from 'zustand';
import { IDLE_CHORD_WHEEL_STATUS, type ChordWheelStatus } from '../nodes/chord_wheel';

export const CHORD_WHEEL_NODE_ID = 'chordWheel';

export interface ChordWheelStatusState {
  live: ChordWheelStatus;
  report(live: ChordWheelStatus): void;
  reset(): void;
}

export const useChordWheelStatus = create<ChordWheelStatusState>((set) => ({
  live: IDLE_CHORD_WHEEL_STATUS,
  report: (live) => set({ live }),
  reset: () => set({ live: IDLE_CHORD_WHEEL_STATUS }),
}));

/** What to tell the player, per state. */
export function describeChordWheelLive(live: ChordWheelStatus): string {
  if (!live.enabled) return 'Off. Tick "Play the chord wheel" (the Chord Wheel and Tonnetz Wheel instruments have it on).';
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
  return [l.enabled ? 1 : 0, l.moves, l.steer, l.face ?? '-', l.key, l.steering ? 1 : 0, l.chord ?? '-', l.numeral, l.armed ? 1 : 0, l.moveCount, l.lastMove ?? '-', l.rejected ?? '-', l.walking ? 1 : 0].join('|');
}

export function makeChordWheelReporter(engine: { getOutput(nodeId: string, port: string): unknown }, store: Pick<ChordWheelStatusState, 'report'> = useChordWheelStatus.getState()): () => void {
  let lastKey = '';
  return () => {
    const status = engine.getOutput(CHORD_WHEEL_NODE_ID, 'status') as ChordWheelStatus | undefined;
    if (!status) return;
    const key = chordWheelLiveKey(status);
    if (key === lastKey) return;
    lastKey = key;
    store.report(status);
  };
}
