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
// Core's body and conductor nodes the pose branch reads and feeds.
const BODY_VECTOR = 'bodyVec';
const CONDUCTOR = 'conductor';

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

export const POSE_CATEGORIZER_NODE_ID = 'poseCat';
export const POSE_CATEGORIZER_BRANCH_ID = 'pose-categorizer';

/**
 * A saved pose categorizer, read live (#384): the body source's vector to one of the player's
 * poses, drawn by the overlay's category cues (its own `learnedCategories` input, so it never
 * fans in with the ASL reader's `categories`), and, when the conductor is composed, its
 * transport override (`conductor.transportPose`, optional: absent without the conductor).
 */
export const poseCategorizer = defineBranch({
  id: POSE_CATEGORIZER_BRANCH_ID,
  description: 'Your own pose categorizer reads the body: its category drawn on the video, and optionally the body conductor\'s start, hold and cut-off.',
  requires: ['body-source'],
  nodes: [{ id: POSE_CATEGORIZER_NODE_ID, type: 'pose-categorizer', params: {} }],
  edges: [
    to({ node: BODY_VECTOR, port: 'vector' }, { node: POSE_CATEGORIZER_NODE_ID, port: 'vector' }),
    to(ui('poseCategorizerModel'), { node: POSE_CATEGORIZER_NODE_ID, port: 'model' }),
    to(ui('poseCategorizer'), { node: POSE_CATEGORIZER_NODE_ID, port: 'config' }),
    to({ node: POSE_CATEGORIZER_NODE_ID, port: 'category' }, overlay('learnedCategories')),
    { ...to({ node: POSE_CATEGORIZER_NODE_ID, port: 'transportPose' }, { node: CONDUCTOR, port: 'transportPose' }), optional: true },
  ],
  overlay: ['categoryLabel', 'categoryBars'],
});

export const FACES_BRANCHES = [faceCategorizer, poseCategorizer] as const;
