/**
 * The `body_map` node's CONTRACT (#600 S6, the `<node>.schema.ts` pattern): its settings schema,
 * defaults and types, importable without the node's implementation. The node imports them from
 * here and re-exports them, so existing imports of the node keep working; code outside
 * `src/nodes` imports this module.
 */
import { z } from 'zod';
import { EFFECTS } from './hand_map.schema';

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
