/**
 * The probe extension (#600 S1): a test-only extension that uses EVERY contribution point the
 * extension contract offers, so a test proves that an extension from OUTSIDE the shipped list
 * reaches each of them (`test/ext_probe.test.tsx`), and a build that lists only the probes
 * carries them and nothing of the shipped extensions (`scripts/check_core_bundle.ts`).
 *
 * Two manifests, because an extension is either eager or lazy: this one is EAGER (a node, a
 * branch with a voice, a dial slice, a transient port, a seed instrument, a training route);
 * `./lazy_stub.ts` is the LAZY one (a node type declared now and loaded on first use).
 *
 * The rule for later steps (`docs/design/vertical-slices.md` §5, S1): every new contribution
 * point is added to the probe FIRST, so it is tested from outside before core relies on it.
 *
 * It imports only what an extension may: the SDK packages and the schema library.
 */
import { z } from 'zod';
import { defineNode, type NodeDef } from '@thoremin/dag';
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice, transientPort } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';

export const PROBE_NODE_TYPE = 'probe-tone';
export const PROBE_NODE_ID = 'probe';
export const PROBE_BRANCH_ID = 'probe-branch';
export const PROBE_TOOL_ID = 'probe-tool';
export const PROBE_INSTRUMENT = 'Probe Instrument';
/** The voice id the probe plays on: far from the trunk's 0 and 1 and the air instruments'. */
export const PROBE_VOICE_ID = 9001;

export const ProbeDialSchema = z.object({ enabled: z.boolean(), freq: z.number().positive() });
export type ProbeDial = z.infer<typeof ProbeDialSchema>;
export const DEFAULT_PROBE: ProbeDial = { enabled: false, freq: 440 };

/** What the transient port carries (set by the host's hot store, off the tick). */
export interface ProbeModel {
  gain: number;
}

/** One voice at the dial's frequency, at the transient model's gain (silent without one). */
export const probeNode = defineNode<Record<string, never>>({
  type: PROBE_NODE_TYPE,
  roles: ['mapping'],
  title: 'Probe tone',
  description: 'A test-only voice: proves an outside extension reaches the graph, the settings and the hot store.',
  inputs: [
    { name: 'cfg', kind: 'probe-config' },
    { name: 'model', kind: 'probe-model' },
  ],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'level', kind: 'number' },
  ],
  params: z.object({}),
  process(inputs) {
    const cfg = (inputs.cfg as ProbeDial | undefined) ?? DEFAULT_PROBE;
    const gain = (inputs.model as ProbeModel | null | undefined)?.gain ?? 0;
    const params: SynthParams = { voices: [{ id: PROBE_VOICE_ID, present: gain > 0, freq: cfg.freq, gain, sound: 'sine' }] };
    return { params, level: gain };
  },
});

export const PROBE_BRANCH = defineBranch({
  id: PROBE_BRANCH_ID,
  description: 'The probe voice (test-only).',
  nodes: [{ id: PROBE_NODE_ID, type: PROBE_NODE_TYPE }],
  edges: [
    { from: { node: TRUNK.ui, port: 'probe' }, to: { node: PROBE_NODE_ID, port: 'cfg' } },
    { from: { node: TRUNK.ui, port: 'probeModel' }, to: { node: PROBE_NODE_ID, port: 'model' } },
  ],
  voices: [{ from: { node: PROBE_NODE_ID, port: 'params' }, role: 'instrument' }],
});

export const PROBE_EXTENSION = defineExtension({
  id: 'probe',
  nodes: [probeNode as unknown as NodeDef<unknown>],
  branches: [PROBE_BRANCH],
  dials: [
    dialSlice({
      key: 'probe',
      schema: ProbeDialSchema.default(DEFAULT_PROBE),
      kind: 'probe-config',
      meta: { facets: ['Probe'], title: 'Probe', description: 'The probe voice (test-only)' },
    }),
  ] as const,
  transient: [transientPort<ProbeModel>()('probeModel', 'probe-model')] as const,
  instruments: [{ name: PROBE_INSTRUMENT, patch: { probe: { enabled: true, freq: 330 } } }],
  training: {
    routes: [{ id: 'probe', label: 'Train the probe', hint: 'Test-only.', tool: PROBE_TOOL_ID }],
    byBranch: [[PROBE_BRANCH_ID, 'probe']],
  },
  derive: (s) => ((s as { probe?: Partial<ProbeDial> }).probe?.enabled === true ? [PROBE_BRANCH_ID] : []),
});

export default PROBE_EXTENSION;
