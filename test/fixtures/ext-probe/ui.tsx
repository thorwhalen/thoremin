/**
 * The probe extension's React half (#600 S1; see `./index.ts`): an editor section with a
 * readout, a status hook, a mount effect, a shell tool that runs detached, an entry point into
 * it, a section in the Conductor panel, a command and a still-sounding note for the muted badge. What each
 * one saw is recorded in {@link probeSeen}, so a test can ask whether the host called it.
 */
import type { ExtensionUi, ExtensionToolPanelProps, ToolSectionContext } from '@thoremin/sdk-ui/types';
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
  /** Whether the probe tool runs detached now (#600 S15), and how often the bar stopped it. */
  running: false,
  stops: 0,
  /** The panel events its section in the Conductor heard, with the context's `conductor.conducts`. */
  events: [] as string[],
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

function ProbeSection({ context }: { context: ToolSectionContext }) {
  return <p>probe section {String(context['conductor.conducts'])}</p>;
}

/** A section the probe hosts in its own tool (#600 S18b): the host renders it inside the panel. */
function ProbeHostedSection({ context }: { context: ToolSectionContext }) {
  return <p>probe hosted section {String(context.mode)}</p>;
}

/** The probe's tool panel: it hosts sections, raises an event to them, and offers the entry points
 *  declared from it, all through the props the host hands it (#600 S18b). */
function ProbeToolPanel({ close, Sections, raise, entryPoints, openEntryPoint }: ExtensionToolPanelProps) {
  const context = { mode: 'probing' };
  return (
    <div>
      <button type="button" onClick={close}>
        probe tool panel
      </button>
      <Sections context={context} />
      <button type="button" onClick={() => raise('ping', context)}>
        probe raise
      </button>
      {entryPoints({ probe: true }).map((e) => (
        <button key={e.id} type="button" onClick={() => openEntryPoint(e)}>
          {e.label}
        </button>
      ))}
    </div>
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
  tools: [
    {
      id: PROBE_TOOL_ID,
      label: 'Probe tool',
      description: 'A test-only tool.',
      group: 'tool',
      defaultPinned: false,
      Panel: ProbeToolPanel,
      // It keeps working with its panel closed (#600 S15): the bar marks it and can stop it.
      detached: {
        useRunning: () => probeSeen.running,
        stop: () => {
          probeSeen.stops += 1;
          probeSeen.running = false;
        },
        hint: 'stop the probe',
      },
    },
  ],
  // A section in the Conductor panel while it conducts a recording, hearing its Start and Stop (#600 S15).
  toolSections: [
    {
      id: 'probe-section',
      from: 'conductor',
      when: { 'conductor.conducts': 'recording' },
      Section: ProbeSection,
      on: {
        start: (c) => void probeSeen.events.push(`start:${String(c['conductor.conducts'])}`),
        stop: (c) => void probeSeen.events.push(`stop:${String(c['conductor.conducts'])}`),
      },
    },
    // ...and one in its own tool, which its panel hosts through the host's props (#600 S18b).
    { id: 'probe-hosted', from: PROBE_TOOL_ID, Section: ProbeHostedSection, on: { ping: (c) => void probeSeen.events.push(`hosted:${String(c.mode)}`) } },
  ],
  entryPoints: [{ id: 'probe-entry', from: PROBE_TOOL_ID, tool: 'probe-lazy-tool', label: 'Open the lazy probe...', when: { probe: true } }],
};

export default PROBE_UI;
