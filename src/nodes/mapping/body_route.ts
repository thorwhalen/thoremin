/**
 * `body-route` node (#186 PR E) — a feature vector + a live {@link BodyMap} → the
 * {@link VoiceMods} `voice-mapping` applies on top of the finger effects. This is
 * how a body feature reaches a sound dial: the route says which catalog feature
 * drives brightness / vibrato / pan / pitch bend / octave / gate / gain.
 *
 * The map arrives on a port from `store-controls` (the `bodyMap` dial), so a
 * route edit takes effect next tick with no graph rebuild. The node keeps only the
 * per-slot smoothing state; the routing itself is the pure `bodyRouteMods`. It is
 * named for who needs it first, but routes any vector it is handed — a hand or face
 * feature id in a route works the same.
 */
import { z } from 'zod';
import { defineNode } from '@/dag';
import { BodyMapSchema, DEFAULT_BODY_MAP, NEUTRAL_MODS, VoiceModsSchema, bodyRouteMods, type BodyMap, type BodyRouteState } from './body_map';

const Params = z.object({
  /** Build-time routing; the live `bodyMap` input overrides it. */
  map: BodyMapSchema.default(() => structuredClone(DEFAULT_BODY_MAP)),
});
type Params = z.infer<typeof Params>;

export const bodyRouteNode = defineNode<Params>({
  type: 'body-route',
  roles: ['mapping', 'control'],
  title: 'Body Route',
  description: 'Routes catalog features (body first) to voice modulations — brightness, vibrato, pan, pitch bend, octave, gate, gain — per the body map.',
  inputs: [
    { name: 'vector', kind: 'feature-vector' },
    { name: 'bodyMap', kind: 'body-map', description: 'Live routing config (the bodyMap dial)' },
  ],
  outputs: [{ name: 'mods', kind: 'voice-mods', schema: VoiceModsSchema }],
  params: Params,
  make(p) {
    let state: BodyRouteState = {};
    return {
      process(inputs, ctx) {
        const vector = (inputs.vector as Record<string, number> | undefined) ?? {};
        const live = inputs.bodyMap as BodyMap | undefined;
        const map = live ?? p.map;
        if (!map) return { mods: NEUTRAL_MODS };
        const out = bodyRouteMods(vector, map, state, ctx.dt);
        state = out.state;
        return { mods: out.mods };
      },
    };
  },
});
