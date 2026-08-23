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
 *
 * **Which strains and dials the gestures drive is a LIVE input, not only a
 * build-time param** (`steerConfig`). That distinction is the whole cost #141
 * identified: a vibe editor that can only change the mapping by rebuilding the
 * graph is not an editor, and rebuilding to change a prompt would reload the ML
 * models to alter a string. The repo's convention applies — static params are
 * the build-time default, the input port is the live override — so an
 * unconnected port changes nothing about how this node behaves today.
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

/**
 * The live-overridable half of {@link Params} — everything that says *what the
 * gestures mean*. Every field is optional and overrides the build-time param of
 * the same name; an omitted field keeps the param. This is the shape a store
 * slice, a dial schema and a vibe editor all speak (#141).
 *
 * Exported because it is a contract between this node and whatever drives it,
 * not an implementation detail: the same schema validates the store value, the
 * persisted dial and the value arriving on the port.
 */
export const SteerConfigSchema = z.object({
  strains: z.array(Strain).optional(),
  dials: z.array(Dial).optional(),
  smoothing: z.number().min(0).max(0.999).optional(),
  throttleSec: z.number().min(0).optional(),
});
export type SteerConfig = z.infer<typeof SteerConfigSchema>;

type Ref = z.infer<typeof FeatureRef>;

/**
 * Smoothing-state keys for a strain/dial list: each entry's own name, made
 * unique by counting repeats (`warm pads#0`, `warm pads#1`).
 *
 * **Identity only — never position.** Position looks like a harmless tiebreaker
 * until you notice that insert, delete and reorder are exactly what a vibe editor
 * is for: keying on position re-keys every entry after the edit point, so adding
 * one prompt would duck every prompt below it back to rest — a dip across the
 * whole mix with no gesture behind it, which is the failure this state is keyed
 * carefully to avoid. Keying on identity alone still gets the intended case
 * right: renaming the prompt at a slot yields a new key, so it eases in fresh.
 *
 * One builder, used by both `process()` and the prune, so the two cannot drift.
 */
function identityKeys(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return `${name}#${n}`;
  });
}

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
    {
      name: 'steerConfig',
      kind: 'steer-config',
      description: 'Live override of strains/dials/smoothing/throttle; unset fields keep the param.',
    },
  ],
  outputs: [{ name: 'steer', kind: 'generative-steer' }],
  params: Params,
  make(p) {
    // Smoothed state, keyed by {@link identityKeys} — the prompt's own text, not
    // its slot. With a fixed config any keying works; with a live one only
    // identity does. Editing the text at a slot makes it a different prompt, so
    // it eases in from rest; adding, removing or reordering its neighbours leaves
    // it exactly where it was.
    const weights = new Map<string, number>();
    const dialVals = new Map<string, number>();
    let strainKeys = identityKeys(p.strains.map((x) => x.text));
    let dialKeys = identityKeys(p.dials.map((x) => x.name));
    let lastEmit = -Infinity;
    let last: GenerativeSteer = { prompts: [], config: {} };

    // The effective config: the build-time params, with any live override applied.
    let cfg: Params = p;
    // Identity of the last value seen on the port, so a stable reference costs
    // nothing per tick — validating a config on every frame would be real work
    // in the hot path for a value that changes when a human edits it.
    let lastRaw: unknown = undefined;
    let warned = false;

    const applyOverride = (raw: unknown, log?: (msg: string) => void): void => {
      if (raw === lastRaw) return;
      lastRaw = raw;
      const next = ((): Params => {
        if (raw === undefined || raw === null) return p;
        const parsed = SteerConfigSchema.safeParse(raw);
        if (!parsed.success) {
          // Never throw from process(): one malformed store write must not stop
          // the instrument. Keep the last good config and say so once.
          if (!warned) {
            warned = true;
            log?.(`indirect-map: ignoring an invalid steerConfig (${parsed.error.message})`);
          }
          return cfg;
        }
        warned = false;
        const o = parsed.data;
        return {
          strains: o.strains ?? p.strains,
          dials: o.dials ?? p.dials,
          smoothing: o.smoothing ?? p.smoothing,
          throttleSec: o.throttleSec ?? p.throttleSec,
        };
      })();
      cfg = next;
      strainKeys = identityKeys(next.strains.map((x) => x.text));
      dialKeys = identityKeys(next.dials.map((x) => x.name));
      // Drop smoothing state the new config no longer has an entry for. Beyond
      // keeping the maps bounded across a long editing session, this is what
      // makes a prompt you deleted and brought back ease in from rest rather than
      // snapping to the momentum it had before you removed it.
      const live = new Set(strainKeys);
      for (const k of weights.keys()) if (!live.has(k)) weights.delete(k);
      const liveDials = new Set(dialKeys);
      for (const k of dialVals.keys()) if (!liveDials.has(k)) dialVals.delete(k);
    };

    // Ease from rest (0) toward the target. With smoothing=0 this is exact
    // (snaps to target each tick); higher smoothing eases in more slowly.
    const smooth = (prev: number | undefined, target: number, smoothing: number): number => {
      const from = prev ?? 0;
      return from + (1 - smoothing) * (target - from);
    };

    return {
      process(inputs, ctx) {
        applyOverride(inputs.steerConfig, ctx.log);
        const f = (inputs.features as HandFeatures | undefined) ?? { left: { ...ABSENT_HAND }, right: { ...ABSENT_HAND } };
        const face = (inputs.face as FaceFeatures | undefined) ?? { ...ABSENT_FACE };

        // Always advance the smoothed state so it tracks even between emits.
        const prompts: WeightedPrompt[] = cfg.strains.map((s, i) => {
          const raw = readFeature(f, face, s);
          const target = rangeMap(raw, s.inMin, s.inMax, s.weightMin, s.weightMax);
          const w = smooth(weights.get(strainKeys[i]), target, cfg.smoothing);
          weights.set(strainKeys[i], w);
          return { text: s.text, weight: Math.round(w * 1000) / 1000 };
        });
        const config: Record<string, number> = {};
        cfg.dials.forEach((d, i) => {
          const raw = readFeature(f, face, d);
          const target = rangeMap(raw, d.inMin, d.inMax, d.outMin, d.outMax);
          const v = smooth(dialVals.get(dialKeys[i]), target, cfg.smoothing);
          dialVals.set(dialKeys[i], v);
          config[d.name] = Math.round(v * 1000) / 1000;
        });

        // Throttle the *emitted* steer; between emits, re-emit the last payload.
        if (ctx.time - lastEmit >= cfg.throttleSec) {
          lastEmit = ctx.time;
          last = { prompts, config };
        }
        return { steer: last };
      },
    };
  },
});
