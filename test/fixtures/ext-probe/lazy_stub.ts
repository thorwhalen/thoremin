/**
 * The LAZY probe extension's eager stub (#600 S1; see `./index.ts`): a node type declared now
 * (`provides`) whose code (`./lazy.ts`) the host loads the first time a composed graph names
 * it, a branch that names it, and a dial that implies the branch.
 */
import { z } from 'zod';
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice, overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

export const PROBE_LAZY_NODE_TYPE = 'probe-lazy-tone';
export const PROBE_LAZY_NODE_ID = 'probeLazy';
export const PROBE_LAZY_BRANCH_ID = 'probe-lazy-branch';
export const PROBE_LAZY_TOOL_ID = 'probe-lazy-tool';
/** The lazy probe's command (#600 S11): listed now, its code loaded when it first runs. */
export const PROBE_LAZY_COMMAND_ID = 'probeLazy.ping';
/** The key its React stub binds to it. */
export const PROBE_LAZY_KEY = 'Shift+L';

/** The lazy probe's overlay element (#600 S5): a HUD cue whose drawing code loads with its node. */
export const PROBE_LAZY_ELEMENT = 'badge';
export const PROBE_LAZY_ELEMENT_ID = overlayElementId('probe-lazy', PROBE_LAZY_ELEMENT);

export const ProbeLazyDialSchema = z.object({ enabled: z.boolean() });
export type ProbeLazyDial = z.infer<typeof ProbeLazyDialSchema>;

export const PROBE_LAZY_BRANCH = defineBranch({
  id: PROBE_LAZY_BRANCH_ID,
  description: 'The lazy probe voice (test-only).',
  nodes: [{ id: PROBE_LAZY_NODE_ID, type: PROBE_LAZY_NODE_TYPE }],
  edges: [
    { from: { node: TRUNK.ui, port: 'probeLazy' }, to: { node: PROBE_LAZY_NODE_ID, port: 'cfg' } },
    { from: { node: PROBE_LAZY_NODE_ID, port: 'ticks' }, to: { node: TRUNK.overlay, port: overlayPortName('probe-lazy', PROBE_LAZY_ELEMENT, 'ticks') } },
  ],
  overlay: [PROBE_LAZY_ELEMENT_ID],
  voices: [{ from: { node: PROBE_LAZY_NODE_ID, port: 'params' }, role: 'instrument' }],
  // A categorizer on the category cues (#600 S10b), whose node loads on first use.
  categories: [{ from: { node: PROBE_LAZY_NODE_ID, port: 'category' }, kind: 'categorizer', priority: 5 }],
});

export const PROBE_LAZY_EXTENSION = defineExtension({
  id: 'probe-lazy',
  provides: [PROBE_LAZY_NODE_TYPE],
  overlay: [{ name: PROBE_LAZY_ELEMENT, category: 'output', cue: true, inputs: [{ name: 'ticks', kind: 'number' }] }],
  branches: [PROBE_LAZY_BRANCH],
  commandDecls: [{ id: PROBE_LAZY_COMMAND_ID, title: 'Lazy probe: ping', description: 'A test-only command whose code loads when it first runs.', category: 'Probe', params: z.object({}) }],
  dials: [
    dialSlice({
      key: 'probeLazy',
      schema: ProbeLazyDialSchema.default({ enabled: false }),
      kind: 'probe-lazy-config',
      meta: { facets: ['Probe'], title: 'Lazy probe', description: 'The lazy probe voice (test-only)' },
    }),
  ] as const,
  derive: (s) => ((s as { probeLazy?: Partial<ProbeLazyDial> }).probeLazy?.enabled === true ? [PROBE_LAZY_BRANCH_ID] : []),
});

export default PROBE_LAZY_EXTENSION;
