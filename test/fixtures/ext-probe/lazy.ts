/**
 * The LAZY probe extension's deferred node half (#600 S1): exactly the types its stub
 * (`./lazy_stub.ts`) `provides`.
 */
import { z } from 'zod';
import { defineNode, type NodeDef } from '@thoremin/dag';
import type { ExtensionNodes } from '@thoremin/sdk/instruments/extension';
import type { SynthParams } from '@thoremin/sdk/nodes/domain';
import { PROBE_LAZY_NODE_TYPE, type ProbeLazyDial } from './lazy_stub';

/** The lazy probe's voice id. */
export const PROBE_LAZY_VOICE_ID = 9002;

export const probeLazyNode = defineNode<Record<string, never>>({
  type: PROBE_LAZY_NODE_TYPE,
  roles: ['mapping'],
  title: 'Lazy probe tone',
  description: 'A test-only voice whose code loads on first use.',
  inputs: [{ name: 'cfg', kind: 'probe-lazy-config' }],
  outputs: [
    { name: 'params', kind: 'synth-params' },
    { name: 'ticks', kind: 'number' },
  ],
  params: z.object({}),
  make() {
    let ticks = 0;
    return {
      process(inputs) {
        ticks += 1;
        const on = (inputs.cfg as ProbeLazyDial | undefined)?.enabled === true;
        const params: SynthParams = { voices: [{ id: PROBE_LAZY_VOICE_ID, present: on, freq: 220, gain: on ? 0.5 : 0, sound: 'sine' }] };
        return { params, ticks };
      },
    };
  },
});

const PROBE_LAZY_NODES: ExtensionNodes = { nodes: [probeLazyNode as unknown as NodeDef<unknown>] };

export default PROBE_LAZY_NODES;
