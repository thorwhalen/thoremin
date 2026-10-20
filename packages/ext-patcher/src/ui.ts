/**
 * The patcher's EAGER React stub (#14): its one shell tool, as data. Its panel, React Flow and the
 * live-graph hook are the deferred half (`./lazy_ui.tsx`), fetched the first time the tool opens.
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';
import { PATCHER_TOOL } from './tools';
import { PATCHER_EXTENSION_ID } from './index';

export { PATCHER_TOOL };

export const PATCHER_UI_STUB: ExtensionUiStub = {
  id: PATCHER_EXTENSION_ID,
  panels: [],
  tools: [PATCHER_TOOL],
};

export default PATCHER_UI_STUB;
