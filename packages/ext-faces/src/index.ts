/**
 * The faces extension (#330): personal facial-expression categorizers. A player records a take
 * of their own faces, the take is carved into categories (as many as they choose, neutral
 * counted or set aside), each shown by its faces and named (defaults from the general
 * expression model, one-to-one), and several are saved (P2, P3: the tool "Your faces"). An
 * instrument's face chords then read one of them in place of the general model (P4): the
 * `faceCategorizer` dial names it, the `face-categorizer` branch replaces core's `face-chord`.
 * A saved POSE categorizer plays too (#384): the `poseCategorizer` dial names it, and the
 * `pose-categorizer` branch reads the body for the overlay and, optionally, the conductor.
 *
 * LAZY (`docs/design/lazy-extensions.md`): this file is the eager stub. It carries the dial, the
 * branch as data, the transient the model arrives on, and the derivation, and names its node
 * type in `provides`; the node (`./lazy.ts`) loads the first time a composed graph names it, and
 * the React half (`./lazy_ui.tsx`: the tool, the categorizer section, the model loader) with it
 * or when the tool or the section opens.
 */
import { defineExtension, transientPort } from '@thoremin/sdk/instruments/extension';

import type { FaceCategorizerPlay } from './lib/play';
import type { PoseCategorizerPlay } from './lib/posePlay';
import type { CategorizerChordPlay } from './lib/categorizerChord';
import { FACES_BRANCHES, FACE_CATEGORIZER_BRANCH_ID, HAND_CHORDS_BRANCH_ID, POSE_CATEGORIZER_BRANCH_ID, POSE_CHORDS_BRANCH_ID } from './branches';
import { FACES_DIAL_SLICES } from './dials';
import { CARVE_COMMAND_DECLS } from './carveCommands';
import { FACES_STORES } from './stores';
import { chordModalityOf, isPersonal, playsPoses, type CategorizerChordsDial, type FaceCategorizerDial, type PoseCategorizerDial } from './schema';

export const FACES_EXTENSION = defineExtension({
  id: 'faces',
  // The node type `./lazy.ts` defines (the registry checks the two lists agree on load).
  provides: ['face-categorizer', 'pose-categorizer', 'categorizer-chord', 'category-blend'],
  branches: FACES_BRANCHES,
  dials: FACES_DIAL_SLICES,
  // The carve commands (#600 S11; they were core's), declared here so they are listed before
  // this extension loads; implemented in its deferred React half.
  commandDecls: CARVE_COMMAND_DECLS,
  // What it keeps in the browser (#600 S12), under the keys it has always used.
  stores: Object.values(FACES_STORES),
  // The resolved categorizer, set by the React half off the tick; null until then (and for the
  // general model), when the node passes the general reading through.
  transient: [
    transientPort<FaceCategorizerPlay>()('faceCategorizerModel', 'face-categorizer-model'),
    transientPort<PoseCategorizerPlay>()('poseCategorizerModel', 'pose-categorizer-model'),
    transientPort<CategorizerChordPlay>()('categorizerChordsModel', 'categorizer-chords-model'),
  ],
  // The categorizer chords' instruments, on the shipped demo categorizers (#330 P5, carved from the
  // scripted hand and body, so they play on the synthetic sources too): each hand shape, or each
  // pose, a chord of the key, Auto by position (the strongest chords first). The ids are written out
  // (`sharedChordId` in the app half; a test pins them): importing the shared reader here would put
  // it in the initial bundle.
  instruments: [
    { name: 'Hand-shape Chords', patch: { categorizerChords: { id: 'hand:shared:demo-hand-shapes' } } },
    { name: 'Pose Chords', patch: { categorizerChords: { id: 'body:shared:demo-poses' } } },
  ],
  // A personal face categorizer matters only where the face plays chords; a pose categorizer
  // whenever the instrument names one (it composes the body camera).
  derive: (s) => {
    const dial = (s as { faceCategorizer?: Partial<FaceCategorizerDial> }).faceCategorizer;
    const poses = (s as { poseCategorizer?: Partial<PoseCategorizerDial> }).poseCategorizer;
    // The categorizer chords (#450): the branch of the modality the dial's categorizer is.
    const chords = chordModalityOf((s as { categorizerChords?: Partial<CategorizerChordsDial> }).categorizerChords?.id);
    return [
      ...((s as { faceMapping?: string }).faceMapping === 'chord' && isPersonal(dial) ? [FACE_CATEGORIZER_BRANCH_ID] : []),
      ...(playsPoses(poses) ? [POSE_CATEGORIZER_BRANCH_ID] : []),
      ...(chords === 'hand' ? [HAND_CHORDS_BRANCH_ID] : chords === 'body' ? [POSE_CHORDS_BRANCH_ID] : []),
    ];
  },
});

export default FACES_EXTENSION;
