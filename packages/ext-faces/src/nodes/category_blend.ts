/**
 * `category-blend` node: continuous control from category memberships (#372). A categorizer's soft
 * memberships (its `category` reading: a bar per category) weigh each category's value from the
 * dial into one number, smoothed, so moving from one of the player's hand shapes or poses to
 * another moves the sound smoothly between the two categories' settings (`@thoremin/sdk/enroll/blend`).
 * What it moves is the dial's choice: the chord's brightness, or its tension (the key's seventh,
 * then ninth, as the face's arousal adds them).
 *
 * A mapping node, not a command: it is per-tick and continuous (#87, Decision B). It reads the
 * categorizer chord's reading and feeds the same node back on a delayed edge (one tick later, which
 * a timbre does not hear). Pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { blendByMembership, createSmoother } from '@thoremin/sdk/enroll/blend';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import type { CategorizerChordsDial } from '../schema';

/** What the blend feeds the chord: one of its controls, 0..1, or nothing. */
export interface BlendControls {
  brightness?: number;
  tension?: number;
}

const Params = z.object({
  /** Seconds the blended value takes to follow (a membership's frame-to-frame jitter is not heard). */
  smoothingS: z.number().min(0).max(2).default(0.15),
});
type Params = z.infer<typeof Params>;

export const categoryBlendNode = defineNode<Params>({
  type: 'category-blend',
  roles: ['mapping'],
  title: 'Category blend',
  description:
    "Continuous control from a categorizer's memberships: each category's value, weighed by how much the player is in it, smoothed, to the chord's brightness or tension. Moving between two hand shapes or poses moves the sound between their settings.",
  inputs: [
    // The categorizer's reading: a membership per category, with the categories' ids.
    { name: 'category', kind: 'category-scores' },
    // The categorizer chords' dial: what the blend moves, and each category's value.
    { name: 'config', kind: 'categorizer-chords-config' },
  ],
  outputs: [{ name: 'controls', kind: 'blend-controls' }],
  params: Params,
  make(p) {
    const smoother = createSmoother(p.smoothingS);
    let lastTarget = '';
    return {
      process(inputs, ctx: NodeContext) {
        const config = inputs.config as Partial<CategorizerChordsDial> | undefined;
        const target = config?.blend ?? 'off';
        if (target !== lastTarget) {
          smoother.reset();
          lastTarget = target;
        }
        if (target === 'off') return { controls: {} satisfies BlendControls };
        const reading = inputs.category as CategoryScores | undefined;
        const raw = reading?.present && reading.ids ? blendByMembership(reading.ids, reading.scores, (config?.blendValues ?? {}) as Record<string, number>) : null;
        const value = smoother.push(raw, typeof ctx?.dt === 'number' ? ctx.dt : 0);
        return { controls: (value === null ? {} : { [target]: value }) satisfies BlendControls };
      },
    };
  },
});
