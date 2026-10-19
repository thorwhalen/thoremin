/**
 * The LAZY probe extension's eager stub (#600 S1; see `./index.ts`): a node type declared now
 * (`provides`) whose code (`./lazy.ts`) the host loads the first time a composed graph names
 * it, a branch that names it, and a dial that implies the branch.
 */
import { z } from 'zod';
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

export const PROBE_LAZY_NODE_TYPE = 'probe-lazy-tone';
export const PROBE_LAZY_NODE_ID = 'probeLazy';
export const PROBE_LAZY_BRANCH_ID = 'probe-lazy-branch';
export const PROBE_LAZY_TOOL_ID = 'probe-lazy-tool';

export const ProbeLazyDialSchema = z.object({ enabled: z.boolean() });
export type ProbeLazyDial = z.infer<typeof ProbeLazyDialSchema>;

export const PROBE_LAZY_BRANCH = defineBranch({
  id: PROBE_LAZY_BRANCH_ID,
  description: 'The lazy probe voice (test-only).',
  nodes: [{ id: PROBE_LAZY_NODE_ID, type: PROBE_LAZY_NODE_TYPE }],
  edges: [{ from: { node: TRUNK.ui, port: 'probeLazy' }, to: { node: PROBE_LAZY_NODE_ID, port: 'cfg' } }],
  voices: [{ from: { node: PROBE_LAZY_NODE_ID, port: 'params' }, role: 'instrument' }],
});

export const PROBE_LAZY_EXTENSION = defineExtension({
  id: 'probe-lazy',
  provides: [PROBE_LAZY_NODE_TYPE],
  branches: [PROBE_LAZY_BRANCH],
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
