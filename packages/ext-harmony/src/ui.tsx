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
import { CHORD_CHART_STATUS } from './app/chordChartStatus';
import { CHORD_MAP_STATUS } from './app/chordMapStatus';
import { CHORD_WHEEL_STATUS } from './app/chordWheelStatus';
import { HARMONY_EXTENSION_ID } from './id';

export const HARMONY_UI: ExtensionUi = {
  id: HARMONY_EXTENSION_ID,
  panels: [
    { instrumentId: 'chords', section: 'Chord map', Controls: ChordMapControls, Readout: ChordMapReadout },
    { instrumentId: 'wheel', section: 'Chord wheel', Controls: ChordWheelControls, Readout: ChordWheelReadout },
    { instrumentId: 'chart', section: 'Chord chart', Controls: ChordChartControls, Readout: ChordChartReadout },
  ],
  statusHooks: [CHORD_CHART_STATUS.statusHook, CHORD_MAP_STATUS.statusHook, CHORD_WHEEL_STATUS.statusHook],
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
