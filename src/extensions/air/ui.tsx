/**
 * The air extension's React half (PR 5a of the instruments-as-graphs ADR): the four editor
 * sections, the status hooks that mirror each air node into its readout store (and the
 * live shape taps the enrolment UI reads, the drum's hits tap), and the mount-time effects (the
 * flute's breath demand, the vocabulary loads, the fingering-prior sync, the drum-pattern sync). The panel and store modules
 * live under `./panels/` and `./app/` (5b).
 */
import type { ExtensionUi, StatusHook } from '@/app/extensions/types';
import { AirDrumControls, AirDrumReadout } from '@/extensions/air/panels/airDrum';
import { AirBassControls, AirBassReadout } from '@/extensions/air/panels/airBass';
import { AirGuitarControls, AirGuitarReadout } from '@/extensions/air/panels/airGuitar';
import { AirFluteControls, AirFluteReadout } from '@/extensions/air/panels/airFlute';
import { useAirDrumStatus, makeAirDrumReporter, ABSENT_AIR_DRUM_LIVE, AIR_DRUM_NODE_ID } from '@/extensions/air/app/airDrumStatus';
import { useAirBassStatus, makeAirBassReporter, ABSENT_AIR_BASS_LIVE, AIR_BASS_NODE_ID } from '@/extensions/air/app/airBassStatus';
import { useAirGuitarStatus, makeAirGuitarReporter, ABSENT_AIR_GUITAR_LIVE, AIR_GUITAR_NODE_ID } from '@/extensions/air/app/airGuitarStatus';
import { useAirFluteStatus, makeAirFluteReporter, ABSENT_AIR_FLUTE_LIVE, AIR_FLUTE_NODE_ID } from '@/extensions/air/app/airFluteStatus';
import { makeShapeTap, clearShapes, setShape } from '@/extensions/air/app/shapeTap';
import { loadAirVocabularies, startFlutePriorSync } from '@/extensions/air/app/vocabularyStore';
import { startAirFluteDemand } from '@/extensions/air/app/airFluteDemand';
import { makeHitsTap, clearHits } from '@/extensions/air/app/hitsTap';
import { startPatternPlaySync } from '@/extensions/air/app/patternPlaySync';

/** A live shape tap as a status hook: the enrolment UI reads the latest shape; absent when the node leaves. */
function shapeHook(nodeId: string, port: 'shape' | 'mouth' = 'shape'): StatusHook {
  return {
    nodeId,
    make: (engine) => makeShapeTap(engine, nodeId, port),
    onRemoved: () => setShape(nodeId, null, port),
    reset: () => clearShapes(),
  };
}

export const AIR_UI: ExtensionUi = {
  id: 'air',
  panels: [
    { instrumentId: 'drum', section: 'Air drum', Controls: AirDrumControls, Readout: AirDrumReadout },
    { instrumentId: 'bass', section: 'Air bass', Controls: AirBassControls, Readout: AirBassReadout },
    { instrumentId: 'guitar', section: 'Air guitar', Controls: AirGuitarControls, Readout: AirGuitarReadout },
    { instrumentId: 'flute', section: 'Air flute', Controls: AirFluteControls, Readout: AirFluteReadout },
  ],
  statusHooks: [
    {
      nodeId: AIR_DRUM_NODE_ID,
      make: (engine) => makeAirDrumReporter(engine),
      onRemoved: () => useAirDrumStatus.getState().report(ABSENT_AIR_DRUM_LIVE),
      reset: () => useAirDrumStatus.getState().reset(),
    },
    {
      nodeId: AIR_BASS_NODE_ID,
      make: (engine) => makeAirBassReporter(engine),
      onRemoved: () => useAirBassStatus.getState().report(ABSENT_AIR_BASS_LIVE),
      reset: () => useAirBassStatus.getState().reset(),
    },
    {
      nodeId: AIR_GUITAR_NODE_ID,
      make: (engine) => makeAirGuitarReporter(engine),
      onRemoved: () => useAirGuitarStatus.getState().report(ABSENT_AIR_GUITAR_LIVE),
      reset: () => useAirGuitarStatus.getState().reset(),
    },
    // #269: every hit the air drum decides, for a pattern take to read.
    { nodeId: AIR_DRUM_NODE_ID, make: (engine) => makeHitsTap(engine, AIR_DRUM_NODE_ID), onRemoved: () => {}, reset: () => clearHits() },
    shapeHook(AIR_GUITAR_NODE_ID),
    {
      nodeId: AIR_FLUTE_NODE_ID,
      make: (engine) => makeAirFluteReporter(engine),
      onRemoved: () => useAirFluteStatus.getState().report(ABSENT_AIR_FLUTE_LIVE),
      reset: () => useAirFluteStatus.getState().reset(),
    },
    shapeHook(AIR_FLUTE_NODE_ID, 'shape'),
    shapeHook(AIR_FLUTE_NODE_ID, 'mouth'),
  ],
  onMount: [
    // #249: the flute's breath is the mouth; it claims the mouth features while on.
    () => startAirFluteDemand(),
    // #249: the air instruments play what this player enrolled; read every vocabulary once.
    () => {
      void loadAirVocabularies();
    },
    // #263: the flute's finger model is the enrolment fused with the fingering prior the dial names.
    () => startFlutePriorSync(),
    // #269: the air drum plays the trained pattern the dial names; resolved to the pattern and
    // its model here, off the tick.
    () => startPatternPlaySync(),
  ],
};
