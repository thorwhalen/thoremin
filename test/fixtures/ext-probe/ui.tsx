/**
 * The probe extension's React half (#600 S1; see `./index.ts`): an editor section with a
 * readout, a status hook, a mount effect, a shell tool, an entry point into it, a command and
 * a still-sounding note for the muted badge. What each
 * one saw is recorded in {@link probeSeen}, so a test can ask whether the host called it.
 */
import type { ExtensionUi, ExtensionToolPanelProps } from '@thoremin/sdk-ui/types';
import { defineCommand, ok } from 'acture';
import { z } from 'zod';
import { PROBE_COMMAND_ID, PROBE_NODE_ID, PROBE_TOOL_ID } from './index';

/** What the host did with the probe's UI contributions, for the test to read. */
export const probeSeen = {
  /** The probe node's `level`, once per tick the status hook ran. */
  levels: [] as unknown[],
  removed: 0,
  resets: 0,
  mounts: 0,
  unmounts: 0,
  /** The `times` of each run of the probe's command. */
  pings: [] as number[],
};

const pingCmd = defineCommand({
  id: PROBE_COMMAND_ID,
  title: 'Probe: ping',
  description: 'A test-only command.',
  category: 'Probe',
  params: z.object({ times: z.number().int().positive().default(1) }),
  execute: async ({ times }) => {
    probeSeen.pings.push(times);
    return ok({ times });
  },
});

function ProbeControls() {
  return <p>probe controls</p>;
}

function ProbeReadout() {
  return <p>probe readout</p>;
}

function ProbeToolPanel({ close }: ExtensionToolPanelProps) {
  return (
    <button type="button" onClick={close}>
      probe tool panel
    </button>
  );
}

export const PROBE_UI: ExtensionUi = {
  id: 'probe',
  panels: [
    {
      instrumentId: 'probe',
      section: 'Probe',
      Controls: ProbeControls,
      Readout: ProbeReadout,
      readoutOn: (s) => (s.probe as { enabled?: boolean } | undefined)?.enabled === true,
    },
  ],
  commands: [pingCmd],
  // What keeps sounding while muted (#600 S13): the probe, while its dial is on.
  stillSounding: [{ id: 'probe', whileMuted: (s) => ((s.probe as { enabled?: boolean } | undefined)?.enabled === true ? 'probe still on' : null) }],
  statusHooks: [
    {
      nodeId: PROBE_NODE_ID,
      make: (engine) => () => {
        probeSeen.levels.push(engine.getOutput(PROBE_NODE_ID, 'level'));
      },
      onRemoved: () => {
        probeSeen.removed += 1;
      },
      reset: () => {
        probeSeen.resets += 1;
      },
    },
  ],
  onMount: [
    () => {
      probeSeen.mounts += 1;
      return () => {
        probeSeen.unmounts += 1;
      };
    },
  ],
  tools: [{ id: PROBE_TOOL_ID, label: 'Probe tool', description: 'A test-only tool.', group: 'tool', defaultPinned: false, Panel: ProbeToolPanel }],
  entryPoints: [{ id: 'probe-entry', from: PROBE_TOOL_ID, tool: 'probe-lazy-tool', label: 'Open the lazy probe...', when: { probe: true } }],
};

export default PROBE_UI;
