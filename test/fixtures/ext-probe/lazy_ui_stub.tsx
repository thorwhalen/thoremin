/**
 * The LAZY probe extension's eager React stub (#600 S1): its section, its tool and its keybinding as data;
 * the components arrive with `./lazy_ui.tsx`.
 */
import type { ExtensionUiStub } from '@thoremin/sdk-ui/types';
import { PROBE_LAZY_COMMAND_ID, PROBE_LAZY_KEY, PROBE_LAZY_TOOL_ID } from './lazy_stub';

export const PROBE_LAZY_UI_STUB: ExtensionUiStub = {
  id: 'probe-lazy',
  panels: [{ instrumentId: 'probe-lazy', section: 'Lazy probe' }],
  tools: [{ id: PROBE_LAZY_TOOL_ID, label: 'Lazy probe tool', description: 'A test-only tool that loads on first open.', group: 'tool', defaultPinned: false }],
  // Swallowed (handled, nothing run) on a held key's repeat.
  keybindings: [{ key: PROBE_LAZY_KEY, command: PROBE_LAZY_COMMAND_ID, when: (e) => (e?.repeat ? 'swallow' : 'dispatch') }],
};

export default PROBE_LAZY_UI_STUB;
