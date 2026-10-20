/**
 * The conductor slice's React half (#600 S18b): the Conductor tool (its panel hosts what other
 * contributions bring to it: the song slice's "Conduct a recording", the pose entry point), the
 * editor's Conductor section, the status hooks (the conductor's live reading, the "Learn my timing"
 * take, the orchestra's load status; they were hand-wired reporters in `useEngine.ts`), the score
 * loader as a mount effect, the timing commands, and the orchestra's browser engine, installed here
 * so the node's pure side carries no synth.
 */
import { Music2 } from 'lucide-react';
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { dispatchDialSetIn } from '@thoremin/sdk-ui/dials';
import { controls } from '@thoremin/sdk-ui/host';
import { CONDUCTOR_TOOL } from './tool';
import { CONDUCTOR_EXTENSION_ID } from './id';
import ConductorPanel from './panels/ConductorPanel';
import { ConductorControls } from './panels/conductor';
import { makeConductorReporter, useConductorStatus, ABSENT_CONDUCTOR_LIVE, CONDUCTOR_NODE_ID } from './app/conductorStatus';
import { makeLeadCalibrationSink } from './app/conductorLead';
import { makeOrchestraReporter, useOrchestraStatus, ABSENT_ORCHESTRA_STATUS } from './app/orchestraStatus';
import { ORCHESTRA_NODE_ID } from './branches';
import { startScoreLoader } from './app/scoreLoader';
import { CONDUCTOR_TIMING_COMMANDS } from './app/conductorLeadCommands';
import { provideOrchestraEngine } from './nodes/orchestra';
import { useControlsField } from './app/state';
import type { ConductorSettings } from './schema';
// The "Learn my timing" commands' host (keep, clear), installed on import.
import './app/conductorLeadHost';

// The orchestra's browser engine, installed when this half loads (before any engine starts) and
// imported (with `spessasynth_lib`) only when the orchestra is first switched on.
provideOrchestraEngine(async (opts) => (await import('./app/orchestra_engine')).createOrchestraEngine(opts));

const conductorOn = (): boolean => ((controls().get().conductor ?? {}) as Partial<ConductorSettings>).enabled === true;

export const CONDUCTOR_UI: ExtensionUi = {
  id: CONDUCTOR_EXTENSION_ID,
  panels: [{ instrumentId: 'conductor', section: 'Conductor', Controls: ConductorControls, Readout: () => null, readoutOn: () => false }],
  tools: [
    {
      ...CONDUCTOR_TOOL,
      Panel: ConductorPanel,
      icon: Music2,
      // The score plays on with the panel closed: the bar shows it running and carries its stop.
      detached: { useRunning: () => useControlsField(conductorOn), stop: () => void dispatchDialSetIn('conductor.enabled', false), hint: 'stop conducting (the instrument sounds again)' },
    },
  ],
  statusHooks: [
    {
      nodeId: CONDUCTOR_NODE_ID,
      make: (engine) => makeConductorReporter(engine),
      onRemoved: () => useConductorStatus.getState().report(ABSENT_CONDUCTOR_LIVE),
      reset: () => useConductorStatus.getState().reset(),
    },
    {
      // A "Learn my timing" take (#427): the body frames against the click, while one runs.
      nodeId: 'camBody',
      make: (engine, resources) => makeLeadCalibrationSink(engine, resources),
      onRemoved: () => {},
      reset: () => {},
    },
    {
      nodeId: ORCHESTRA_NODE_ID,
      make: (engine) => makeOrchestraReporter(engine),
      onRemoved: () => useOrchestraStatus.getState().report(ABSENT_ORCHESTRA_STATUS),
      reset: () => useOrchestraStatus.getState().reset(),
    },
  ],
  onMount: [startScoreLoader],
  commands: CONDUCTOR_TIMING_COMMANDS,
};

export default CONDUCTOR_UI;
