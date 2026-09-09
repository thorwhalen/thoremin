/**
 * The body→sound routing config (#186 PR E): which body features drive which sound
 * aspects, and the pure function that turns a feature vector into per-effect
 * modulations.
 *
 * It reuses the hand map's effect vocabulary ({@link EFFECTS}: brightness, vibrato,
 * pan, pitch bend, octave, gate) plus `gain`, so a body route lands on exactly the
 * knobs a finger route can — `voice-mapping` applies both the same way. A route's
 * `feature` is any catalog id (a body feature today; the node routes whatever is in
 * the vector it is given), normalised from `[inMin, inMax]` to 0..1, optionally
 * inverted, then smoothed with a one-pole filter so a jittery landmark does not
 * buzz the timbre.
 *
 * Four route slots (`a`..`d`), like the four fingers, rather than an open array:
 * the dial-path machinery (`src/app/commands/paths.ts`) addresses scalar leaves by
 * dotted path through objects with a declared key set, so a fixed set of slots is
 * what makes `bodyMap.routes.a.target` dispatchable from the panel, the palette
 * and the AI assistant. All slots default to `none`, so an instrument that never
 * configures a body route sounds byte-identical.
 */
import { z } from 'zod';
import { EFFECTS, type EffectId } from './hand_map';

/** The sound aspects a body feature can be routed to: the finger effects plus gain. */
export const BODY_ROUTE_TARGETS = [...EFFECTS, 'gain'] as const;
export type BodyRouteTarget = (typeof BODY_ROUTE_TARGETS)[number];

export const BODY_ROUTE_SLOTS = ['a', 'b', 'c', 'd'] as const;
export type BodyRouteSlot = (typeof BODY_ROUTE_SLOTS)[number];

export const BodyRouteSchema = z.object({
  /** A catalog feature id (`body.kin.qom`), or '' for an unset slot. */
  feature: z.string(),
  target: z.enum([...BODY_ROUTE_TARGETS, 'none'] as [BodyRouteTarget | 'none', ...(BodyRouteTarget | 'none')[]]),
  /** The feature value that maps to 0 (and, with `invert`, to 1). */
  inMin: z.number(),
  /** The feature value that maps to 1. */
  inMax: z.number(),
  invert: z.boolean(),
  /** One-pole smoothing 0 (none) .. 0.95 (very slow), stated per 60 Hz tick and made
   *  rate-independent by the router (`alpha = 1 - smoothing^(dt·60)`). */
  smoothing: z.number().min(0).max(0.95),
  /** For the multiplicative targets (`gate`, `gain`): how far below 1 the route can pull.
   *  1 = the full range (level 0 silences); 0.5 = rest sits at half volume, motion adds. */
  depth: z.number().min(0).max(1),
});
export type BodyRoute = z.infer<typeof BodyRouteSchema>;

export const BodyMapSchema = z.object({
  routes: z.object({
    a: BodyRouteSchema,
    b: BodyRouteSchema,
    c: BodyRouteSchema,
    d: BodyRouteSchema,
  }),
});
export type BodyMap = z.infer<typeof BodyMapSchema>;

const OFF: BodyRoute = { feature: '', target: 'none', inMin: 0, inMax: 1, invert: false, smoothing: 0.5, depth: 1 };

/** No routing — byte-identical sound to an instrument without a body map. */
export const DEFAULT_BODY_MAP: BodyMap = {
  routes: { a: { ...OFF }, b: { ...OFF }, c: { ...OFF }, d: { ...OFF } },
};

/**
 * The modulations `voice-mapping` applies on top of the finger effects: additive
 * for the finger effects (0 = no change), multiplicative for `gate` and `gain`
 * (1 = no change). The same shape `fingerEffects` produces, plus `gain`.
 */
export type VoiceMods = Record<EffectId, number> & { gain: number };

