/**
 * The physical theremin slice's React half: its editor section (the switch, the assistance, the
 * antennas and circuits) and its status hook (the node's status into the store the section reads).
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { PhysicalThereminControls, PhysicalThereminReadout } from './panels/PhysicalThereminPanel';
import { THEREMIN_STATUS } from './app/status';
import { PHYSICAL_THEREMIN_DIAL, PHYSICAL_THEREMIN_EXTENSION_ID } from '.';

export const PHYSICAL_THEREMIN_UI: ExtensionUi = {
  id: PHYSICAL_THEREMIN_EXTENSION_ID,
  panels: [{ instrumentId: PHYSICAL_THEREMIN_DIAL, section: 'Physical theremin', Controls: PhysicalThereminControls, Readout: PhysicalThereminReadout }],
  statusHooks: [THEREMIN_STATUS.statusHook],
  onMount: [],
};

export default PHYSICAL_THEREMIN_UI;
