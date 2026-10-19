/**
 * The LAZY probe extension's deferred React half (#600 S1): the components for the stub's
 * section and tool, a status hook, a mount effect and the stub's command, which run once this half loads.
 */
import type { ExtensionUi, ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import { defineCommand, ok } from 'acture';
import { z } from 'zod';
import { PROBE_LAZY_COMMAND_ID, PROBE_LAZY_NODE_ID, PROBE_LAZY_TOOL_ID } from './lazy_stub';

export const probeLazySeen = { ticks: [] as unknown[], mounts: 0, pings: 0 };

const lazyPingCmd = defineCommand({
  id: PROBE_LAZY_COMMAND_ID,
  title: 'Lazy probe: ping',
  description: 'A test-only command whose code loads when it first runs.',
  category: 'Probe',
  params: z.object({}),
  execute: async () => {
    probeLazySeen.pings += 1;
    return ok({ pings: probeLazySeen.pings });
  },
});

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
  commands: [lazyPingCmd],
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
