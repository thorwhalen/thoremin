/**
 * The faces extension's branch (#330 P4): a personal categorizer in place of the general model
 * for the face chords. It REPLACES core's `face-chord` (rule 5 of `composeGraph`) and joins its
 * own reading to the same chord voice (`face-chord-voice`). The general model stays composed
 * under it (`face-expression`): the node passes its reading through until the personal model
 * has loaded, and whenever this device does not have the categorizer the instrument names.
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }) => ({ from, to: toRef });

export const FACE_CATEGORIZER_NODE_ID = 'faceCat';
export const FACE_CATEGORIZER_BRANCH_ID = 'face-categorizer';

// Core's face nodes this branch reads and feeds (`src/instruments/branches.ts`).
const CAM_FACE = 'camFace';
const GENERAL = 'faceExpr';
const CHORD = 'exprChord';

export const faceCategorizer = defineBranch({
  id: FACE_CATEGORIZER_BRANCH_ID,
  description: 'Your own face categorizer reads the face for the face chords, in place of the general model.',
  requires: ['face-expression', 'face-chord-voice'],
  replaces: ['face-chord'],
  nodes: [{ id: FACE_CATEGORIZER_NODE_ID, type: 'face-categorizer', params: {} }],
  edges: [
    to({ node: CAM_FACE, port: 'face' }, { node: FACE_CATEGORIZER_NODE_ID, port: 'face' }),
    to({ node: GENERAL, port: 'expression' }, { node: FACE_CATEGORIZER_NODE_ID, port: 'general' }),
    to(ui('faceCategorizerModel'), { node: FACE_CATEGORIZER_NODE_ID, port: 'model' }),
    to(ui('faceCategorizer'), { node: FACE_CATEGORIZER_NODE_ID, port: 'config' }),
    to({ node: FACE_CATEGORIZER_NODE_ID, port: 'expression' }, { node: CHORD, port: 'expression' }),
    to({ node: FACE_CATEGORIZER_NODE_ID, port: 'degrees' }, { node: CHORD, port: 'categoryDegrees' }),
    to({ node: FACE_CATEGORIZER_NODE_ID, port: 'expression' }, overlay('expression')),
    to({ node: FACE_CATEGORIZER_NODE_ID, port: 'degrees' }, overlay('categoryDegrees')),
  ],
  overlay: ['faceLandmarks', 'faceExpression', 'chordGuide', 'chordName'],
});

export const FACES_BRANCHES = [faceCategorizer] as const;