export const NEUTRAL_MODS: VoiceMods = {
  brightness: 0,
  vibrato: 0,
  pan: 0,
  pitchBend: 0,
  octave: 0,
  gate: 1,
  gain: 1,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The per-slot smoothed level, carried between ticks by the node, keyed by what the
 *  slot was routing so a re-targeted slot starts fresh instead of smoothing from the
 *  old feature's level. */
export type BodyRouteState = Partial<Record<BodyRouteSlot, { level: number; absentS: number; key: string }>>;

/** How long an absent feature holds its last level before decaying to neutral (seconds). */
export const HOLD_GRACE_S = 0.25;
/** The decay's time constant once the grace has passed (seconds). */
export const DECAY_TAU_S = 0.5;


/**
 * Turn a feature vector into voice modulations under a body map. Pure given the
 * previous per-slot state; returns the next one. `dt` is the seconds since the last
 * call, which makes the smoothing rate-independent (the same dial reads the same at
 * 30 and 60 Hz). A route whose feature is absent from the vector this tick (not
 * computed, NaN-dropped, or the body has left the frame) holds its last level for
 * {@link HOLD_GRACE_S} so a one-frame dropout does not click, then decays toward its
 * neutral level — a route must never leave the instrument stuck at 30 % volume with
 * nobody in frame. Routes sharing a target are averaged (the "combined spread" the
 * hand map uses); `gate` and `gain` multiply, pulled below 1 by the route's `depth`.
 */
export function bodyRouteMods(
  vector: Readonly<Record<string, number>>,
  map: BodyMap,
  prev: BodyRouteState = {},
  dt = 1 / 60,
): { mods: VoiceMods; state: BodyRouteState } {
  const bucket: Partial<Record<BodyRouteTarget, number[]>> = {};
  const state: BodyRouteState = {};
  const step = dt > 0 ? dt : 1 / 60;
  for (const slot of BODY_ROUTE_SLOTS) {
    const r = map.routes[slot];
    if (!r || r.target === 'none' || !r.feature) continue;
    const raw = vector[r.feature];
    const key = `${r.feature}>${r.target}`;
    const was = prev[slot]?.key === key ? prev[slot] : undefined;
    const multiplicative = r.target === 'gate' || r.target === 'gain';
    // The route's level 0..1 (before depth); `alpha` is the per-call smoothing weight.
    const alpha = 1 - Math.pow(r.smoothing, step * 60);
    let level: number;
    let absentS = 0;
    if (Number.isFinite(raw)) {
      const span = r.inMax - r.inMin;
      let x = span !== 0 ? clamp01((raw - r.inMin) / span) : 0;
      if (r.invert) x = 1 - x;
      level = was === undefined ? x : was.level + (x - was.level) * alpha;
    } else if (was !== undefined) {
      absentS = was.absentS + step;
      // Hold through the grace, then decay to the level whose APPLIED value is "no
      // change": 1 for the multiplicative targets (gain/gate stay at 1), 0 for the
      // additive ones — regardless of `invert`, which describes the feature, not the
      // silence. (The first version decayed to the resting FEATURE's level, which left a
      // gain route at `1 - depth` with nobody in frame.)
      const rest = multiplicative ? 1 : 0;
      level = absentS <= HOLD_GRACE_S ? was.level : was.level + (rest - was.level) * (1 - Math.exp(-step / DECAY_TAU_S));
    } else {
      continue;
    }
    state[slot] = { level, absentS, key };
    // Multiplicative targets: 1 at level 1, and `depth` of the way to 0 at level 0.
    const applied = multiplicative ? 1 - r.depth * (1 - level) : level;
    (bucket[r.target] ??= []).push(applied);
  }
  const mods: VoiceMods = { ...NEUTRAL_MODS };
  for (const t of BODY_ROUTE_TARGETS) {
    const a = bucket[t];
    if (!a || !a.length) continue;
    mods[t] = a.reduce((s, x) => s + x, 0) / a.length;
  }
  return { mods, state };
}

/** Zod shape of a `mods` port value, so `runHeadless` refuses a partial record. */
export const VoiceModsSchema = z.object({
  brightness: z.number(),
  vibrato: z.number(),
  pan: z.number(),
  pitchBend: z.number(),
  octave: z.number(),
  gate: z.number(),
  gain: z.number(),
});
