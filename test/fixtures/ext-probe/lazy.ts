/**
 * The LAZY probe extension's deferred node half (#600 S1): exactly the types its stub
 * (`./lazy_stub.ts`) `provides`.
 */
import { z } from 'zod';
import { defineNode, type NodeDef } from '@thoremin/dag';
import type { ExtensionNodes, OverlayElementImpl } from '@thoremin/sdk/instruments/extension';
import type { CategoryScores, SynthParams } from '@thoremin/sdk/nodes/domain';
import { PROBE_LAZY_ELEMENT, PROBE_LAZY_NODE_TYPE, type ProbeLazyDial } from './lazy_stub';

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
    { name: 'category', kind: 'category-scores' },
  ],
  params: z.object({}),
  make() {
    let ticks = 0;
    return {
      process(inputs) {
        ticks += 1;
        const on = (inputs.cfg as ProbeLazyDial | undefined)?.enabled === true;
        const params: SynthParams = { voices: [{ id: PROBE_LAZY_VOICE_ID, present: on, freq: 220, gain: on ? 0.5 : 0, sound: 'sine' }] };
        // A player's own categorizer on the category cues (#600 S10b): read while the dial is on.
        const category: CategoryScores = { present: on, label: on ? 'mine' : null, labels: ['mine'], scores: [on ? 1 : 0] };
        return { params, ticks, category };
      },
    };
  },
});

/** The lazy probe's cue: the tick count, in a box the shared cue layout places on the left edge. */
export const probeBadge: OverlayElementImpl = {
  name: PROBE_LAZY_ELEMENT,
  measure: (_frame, inputs) => (typeof inputs.ticks === 'number' ? { w: 80, h: 24 } : null),
  positionOf: () => 'left',
  draw(g, frame, inputs) {
    if (!frame.origin || typeof inputs.ticks !== 'number') return;
    g.fillText(`probe ${inputs.ticks}`, frame.origin.x, frame.origin.y);
  },
};

const PROBE_LAZY_NODES: ExtensionNodes = { nodes: [probeLazyNode as unknown as NodeDef<unknown>], overlayElements: [probeBadge] };

export default PROBE_LAZY_NODES;
