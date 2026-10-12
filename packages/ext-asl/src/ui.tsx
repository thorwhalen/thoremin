/**
 * The ASL extension's React half: the Sign language editor section and the status hook that
 * mirrors the reader into its readout.
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { AslControls, AslReadout } from './panels/asl';
import { ABSENT_ASL_LIVE, makeAslReporter, useAslStatus } from './app/aslStatus';
import { ASL_SIGNS_NODE_ID } from './branches';

export const ASL_UI: ExtensionUi = {
  id: 'asl',
  panels: [{ instrumentId: 'asl', section: 'Sign language', Controls: AslControls, Readout: AslReadout }],
  statusHooks: [
    {
      nodeId: ASL_SIGNS_NODE_ID,
      make: (engine) => makeAslReporter(engine),
      onRemoved: () => useAslStatus.getState().report(ABSENT_ASL_LIVE),
      reset: () => useAslStatus.getState().reset(),
    },
  ],
  onMount: [],
};

export default ASL_UI;
