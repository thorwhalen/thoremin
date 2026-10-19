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
const face = (port: string) => ({ node: FACE_CATEGORIZER_NODE_ID, port });

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
    to({ node: CAM_FACE, port: 'face' }, face('face')),
    to({ node: GENERAL, port: 'expression' }, face('general')),
    to(ui('faceCategorizerModel'), face('model')),
    to(ui('faceCategorizer'), face('config')),
    to(face('expression'), { node: CHORD, port: 'expression' }),
    to(face('degrees'), { node: CHORD, port: 'categoryDegrees' }),
    to(face('targets'), { node: CHORD, port: 'categoryTargets' }),
    to(face('expression'), overlay('expression')),
    to(face('degrees'), overlay('categoryDegrees')),
    to(face('targets'), overlay('categoryTargets')),
  ],
  overlay: ['faceLandmarks', 'faceExpression', 'chordGuide', 'chordName'],
});

export const POSE_CATEGORIZER_NODE_ID = 'poseCat';
export const POSE_CATEGORIZER_BRANCH_ID = 'pose-categorizer';

/**
 * A saved pose categorizer, read live (#384): the body source's vector to one of the player's
 * poses, drawn by the overlay's category cues (a categorizer reader, #600 S10b: the composer gives
 * it an input of the overlay's pool, so it never fans in with another reader), and, when the conductor is composed, its
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
    { ...to({ node: POSE_CATEGORIZER_NODE_ID, port: 'transportPose' }, { node: CONDUCTOR, port: 'transportPose' }), optional: true },
  ],
  // Above the categorizer chord's reading while both read (the order the cues always had).
  categories: [{ from: { node: POSE_CATEGORIZER_NODE_ID, port: 'category' }, kind: 'categorizer', priority: 20 }],
  overlay: ['categoryLabel', 'categoryBars'],
});

export const CATEGORIZER_CHORD_NODE_ID = 'catChord';
export const CATEGORY_BLEND_NODE_ID = 'catBlend';
export const HAND_CHORDS_BRANCH_ID = 'hand-chords';
export const POSE_CHORDS_BRANCH_ID = 'pose-chords';

const chord = (port: string) => ({ node: CATEGORIZER_CHORD_NODE_ID, port });
const blend = (port: string) => ({ node: CATEGORY_BLEND_NODE_ID, port });

/** The categorizer chord's edges, but for the vector it reads (#450). */
const chordEdges = (vector: { node: string; port: string }, frame: { node: string; port: string }) => [
  to(vector, chord('vector')),
  // The camera frame the vector came from: the hysteresis counts camera frames, not ticks.
  to(frame, chord('frame')),
  to(ui('categorizerChordsModel'), chord('model')),
  to(ui('categorizerChords'), chord('config')),
  to(ui('chordSpec'), chord('spec')),
  to(ui('chordConfig'), chord('chordConfig')),
  to(ui('octaveShift'), chord('octaveShift')),
  // The category blend (#372), fed back a tick later.
  to(chord('category'), blend('category')),
  to(ui('categorizerChords'), blend('config')),
  { ...to(blend('controls'), chord('controls')), delayed: true },
];

/** The categorizer chord's priority on the chord display: below every other producer's (the face
 *  chords 30 and 20, the sign and map chords 10, the wheel 8), so it shows only while none sounds,
 *  as it always did (#491). A test keeps it the lowest declared. */
export const CATEGORIZER_CHORD_PRIORITY = 0;

/** The categorizer chord's nodes and voices, and what it shows (#600 S10b): its reading on the category
 *  cues, below the pose categorizer's, and its chord on the chord display (#491), below every other. */
const chordShows = {
  nodes: [
    { id: CATEGORIZER_CHORD_NODE_ID, type: 'categorizer-chord', params: {} },
    { id: CATEGORY_BLEND_NODE_ID, type: 'category-blend', params: {} },
  ],
  voices: [{ from: chord('params'), role: 'instrument' as const }],
  categories: [{ from: chord('category'), kind: 'categorizer' as const, priority: 10 }],
  chords: [{ from: chord('triad'), priority: CATEGORIZER_CHORD_PRIORITY }],
  overlay: ['categoryLabel', 'categoryBars', 'chordName', 'chordGuide'],
};

/**
 * A saved hand-shape categorizer plays chords (#450): the trunk's hand feature vector to one of
 * the player's hand shapes, a chord per category, drawn by the overlay's category cues.
 */
export const handChords = defineBranch({
  id: HAND_CHORDS_BRANCH_ID,
  description: 'Your own hand shapes play chords: each category of a saved hand-shape categorizer a chord on the chord-source scale.',
  edges: chordEdges({ node: 'handVec', port: 'vector' }, { node: TRUNK.cam, port: 'hands' }),
  ...chordShows,
});

/** A saved pose categorizer plays chords (#450, and #468): the body source's vector, the same node.
 *  One dial names one categorizer, so only one of the two is ever derived; composing every branch
 *  (`defaultGraph`) would feed the node twice, so this one replaces the hand branch (rule 5). */
export const poseChords = defineBranch({
  id: POSE_CHORDS_BRANCH_ID,
  description: 'Your own poses play chords: each category of a saved pose categorizer a chord on the chord-source scale.',
  requires: ['body-source'],
  replaces: [HAND_CHORDS_BRANCH_ID],
  edges: chordEdges({ node: BODY_VECTOR, port: 'vector' }, { node: 'camBody', port: 'body' }),
  ...chordShows,
});

export const FACES_BRANCHES = [faceCategorizer, poseCategorizer, handChords, poseChords] as const;
