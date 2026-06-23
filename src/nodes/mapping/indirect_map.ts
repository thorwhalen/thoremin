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
import { ABSENT_FACE, ABSENT_HAND, type FaceFeatures, type HandFeatures, type SingleHandFeatures } from '../domain';
import type { GenerativeSteer, WeightedPrompt } from '../output/generative';

const FeatureRef = z.object({
  /** Which input to read from: a hand feature or a face expression control. */
  source: z.enum(['hand', 'face']).default('hand'),
  /** For source='hand': which hand. */
  hand: z.enum(['left', 'right']).default('right'),
  /**
   * Feature name. hand: x | y | openness | pinch. face: smile | mouthOpen |
   * browRaise | browFurrow | eyeBlink.
   */
  feature: z
    .enum(['x', 'y', 'openness', 'pinch', 'smile', 'mouthOpen', 'browRaise', 'browFurrow', 'eyeBlink'])
    .default('openness'),
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

type Ref = z.infer<typeof FeatureRef>;

function readFeature(hands: HandFeatures, face: FaceFeatures, ref: Ref): number {
  if (ref.source === 'face') {
    if (!face.present) return 0;
    const v = (face as unknown as Record<string, number>)[ref.feature];
    return typeof v === 'number' ? v : 0;
  }
  const h: SingleHandFeatures = hands[ref.hand] ?? ABSENT_HAND;
  if (!h.present) return 0;
  const v = (h as unknown as Record<string, number>)[ref.feature];
  return typeof v === 'number' ? v : 0;
}

export const indirectMapNode = defineNode<Params>({
  type: 'indirect-map',
  roles: ['mapping'],
  title: 'Indirect Map',
  description: 'Gesture features → weighted prompts + config dials (steers a generative engine).',
  inputs: [
    { name: 'features', kind: 'hand-features' },
    { name: 'face', kind: 'face-features' },
  ],
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
        const face = (inputs.face as FaceFeatures | undefined) ?? { ...ABSENT_FACE };

        // Always advance the smoothed state so it tracks even between emits.
        const prompts: WeightedPrompt[] = p.strains.map((s, i) => {
          const raw = readFeature(f, face, s);
          const target = rangeMap(raw, s.inMin, s.inMax, s.weightMin, s.weightMax);
          const w = smooth(weights.get(i), target);
          weights.set(i, w);
          return { text: s.text, weight: Math.round(w * 1000) / 1000 };
        });
        const config: Record<string, number> = {};
        p.dials.forEach((d, i) => {
          const raw = readFeature(f, face, d);
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
