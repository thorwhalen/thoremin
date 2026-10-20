/**
 * The patcher's React half, DEFERRED (#14): the tool's panel (React Flow and the node inspector)
 * and the status hook that mirrors the live graph into the panel's store. Loaded by the host's
 * build with a dynamic `import()` (`extensions.json`'s `lazy.ui`) the first time the player opens
 * the tool, so none of it, React Flow included, is in the main chunk. From then on the hook runs
 * on every tick and compares one integer (`./app/liveGraph.ts`).
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import PatcherPanel from './panels/PatcherPanel';
import { LIVE_GRAPH_HOOK } from './app/liveGraph';
import { PATCHER_TOOL } from './tools';
import { PATCHER_EXTENSION_ID } from './index';

export const PATCHER_UI: ExtensionUi = {
  id: PATCHER_EXTENSION_ID,
  panels: [],
  statusHooks: [LIVE_GRAPH_HOOK],
  onMount: [],
  tools: [{ ...PATCHER_TOOL, Panel: PatcherPanel }],
};

export default PATCHER_UI;
