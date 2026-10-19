/**
 * The LAZY probe extension's deferred React half (#600 S1): the components for the stub's
 * section and tool, a status hook and a mount effect, which run once this half loads.
 */
import type { ExtensionUi, ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import { PROBE_LAZY_NODE_ID, PROBE_LAZY_TOOL_ID } from './lazy_stub';

export const probeLazySeen = { ticks: [] as unknown[], mounts: 0 };

function LazyControls() {
  return <p>lazy probe controls</p>;
}

function LazyReadout() {
  return <p>lazy probe readout</p>;
}

function LazyToolPanel({ close }: ExtensionToolPanelProps) {
  return (
    <button type="button" onClick={close}>
      lazy probe tool panel
    </button>
  );
}

export const PROBE_LAZY_UI: ExtensionUi = {
  id: 'probe-lazy',
  panels: [{ instrumentId: 'probe-lazy', section: 'Lazy probe', Controls: LazyControls, Readout: LazyReadout }],
  statusHooks: [
    {
      nodeId: PROBE_LAZY_NODE_ID,
      make: (engine) => () => {
        probeLazySeen.ticks.push(engine.getOutput(PROBE_LAZY_NODE_ID, 'ticks'));
      },
      onRemoved: () => undefined,
      reset: () => undefined,
    },
  ],
  onMount: [
    () => {
      probeLazySeen.mounts += 1;
    },
  ],
  tools: [{ id: PROBE_LAZY_TOOL_ID, label: 'Lazy probe tool', description: 'A test-only tool that loads on first open.', group: 'tool', defaultPinned: false, Panel: LazyToolPanel }],
};

export default PROBE_LAZY_UI;
