/**
 * The body slice (#186; a slice since #600 S17b): the second camera branch, the pose model and
 * what reads it. Its source nodes (the webcam, the synthetic body, a replay) fill the shell's
 * `body` slot (`slotCandidates`: the shell keeps the slot and its contract, the slice brings the
 * candidates and the default); `body-source` is the model, its feature vector and the dancer's
 * pulse; `body-route` routes body features onto the hand voices as modulations. Listed in
 * `extensions.json` like any extension, so the core-alone build proves the shell no longer names it.
 *
 * Its branch declares the feature groups it measures (`demands`), so the Lab showing a body group,
 * a tool's claim, the dancer and the body conductor all compose it without naming it (#600 S17a).
 * Its dials keep their core keys: `body` is flat (`body.enabled`, `body.model`), `bodyMap` whole,
 * delivered to `body-route` on its whole-dial port.
 *
 * Kept in core on purpose: the slot's contract (`@thoremin/sdk/sources/body_contract`), the overlay's
 * skeleton element and its body ports (moving them changes the persisted overlay settings), the body
 * conductor (S18), and the SDK's pose catalog and body modality (shared libraries).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { FEATURE_GROUPS, DERIVED_GROUP } from '@thoremin/sdk/features/catalog';
import type { NodeDef } from '@thoremin/dag';
import { webcamBodyNode } from './nodes/webcam_body';
import { syntheticBodyNode } from './nodes/synthetic_body';
import { replayBodyNode } from './nodes/replay_body';
import { bodyFeatureVectorNode } from './nodes/body_feature_vector';
import { bodyPulseNode } from './nodes/body_pulse';
import { bodyRouteNode } from './nodes/body_route';
import { BodyMapSchema, DEFAULT_BODY_MAP, type BodyMap } from './nodes/body_map.schema';
import { BodySettingsSchema, DEFAULT_BODY, type BodySettings } from './schema';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }) => ({ from, to: toRef });

export const BODY_SOURCE_BRANCH_ID = 'body-source';
export const BODY_ROUTE_BRANCH_ID = 'body-route';

/** The feature groups the body measures: what a claim on any of them composes it for. */
export const BODY_GROUP_IDS: readonly string[] = FEATURE_GROUPS.filter((g) => g.source === 'body' && g.id !== DERIVED_GROUP).map((g) => g.id);

export const bodySource = defineBranch({
  id: BODY_SOURCE_BRANCH_ID,
  description: 'The second camera branch: the body model and its feature vector.',
  nodes: [
    { id: 'camBody', slot: 'body', params: {} },
    { id: 'bodyVec', type: 'body-feature-vector', params: {} },
    // The dancer's pulse (#186 PR F): folded into the vector as body.rhythm.*; the
    // pace controller (PR H) reads it too.
    { id: 'bodyPulse', type: 'body-pulse', params: {} },
  ],
  edges: [
    to({ node: 'camBody', port: 'body' }, overlay('bodyFrame')),
    to({ node: 'camBody', port: 'status' }, overlay('bodyStatus')),
    to({ node: 'camBody', port: 'body' }, { node: 'bodyVec', port: 'body' }),
    to({ node: 'camBody', port: 'body' }, { node: 'bodyPulse', port: 'body' }),
    to({ node: 'bodyPulse', port: 'pulse' }, { node: 'bodyVec', port: 'pulse' }),
    to({ node: 'bodyVec', port: 'vector' }, overlay('bodyVector')),
  ],
  overlay: ['bodySkeleton'],
  demands: [...BODY_GROUP_IDS],
});

export const bodyRoute = defineBranch({
  id: BODY_ROUTE_BRANCH_ID,
  description: 'Body features routed onto the hand voices as modulations.',
  requires: [BODY_SOURCE_BRANCH_ID, 'field-voices'],
  nodes: [{ id: 'bodyRoute', type: 'body-route', params: {} }],
  edges: [
    to({ node: 'bodyVec', port: 'vector' }, { node: 'bodyRoute', port: 'vector' }),
    to(ui('bodyMap'), { node: 'bodyRoute', port: 'bodyMap' }),
    to({ node: 'bodyRoute', port: 'mods' }, { node: 'map', port: 'mods' }),
  ],
});

/** Whether any route slot drives something (a route with a feature and a target). */
export function bodyMapRoutesAnything(map: { routes?: Record<string, { target?: string; feature?: string } | undefined> } | undefined): boolean {
  return Object.values(map?.routes ?? {}).some((r) => !!r && r.target !== undefined && r.target !== 'none' && !!r.feature);
}

export const BODY_EXTENSION = defineExtension({
  // The id names what it does: not `body` (core's word for a pose frame, a port, a conductor
  // source), which the ratchet would count in every core file that says it.
  id: 'body-tracking',
  nodes: [webcamBodyNode, syntheticBodyNode, replayBodyNode, bodyFeatureVectorNode, bodyPulseNode, bodyRouteNode] as unknown as NodeDef<unknown>[],
  branches: [bodySource, bodyRoute],
  slotCandidates: [{ slot: 'body', types: ['webcam-body', 'synthetic-body', 'replay-body'], default: 'webcam-body' }],
  dials: [
    dialSlice({
      key: 'body',
      schema: BodySettingsSchema.default(DEFAULT_BODY),
      kind: 'body-config',
      meta: { facets: ['Body'], title: 'Body tracking', description: 'The body source: on/off and the pose model' },
      layout: 'flat',
    }),
    dialSlice({
      key: 'bodyMap',
      schema: BodyMapSchema.default(() => structuredClone(DEFAULT_BODY_MAP)),
      kind: 'body-map',
      meta: { facets: ['Body'], title: 'Body mapping', description: 'Which body features drive which sound aspects' },
    }),
  ] as const,
  derive: (s, context) => {
    const settings = s as { body?: Partial<BodySettings>; bodyMap?: Partial<BodyMap>; handMap?: { maxGain?: number } };
    const enabled = settings.body?.enabled === true;
    // The router modulates the hand voices: it needs the body AND the voices, and a route.
    // A claim (the Lab, a tool) composes the body without turning the router on by itself,
    // but a body composed for a claim routes when the map says so, as it always did.
    const bodyWanted = enabled || context?.implied.has(BODY_SOURCE_BRANCH_ID) === true;
    const fieldVoices = (settings.handMap?.maxGain ?? 1) > 0;
    const ids: string[] = [];
    if (enabled) ids.push(BODY_SOURCE_BRANCH_ID);
    if (bodyWanted && fieldVoices && bodyMapRoutesAnything(settings.bodyMap)) ids.push(BODY_ROUTE_BRANCH_ID);
    return ids;
  },
});

export default BODY_EXTENSION;
