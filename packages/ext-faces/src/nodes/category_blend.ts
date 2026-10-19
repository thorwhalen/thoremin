/**
 * `category-blend` node: continuous control from category memberships (#372). A categorizer's soft
 * memberships (its `category` reading: a bar per category) weigh each category's value from the
 * dial into one number, smoothed, so moving from one of the player's hand shapes or poses to
 * another moves the sound smoothly between the two categories' settings (`@thoremin/sdk/enroll/blend`).
 * What it moves is the dial's choice: the chord's brightness, or its tension (the key's seventh,
 * then ninth, as the face's arousal adds them).
 *
 * Only the categories the player gave a value pull; with none set the blend says nothing, so
 * choosing a target alone changes no chord. While nothing is read (the rest, a stranger: the
 * categories' total membership under {@link MIN_MEMBERSHIP}) the last value holds. Tension is a
 * count of added tones, so it leaves as whole steps through a level tracker with hysteresis and a
 * dwell: a membership's jitter near a step's edge would otherwise add and drop the ninth every few
 * frames (and restart a figuration each time).
 *
 * A mapping node, not a command: it is per-tick and continuous (#87, Decision B). It reads the
 * categorizer chord's reading and feeds the same node back on a delayed edge (one tick later, which
 * a timbre does not hear). Pure and Node-safe.
 */
import { z } from 'zod';
import { defineNode } from '@thoremin/dag';
import type { NodeContext } from '@thoremin/dag';
import { blendByMembership, createSmoother } from '@thoremin/sdk/enroll/blend';
import { createLevelTracker, type LevelTracker } from '@thoremin/sdk/harmony/affect';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import { UNSET_BLEND_VALUE, type CategorizerChordsDial } from '../schema';

/** What the blend feeds the chord: one of its controls, 0..1, or nothing. */
export interface BlendControls {
  brightness?: number;
  tension?: number;
}

/** The tension steps `byTension` adds (seventh, ninth, eleventh or thirteenth). */
const TENSION_STEPS = 3;
/** The tension that adds the seventh alone. */
export const SEVENTH_TENSION = 1 / TENSION_STEPS;
/** The edges between whole steps, where `byTension` rounds (1/6, 1/2, 5/6). */
const TENSION_EDGES = Array.from({ length: TENSION_STEPS }, (_, i) => (i + 0.5) / TENSION_STEPS);
/** How far past an edge the blend must go to change the step. */
const TENSION_MARGIN = 0.08;
/** Total membership below which the categorizer reads nothing (see the header). */
export const MIN_MEMBERSHIP = 0.2;

const Params = z.object({
  /** Seconds the blended value takes to follow (a membership's frame-to-frame jitter is not heard). */
  smoothingS: z.number().min(0).max(2).default(0.15),
  /** Seconds a new tension step must persist before it is heard. */
  tensionDwellS: z.number().min(0).max(2).default(0.15),
});
type Params = z.infer<typeof Params>;

/** The values the player set, by category slot (an unset slot does not pull). */
const setValues = (values: Readonly<Record<string, number>> | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(values ?? {})) if (typeof v === 'number' && v !== UNSET_BLEND_VALUE && v >= 0) out[id] = v;
  return out;
};

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
    let steps: LevelTracker | null = null;
    let lastKey = '';
    return {
      process(inputs, ctx: NodeContext) {
        const config = inputs.config as Partial<CategorizerChordsDial> | undefined;
        const target = config?.blend ?? 'off';
        // A new target or another categorizer starts from its own first reading.
        const key = `${target}|${config?.id ?? ''}`;
        if (key !== lastKey) {
          smoother.reset();
          steps = null;
          lastKey = key;
        }
        if (target === 'off') return { controls: {} satisfies BlendControls };
        const values = setValues(config?.blendValues as Record<string, number> | undefined);
        if (Object.keys(values).length === 0) {
          smoother.reset();
          steps = null;
          return { controls: {} satisfies BlendControls };
        }
        const reading = inputs.category as CategoryScores | undefined;
        const raw = reading?.present && reading.ids ? blendByMembership(reading.ids, reading.scores, values, { minWeight: MIN_MEMBERSHIP }) : null;
        const value = smoother.push(raw, typeof ctx?.dt === 'number' ? ctx.dt : 0);
        if (value === null) return { controls: {} satisfies BlendControls };
        if (target === 'brightness') return { controls: { brightness: value } satisfies BlendControls };
        const now = typeof ctx?.time === 'number' ? ctx.time : 0;
        steps ??= createLevelTracker({ edges: TENSION_EDGES, hysteresis: TENSION_MARGIN, dwellS: p.tensionDwellS, rest: Math.round(value * TENSION_STEPS) });
        // Nothing read pushes the held value, so the step in force holds (a null would walk it to the rest).
        const level = steps.push(value, now);
        return { controls: { tension: level / TENSION_STEPS } satisfies BlendControls };
      },
    };
  },
});
