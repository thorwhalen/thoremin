/**
 * The Trainer slice (#160/#163; #600 S16d, id `trainer-tool`): the guided take that learns a
 * player's own categories, as one extension. Its pure half: the HUD pref (`trainerHud`, a
 * per-device `PrefSlice` with a derived port for its element), the snapshot of what the trainer
 * says (a transient), its contributed overlay cue (`trainer-tool/hud`) fed by a branch that joins
 * the trunk, its declared stores, and the training route every instrument falls back to.
 *
 * What stays in core: the category bindings and their dispatcher (the Gestures tool's, #385
 * territory), the live-vector tap and the voice (the SDK's app half), and core's v18 store step on
 * the `trainerHud` blob field. The pure trainer engine (cues, sampler, runner, classifier) is the
 * SDK's (`@thoremin/sdk/enroll`).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, overlayElementId, overlayPortName, transientPort } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { TrainerHudParamsSchema, TRAINER_HUD_PREF, type TrainerHudParams } from './schema';
import { TRAINER_HUD_DECL, TRAINER_HUD_ELEMENT, trainerHudElement } from './nodes/hud';
import type { TrainerHudSnapshot } from './lib/hud';
import { TRAINER_STORES } from './stores';
import { TRAINER_TOOL } from './tool';

export const TRAINER_EXTENSION_ID = 'trainer-tool';
export const TRAINER_HUD_BRANCH = 'trainer-hud';
/** The derived port carrying the HUD pref to the element. */
export const TRAINER_HUD_CONFIG_PORT = 'trainerHudConfig';
/** The transient (and port) carrying what the trainer says. */
export const TRAINER_HUD_SNAPSHOT_PORT = 'trainerHudSnapshot';

const port = (input: string) => ({ node: TRUNK.overlay, port: overlayPortName(TRAINER_EXTENSION_ID, TRAINER_HUD_ELEMENT, input) });

export const TRAINER_HUD = defineBranch({
  id: TRAINER_HUD_BRANCH,
  description: 'The trainer\'s guidance on the video, while a routine runs and the player asks for it.',
  nodes: [],
  edges: [
    { from: { node: TRUNK.ui, port: TRAINER_HUD_CONFIG_PORT }, to: port('hud') },
    { from: { node: TRUNK.ui, port: TRAINER_HUD_SNAPSHOT_PORT }, to: port('snapshot') },
  ],
  overlay: [overlayElementId(TRAINER_EXTENSION_ID, TRAINER_HUD_ELEMENT)],
});

export const TRAINER_EXTENSION = defineExtension({
  id: TRAINER_EXTENSION_ID,
  nodes: [],
  branches: [TRAINER_HUD],
  dials: [] as const,
  prefs: [{ key: TRAINER_HUD_PREF, liveInTab: true, schema: TrainerHudParamsSchema, ports: [{ name: TRAINER_HUD_CONFIG_PORT, kind: 'trainer-hud-config', read: (p: TrainerHudParams) => p }] }],
  transient: [transientPort<TrainerHudSnapshot | null>()(TRAINER_HUD_SNAPSHOT_PORT, 'trainer-hud-snapshot', null)],
  overlay: [TRAINER_HUD_DECL],
  overlayElements: [trainerHudElement],
  stores: Object.values(TRAINER_STORES),
  // The cue is always composed (idle, an early return, until a routine runs), as core's was.
  trunk: [TRAINER_HUD_BRANCH],
  training: {
    // Every instrument no branch leads elsewhere trains here.
    routes: [
      {
        id: 'trainer',
        label: 'Open the Trainer',
        hint: 'A guided take of the faces or moves you can make; the instrument learns your own categories.',
        tool: TRAINER_TOOL.id,
        fallback: true,
      },
    ],
    byBranch: [],
  },
  derive: () => [],
});

export default TRAINER_EXTENSION;
