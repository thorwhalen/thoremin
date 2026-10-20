/**
 * The harmony slice's React half (#674; the air extension's until then): the chord map's, the chord
 * wheel's and the chord chart's editor sections, the status hooks that mirror each node into its
 * readout store, and the mount-time listeners a chord map follows (a MIDI keyboard, the microphone),
 * each listening only while a map follows it.
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { startMidiChordIn } from './app/midiChordIn';
import { startMicChordIn } from './app/micChordIn';
import { startMoveRatings } from './app/moveRatings';
import { ChordMapControls, ChordMapReadout } from './panels/chordMap';
import { ChordWheelControls, ChordWheelReadout } from './panels/chordWheel';
import { ChordChartControls, ChordChartReadout } from './panels/chordChart';
import { useChordChartStatus, makeChordChartReporter, CHORD_CHART_NODE_ID } from './app/chordChartStatus';
import { IDLE_CHORD_CHART_STATUS } from './nodes/chord_chart';
import { useChordMapStatus, makeChordMapReporter, ABSENT_CHORD_MAP_LIVE, CHORD_MAP_NODE_ID } from './app/chordMapStatus';
import { useChordWheelStatus, makeChordWheelReporter, CHORD_WHEEL_NODE_ID } from './app/chordWheelStatus';
import { IDLE_CHORD_WHEEL_STATUS } from './nodes/chord_wheel';
import { HARMONY_EXTENSION_ID } from './id';

export const HARMONY_UI: ExtensionUi = {
  id: HARMONY_EXTENSION_ID,
  panels: [
    { instrumentId: 'chords', section: 'Chord map', Controls: ChordMapControls, Readout: ChordMapReadout },
    { instrumentId: 'wheel', section: 'Chord wheel', Controls: ChordWheelControls, Readout: ChordWheelReadout },
    { instrumentId: 'chart', section: 'Chord chart', Controls: ChordChartControls, Readout: ChordChartReadout },
  ],
  statusHooks: [
    {
      nodeId: CHORD_CHART_NODE_ID,
      make: (engine) => makeChordChartReporter(engine),
      onRemoved: () => useChordChartStatus.getState().report(IDLE_CHORD_CHART_STATUS),
      reset: () => useChordChartStatus.getState().reset(),
    },
    {
      nodeId: CHORD_MAP_NODE_ID,
      make: (engine) => makeChordMapReporter(engine),
      onRemoved: () => useChordMapStatus.getState().report(ABSENT_CHORD_MAP_LIVE),
      reset: () => useChordMapStatus.getState().reset(),
    },
    {
      nodeId: CHORD_WHEEL_NODE_ID,
      make: (engine) => makeChordWheelReporter(engine),
      onRemoved: () => useChordWheelStatus.getState().report(IDLE_CHORD_WHEEL_STATUS),
      reset: () => useChordWheelStatus.getState().reset(),
    },
  ],
  onMount: [
    // H8 of #613: while a chord map follows MIDI, listen to the keyboards (only then).
    () => startMidiChordIn(),
    // H8 of #613: while a chord map follows the microphone, hear it (only then).
    () => startMicChordIn(),
    // #715: the player's ratings of the moves, published for the map's own caption set.
    () => startMoveRatings(),
  ],
};

export default HARMONY_UI;
