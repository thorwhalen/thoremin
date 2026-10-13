/**
 * The faces extension (#330): personal facial-expression categorizers. A player records a take
 * of their own faces, the take is carved into categories (as many as they choose, neutral
 * counted or set aside), each shown by its faces and named (defaults from the general
 * expression model, one-to-one), and several are saved (P2, P3: the tool "Your faces"). An
 * instrument's face chords then read one of them in place of the general model (P4): the
 * `faceCategorizer` dial names it, the `face-categorizer` branch replaces core's `face-chord`.
 *
 * LAZY (`docs/design/lazy-extensions.md`): this file is the eager stub. It carries the dial, the
 * branch as data, the transient the model arrives on, and the derivation, and names its node
 * type in `provides`; the node (`./lazy.ts`) loads the first time a composed graph names it, and
 * the React half (`./lazy_ui.tsx`: the tool, the categorizer section, the model loader) with it
 * or when the tool or the section opens.
 */
import { defineExtension, transientPort } from '@thoremin/sdk/instruments/extension';
import type { FaceCategorizerPlay } from './lib/play';
import { FACES_BRANCHES, FACE_CATEGORIZER_BRANCH_ID } from './branches';
import { FACES_DIAL_SLICES } from './dials';
import { isPersonal, type FaceCategorizerDial } from './schema';

export const FACES_EXTENSION = defineExtension({
  id: 'faces',
  // The node type `./lazy.ts` defines (the registry checks the two lists agree on load).
  provides: ['face-categorizer'],
  branches: FACES_BRANCHES,
  dials: FACES_DIAL_SLICES,
  // The resolved categorizer, set by the React half off the tick; null until then (and for the
  // general model), when the node passes the general reading through.
  transient: [transientPort<FaceCategorizerPlay>()('faceCategorizerModel', 'face-categorizer-model')],
  // A personal categorizer matters only where the face plays chords.
  derive: (s) => {
    const dial = (s as { faceCategorizer?: Partial<FaceCategorizerDial> }).faceCategorizer;
    return (s as { faceMapping?: string }).faceMapping === 'chord' && isPersonal(dial) ? [FACE_CATEGORIZER_BRANCH_ID] : [];
  },
});

export default FACES_EXTENSION;
