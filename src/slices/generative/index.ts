/**
 * The generative layer slice (#141 / #188; a slice since #600 S14): gesture features steering a
 * cloud generative engine (Lyria RealTime) through `indirect-map → lyria`, with its dial, its
 * transport (a transient field), its branch, and in its React half (`./ui.tsx`) the Generative
 * editor section, its status, the `steer.*` and transport commands, the `p` key, and the engine
 * factory (the key read through the SDK's key seam; `@google/genai` loaded only on demand).
 *
 * Its dial is FLAT, with the keys it had in core (`steer.enabled`, `steer.volume`, and the steering
 * config under `steerConfig`), so a saved instrument and a bound command keep theirs; the node's
 * live inputs are derived from it (`ports`), so the graph is unchanged. The id names the feature
 * and is none of its node types or branch id (which the core bundle may not carry).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice, transientPort } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { NodeDef } from '@thoremin/dag';
import { indirectMapNode } from './nodes/indirect_map';
import { lyriaNode } from './nodes/lyria';
import { DEFAULT_STEER_CONFIG } from './nodes/indirect_map.schema';
import { DEFAULT_STEER, SteerSettingsSchema, completeSteerConfig, type SteerSettings } from './schema';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }, optional = false) => (optional ? { from, to: toRef, optional } : { from, to: toRef });

export const GENERATIVE_BRANCH_ID = 'generative';

export const generative = defineBranch({
  id: GENERATIVE_BRANCH_ID,
  description: 'Gestures steer a generative model (indirect map into Lyria); the face input is a nicety.',
  nodes: [
    { id: 'imap', type: 'indirect-map', params: DEFAULT_STEER_CONFIG },
    { id: 'gen', type: 'lyria', params: {} },
  ],
  edges: [
    to({ node: TRUNK.feat, port: 'features' }, { node: 'imap', port: 'features' }),
    to({ node: 'faceFeat', port: 'features' }, { node: 'imap', port: 'face' }, true),
    to(ui('steerConfig'), { node: 'imap', port: 'steerConfig' }),
    to({ node: 'imap', port: 'steer' }, { node: 'gen', port: 'steer' }),
    to(ui('steerEnabled'), { node: 'gen', port: 'enabled' }),
    to(ui('steerPlaying'), { node: 'gen', port: 'playing' }),
    to(ui('steerVolume'), { node: 'gen', port: 'volume' }),
  ],
});

export const GENERATIVE_EXTENSION = defineExtension({
  id: 'generative-layer',
  nodes: [indirectMapNode, lyriaNode] as unknown as NodeDef<unknown>[],
  branches: [generative],
  dials: [
    dialSlice({
      key: 'steer',
      schema: SteerSettingsSchema.default(DEFAULT_STEER),
      kind: 'steer-settings',
      meta: { facets: ['Generative'], title: 'Generative layer', description: 'Gestures steering a cloud generative engine' },
      layout: 'flat',
      flatKeys: { config: 'steerConfig' },
      complete: { config: completeSteerConfig },
      ports: [
        { name: 'steerEnabled', kind: 'boolean', read: (d: SteerSettings) => d.enabled },
        // A tool claim (the Trainer) quiets the generative layer too: it is not a voice at the
        // merge, so the merge's mute cannot reach it.
        { name: 'steerVolume', kind: 'number', read: (d: SteerSettings, host) => (host.claimed ? 0 : d.volume) },
        { name: 'steerConfig', kind: 'steer-config', read: (d: SteerSettings) => d.config },
      ],
    }),
  ] as const,
  // The transport: transient, never persisted, always off after a reload (`false`, as in core).
  transient: [transientPort<boolean>()('steerPlaying', 'boolean', false)] as const,
  derive: (s) => ((s as { steer?: Partial<SteerSettings> }).steer?.enabled === true ? [GENERATIVE_BRANCH_ID] : []),
});

export default GENERATIVE_EXTENSION;
