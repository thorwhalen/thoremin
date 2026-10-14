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

export const CATEGORIZER_CHORD_NODE_ID = 'catChord';
export const HAND_CHORDS_BRANCH_ID = 'hand-chords';
export const POSE_CHORDS_BRANCH_ID = 'pose-chords';

/** The categorizer chord's edges, but for the vector it reads (#450). */
const chordEdges = (vector: { node: string; port: string }, frame: { node: string; port: string }) => [
  to(vector, { node: CATEGORIZER_CHORD_NODE_ID, port: 'vector' }),
  // The camera frame the vector came from: the hysteresis counts camera frames, not ticks.
  to(frame, { node: CATEGORIZER_CHORD_NODE_ID, port: 'frame' }),
  to(ui('categorizerChordsModel'), { node: CATEGORIZER_CHORD_NODE_ID, port: 'model' }),
  to(ui('categorizerChords'), { node: CATEGORIZER_CHORD_NODE_ID, port: 'config' }),
  to(ui('chordSpec'), { node: CATEGORIZER_CHORD_NODE_ID, port: 'spec' }),
  to(ui('chordConfig'), { node: CATEGORIZER_CHORD_NODE_ID, port: 'chordConfig' }),
  to(ui('octaveShift'), { node: CATEGORIZER_CHORD_NODE_ID, port: 'octaveShift' }),
  // Its own overlay input: never a fan-in with the pose categorizer's or ASL's categories.
  to({ node: CATEGORIZER_CHORD_NODE_ID, port: 'category' }, overlay('chordCategories')),
  // The chord it plays, for the chord name and the chord guide (#491): its own port too.
  to({ node: CATEGORIZER_CHORD_NODE_ID, port: 'triad' }, overlay('categorizerChord')),
];

/**
 * A saved hand-shape categorizer plays chords (#450): the trunk's hand feature vector to one of
 * the player's hand shapes, a chord per category, drawn by the overlay's category cues.
 */
export const handChords = defineBranch({
  id: HAND_CHORDS_BRANCH_ID,
  description: 'Your own hand shapes play chords: each category of a saved hand-shape categorizer a chord on the chord-source scale.',
  nodes: [{ id: CATEGORIZER_CHORD_NODE_ID, type: 'categorizer-chord', params: {} }],
  edges: chordEdges({ node: 'handVec', port: 'vector' }, { node: TRUNK.cam, port: 'hands' }),
  voices: [{ from: { node: CATEGORIZER_CHORD_NODE_ID, port: 'params' }, role: 'instrument' }],
  overlay: ['categoryLabel', 'categoryBars', 'chordName', 'chordGuide'],
});

/** A saved pose categorizer plays chords (#450, and #468): the body source's vector, the same node.
 *  One dial names one categorizer, so only one of the two is ever derived; composing every branch
 *  (`defaultGraph`) would feed the node twice, so this one replaces the hand branch (rule 5). */
export const poseChords = defineBranch({
  id: POSE_CHORDS_BRANCH_ID,
  description: 'Your own poses play chords: each category of a saved pose categorizer a chord on the chord-source scale.',
  requires: ['body-source'],
  replaces: [HAND_CHORDS_BRANCH_ID],
  nodes: [{ id: CATEGORIZER_CHORD_NODE_ID, type: 'categorizer-chord', params: {} }],
  edges: chordEdges({ node: BODY_VECTOR, port: 'vector' }, { node: 'camBody', port: 'body' }),
  voices: [{ from: { node: CATEGORIZER_CHORD_NODE_ID, port: 'params' }, role: 'instrument' }],
  overlay: ['categoryLabel', 'categoryBars', 'chordName', 'chordGuide'],
});

export const FACES_BRANCHES = [faceCategorizer, poseCategorizer, handChords, poseChords] as const;
