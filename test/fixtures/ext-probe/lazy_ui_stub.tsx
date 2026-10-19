/**
 * The LAZY probe extension's eager React stub (#600 S1): its section and its tool as data;
 * the components arrive with `./lazy_ui.tsx`.
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';
import { PROBE_LAZY_TOOL_ID } from './lazy_stub';

export const PROBE_LAZY_UI_STUB: ExtensionUiStub = {
  id: 'probe-lazy',
  panels: [{ instrumentId: 'probe-lazy', section: 'Lazy probe' }],
  tools: [{ id: PROBE_LAZY_TOOL_ID, label: 'Lazy probe tool', description: 'A test-only tool that loads on first open.', group: 'tool', defaultPinned: false }],
};

export default PROBE_LAZY_UI_STUB;
