/**
 * `indirect-map` node — the *indirect* end of the mapping spectrum. Instead of
 * a gesture being a note, a gesture expresses a high-level musical idea: it
 * drives the weights of named text prompts ("strains") and high-level config
 * dials (density, brightness, bpm) that steer a generative engine like Lyria.
 *
 * Pure and deterministic (state = smoothed values + throttle clock from ctx),
 * so it is unit-testable from a recorded `hand-features` stream — the live
 * `lyria` engine node is a separate, browser-only sink behind the
 * GenerativeEngine facade.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { rangeMap } from '@/music/theory';
import { ABSENT_HAND, type HandFeatures, type SingleHandFeatures } from '../domain';
import type { GenerativeSteer, WeightedPrompt } from '../output/generative';

const FeatureRef = z.object({
  hand: z.enum(['left', 'right']).default('right'),
  feature: z.enum(['x', 'y', 'openness', 'pinch']).default('openness'),
  inMin: z.number().default(0),
  inMax: z.number().default(1),
});

const Strain = FeatureRef.extend({
  text: z.string(),
  weightMin: z.number().default(0),
  weightMax: z.number().default(2),
});

const Dial = FeatureRef.extend({
  name: z.string(), // e.g. 'density', 'brightness', 'bpm'
  outMin: z.number().default(0),
  outMax: z.number().default(1),
});

const Params = z.object({
  strains: z.array(Strain).default([]),
  dials: z.array(Dial).default([]),
  /** Exponential smoothing factor 0..1 per update (0 = instant, higher = smoother/slower). */
  smoothing: z.number().min(0).max(0.999).default(0),
  /** Minimum seconds between emitted updates (Lyria likes ~0.2s). 0 = every tick. */
  throttleSec: z.number().min(0).default(0),
});
type Params = z.infer<typeof Params>;

function readFeature(f: HandFeatures, hand: 'left' | 'right', key: 'x' | 'y' | 'openness' | 'pinch'): number {
  const h: SingleHandFeatures = f[hand] ?? ABSENT_HAND;
  return h.present ? h[key] : 0;
}

export const indirectMapNode = defineNode<Params>({
  type: 'indirect-map',
  title: 'Indirect Map',
  description: 'Gesture features → weighted prompts + config dials (steers a generative engine).',
  inputs: [{ name: 'features', kind: 'hand-features' }],
  outputs: [{ name: 'steer', kind: 'generative-steer' }],
  params: Params,
  make(p) {
    const weights = new Map<number, number>(); // strain index -> smoothed weight
    const dialVals = new Map<number, number>(); // dial index -> smoothed value
    let lastEmit = -Infinity;
    let last: GenerativeSteer = { prompts: [], config: {} };

    // Ease from rest (0) toward the target. With smoothing=0 this is exact
    // (snaps to target each tick); higher smoothing eases in more slowly.
    const smooth = (prev: number | undefined, target: number): number => {
      const from = prev ?? 0;
      return from + (1 - p.smoothing) * (target - from);
    };

    return {
      process(inputs, ctx) {
        const f = (inputs.features as HandFeatures | undefined) ?? { left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND } };

        // Always advance the smoothed state so it tracks even between emits.
        const prompts: WeightedPrompt[] = p.strains.map((s, i) => {
          const raw = readFeature(f, s.hand, s.feature);
          const target = rangeMap(raw, s.inMin, s.inMax, s.weightMin, s.weightMax);
          const w = smooth(weights.get(i), target);
          weights.set(i, w);
          return { text: s.text, weight: Math.round(w * 1000) / 1000 };
        });
        const config: Record<string, number> = {};
        p.dials.forEach((d, i) => {
          const raw = readFeature(f, d.hand, d.feature);
          const target = rangeMap(raw, d.inMin, d.inMax, d.outMin, d.outMax);
          const v = smooth(dialVals.get(i), target);
          dialVals.set(i, v);
          config[d.name] = Math.round(v * 1000) / 1000;
        });

        // Throttle the *emitted* steer; between emits, re-emit the last payload.
        if (ctx.time - lastEmit >= p.throttleSec) {
          lastEmit = ctx.time;
          last = { prompts, config };
        }
        return { steer: last };
      },
    };
  },
});
