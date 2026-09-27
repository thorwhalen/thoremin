/**
 * The branch table: today's instrument graph, cut along the lines every instrument shares
 * and the lines each capability draws (`docs/design/instruments-as-graphs-and-extensions.md`
 * §3.4). `composeGraph(ALL_BRANCH_IDS, BRANCHES)` reproduces the graph `defaultGraph()` has
 * always built (pinned by `test/instruments/golden_graph.test.ts`); an instrument that
 * composes fewer branches simply has fewer nodes.
 *
 * Where a node lives is decided by who needs it, not by what it does:
 *
 *  - The TRUNK holds what every instrument shares: the hand source and its features, the UI
 *    bridge, the merge, the synth, the overlay, and the two shell-level readers of the hands
 *    (the gesture classifier that drives command dispatch, and the hand feature vector that
 *    the Lab and the Trainer read). They cost an early return per tick when idle and are
 *    gated by their own tools, so they are not worth a branch each.
 *  - `face-source` holds the face model AND the two cheap nodes every face consumer wants
 *    (smoothed features, the chord selector), so a consumer's edges into them never dangle.
 *  - A branch that only WIRES existing nodes together is legal and useful: `face-timbre` is
 *    one edge (the smoothed face features into the hand voices' `face` input).
 *  - `demands` is on the branch a live feature claim IMPLIES (the face and body sources),
 *    not on the branch that raises the claim: the flute asks for mouth features, and what
 *    that implies is the face source.
 *  - Cross-branch edges are declared by the consumer and marked `optional` where the far
 *    node is a nicety (the generative branch's face input, the drum's conductor clock, the
 *    body router's hook into the hand voices, the flute's breath inputs), and `requires`
 *    where it is the point (face chords without a face source mean nothing).
 *
 * The right-hand "derivation" (which dials imply which branch) is not in this file: it is
 * PR 3's `graphFor`, and until then every instrument composes every branch.
 */
import { DEFAULT_STEER_CONFIG } from '@/settings/schema';
import { DEMO_SCALE_NOTES } from '@/nodes/music/score';
import { BODY_GROUP_IDS, FACE_GROUP_IDS } from '@/features/labConfig';
import { defineBranch, type GraphBranch } from './branch';

/** The trunk branch's id: implied by every spec, never listed as a feature. */
export const TRUNK_ID = 'trunk';

/** Node ids the trunk owns; branches wire to these by name. */
export const TRUNK = {
  cam: 'cam',
  feat: 'feat',
  ui: 'ui',
  merge: 'merge',
  synth: 'synth',
  overlay: 'overlay',
} as const;

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }, optional = false) =>
  optional ? { from, to: toRef, optional: true } : { from, to: toRef };

export const trunk = defineBranch({
  id: 'trunk',
  description: 'What every instrument shares: hands in, the UI bridge, the merge, the synth, the overlay.',
  nodes: [
    { id: TRUNK.cam, slot: 'source', params: {}, paramsByType: { 'webcam-hands': { modelType: 'full', maxHands: 2 } } },
    { id: TRUNK.feat, type: 'hand-features', params: { mirrorX: true, mirrorHandedness: true } },
    { id: 'handVec', type: 'hand-feature-vector', params: {} },
    { id: 'gesture', type: 'gesture-classifier', params: {} },
    { id: TRUNK.ui, type: 'store-controls' },
    { id: TRUNK.merge, type: 'synth-merge', params: {} },
    { id: TRUNK.synth, type: 'webaudio-synth' },
    { id: TRUNK.overlay, type: 'canvas-overlay', params: {} },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: TRUNK.feat, port: 'hands' }),
    to({ node: TRUNK.cam, port: 'hands' }, overlay('hands')),
    to({ node: TRUNK.feat, port: 'features' }, overlay('features')),
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'handVec', port: 'hands' }),
    to({ node: 'handVec', port: 'vector' }, overlay('handVector')),
    to({ node: TRUNK.feat, port: 'features' }, { node: 'gesture', port: 'features' }),
    // `muteAll` is the player's mute OR a tool's hush claim; `hushVoices` silences every
    // instrument voice but keeps the conducted score. See `hushOf` in store-controls.
    to(ui('muteAll'), { node: TRUNK.merge, port: 'mute' }),
    to(ui('hushVoices'), { node: TRUNK.merge, port: 'hush' }),
    to({ node: TRUNK.merge, port: 'params' }, { node: TRUNK.synth, port: 'params' }),
    to({ node: TRUNK.merge, port: 'params' }, overlay('params')),
    to(ui('scaleRight'), overlay('scale')),
    to(ui('scaleLeft'), overlay('scaleLeft')),
    to(ui('octaveShift'), overlay('octaveShift')),
    to(ui('chordScale'), overlay('chordScale')),
    to(ui('overlay'), overlay('overlayConfig')),
    // The composed element set (the ADR, §3.2 rule 4): the host writes it to the hot store,
    // `store-controls` emits it, the overlay draws only these. Data on a port, not a param.
    to(ui('graphElements'), overlay('elements')),
  ],
  overlay: ['video', 'landmarks', 'featureLab', 'featureCorrelation', 'tagHud', 'trainerHud'],
});

export const fieldVoices = defineBranch({
  id: 'field-voices',
  description: 'The field instruments: the hand plays a note field laid across the screen (the mapping slot).',
  nodes: [{ id: 'map', slot: 'mapping', params: { magnetism: 0.8, maxGain: 0.5 } }],
  edges: [
    to({ node: TRUNK.feat, port: 'features' }, { node: 'map', port: 'features' }),
    to(ui('magnetism'), { node: 'map', port: 'magnetism' }),
    to(ui('octaveShift'), { node: 'map', port: 'octaveShift' }),
    to(ui('mute'), { node: 'map', port: 'mute' }),
    to(ui('scaleRight'), { node: 'map', port: 'scaleRight' }),
    to(ui('scaleLeft'), { node: 'map', port: 'scaleLeft' }),
    to(ui('soundRight'), { node: 'map', port: 'soundRight' }),
    to(ui('soundLeft'), { node: 'map', port: 'soundLeft' }),
  ],
  voices: [{ from: { node: 'map', port: 'params' }, role: 'instrument' }],
  overlay: ['scaleGuide', 'markers', 'indexGuide', 'fingerLines', 'fingerBars', 'timbreLevels', 'keyboardStrip'],
});

export const faceSource = defineBranch({
  id: 'face-source',
  description: 'The face model, its smoothed features and vector, and the chord selector every face consumer feeds.',
  nodes: [
    { id: 'camFace', type: 'webcam-face', params: {} },
    { id: 'faceFeat', type: 'face-features', params: { smoothing: 0.3 } },
    { id: 'faceVec', type: 'face-feature-vector', params: {} },
    { id: 'chordSel', type: 'chord-select', params: {} },
  ],
  edges: [
    to({ node: 'camFace', port: 'face' }, { node: 'faceFeat', port: 'face' }),
    to({ node: 'camFace', port: 'face' }, { node: 'faceVec', port: 'face' }),
    to({ node: 'camFace', port: 'face' }, overlay('faceFrame')),
    to({ node: 'faceVec', port: 'vector' }, overlay('faceVector')),
    to({ node: 'chordSel', port: 'chord' }, overlay('chord')),
  ],
  // No elements of its own: a face borrowed for a breath or a Lab meter draws nothing. The
  // mesh belongs to the branches where the face PLAYS (timbre, chord, controls).
  overlay: [],
  demands: [...FACE_GROUP_IDS],
});

export const faceTimbre = defineBranch({
  id: 'face-timbre',
  description: 'Smile to brightness, mouth to vibrato: the smoothed face features colour the hand voices.',
  requires: ['face-source', 'field-voices'],
  edges: [to({ node: 'faceFeat', port: 'features' }, { node: 'map', port: 'face' })],
  overlay: ['faceLandmarks'],
});

export const faceChord = defineBranch({
  id: 'face-chord',
  description: 'Expression to a diatonic chord: the expression classifier and the expression chord.',
  requires: ['face-source'],
  nodes: [
    { id: 'faceExpr', slot: 'expression', params: {} },
    { id: 'exprChord', type: 'expression-chord', params: {} },
  ],
  edges: [
    to({ node: 'camFace', port: 'face' }, { node: 'faceExpr', port: 'face' }),
    to(ui('expressionSensitivity'), { node: 'faceExpr', port: 'sensitivity' }),
    to({ node: 'faceExpr', port: 'expression' }, { node: 'exprChord', port: 'expression' }),
    to(ui('chordSpec'), { node: 'exprChord', port: 'spec' }),
    to(ui('expressionDegrees'), { node: 'exprChord', port: 'degrees' }),
    to(ui('faceMapping'), { node: 'exprChord', port: 'faceMapping' }),
    to(ui('chordConfig'), { node: 'exprChord', port: 'chordConfig' }),
    to(ui('octaveShift'), { node: 'exprChord', port: 'octaveShift' }),
    to({ node: 'exprChord', port: 'triad' }, { node: 'chordSel', port: 'a' }),
    to({ node: 'faceExpr', port: 'expression' }, overlay('expression')),
  ],
  voices: [{ from: { node: 'exprChord', port: 'params' }, role: 'instrument' }],
  overlay: ['faceLandmarks', 'faceExpression', 'chordGuide', 'chordName'],
});

export const faceControls = defineBranch({
  id: 'face-controls',
  description: 'Head pose and face axes as controls: the pose chord.',
  requires: ['face-source'],
  nodes: [
    { id: 'faceCtrl', type: 'face-controls', params: {} },
    { id: 'poseChord', type: 'pose-chord', params: {} },
  ],
  edges: [
    to({ node: 'camFace', port: 'face' }, { node: 'faceCtrl', port: 'face' }),
    to(ui('faceControls'), { node: 'faceCtrl', port: 'config' }),
    to({ node: 'faceCtrl', port: 'controls' }, { node: 'poseChord', port: 'controls' }),
    to(ui('chordSpec'), { node: 'poseChord', port: 'spec' }),
    to(ui('faceMapping'), { node: 'poseChord', port: 'faceMapping' }),
    to(ui('chordConfig'), { node: 'poseChord', port: 'chordConfig' }),
    to(ui('octaveShift'), { node: 'poseChord', port: 'octaveShift' }),
    to({ node: 'poseChord', port: 'chord' }, { node: 'chordSel', port: 'b' }),
  ],
  voices: [{ from: { node: 'poseChord', port: 'params' }, role: 'instrument' }],
  overlay: ['faceLandmarks', 'chordGuide', 'chordName'],
});

export const bodySource = defineBranch({
  id: 'body-source',
  description: 'The second camera branch: the body model and its feature vector.',
  nodes: [
    { id: 'camBody', slot: 'body', params: {} },
    { id: 'bodyVec', type: 'body-feature-vector', params: {} },
  ],
  edges: [
    to({ node: 'camBody', port: 'body' }, overlay('bodyFrame')),
    to({ node: 'camBody', port: 'status' }, overlay('bodyStatus')),
    to({ node: 'camBody', port: 'body' }, { node: 'bodyVec', port: 'body' }),
    to({ node: 'bodyVec', port: 'vector' }, overlay('bodyVector')),
  ],
  overlay: ['bodySkeleton'],
  demands: [...BODY_GROUP_IDS],
});

export const bodyRoute = defineBranch({
  id: 'body-route',
  description: 'Body features routed onto the hand voices as modulations.',
  requires: ['body-source', 'field-voices'],
  nodes: [{ id: 'bodyRoute', type: 'body-route', params: {} }],
  edges: [
    to({ node: 'bodyVec', port: 'vector' }, { node: 'bodyRoute', port: 'vector' }),
    to(ui('bodyMap'), { node: 'bodyRoute', port: 'bodyMap' }),
    to({ node: 'bodyRoute', port: 'mods' }, { node: 'map', port: 'mods' }),
  ],
});

export const conductor = defineBranch({
  id: 'conductor',
  description: 'Conducting: the ictus detector and the conducted score it drives.',
  nodes: [
    { id: 'conductor', type: 'conductor', params: {} },
    { id: 'score', type: 'score', params: { notes: DEMO_SCALE_NOTES, loopBeats: 8, baseGain: 0.4, sound: 'triangle' } },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'conductor', port: 'hands' }),
    to(ui('conductor'), { node: 'conductor', port: 'config' }),
    to({ node: 'conductor', port: 'beat' }, { node: 'score', port: 'beat' }),
    to({ node: 'conductor', port: 'velocityScale' }, { node: 'score', port: 'velocityScale' }),
    to({ node: 'conductor', port: 'enabled' }, { node: 'score', port: 'enabled' }),
    to(ui('scoreDoc'), { node: 'score', port: 'doc' }),
    to(ui('scoreDoc'), { node: 'conductor', port: 'doc' }),
    to({ node: 'conductor', port: 'time' }, overlay('conductorTime')),
    to({ node: 'conductor', port: 'enabled' }, overlay('conductorEnabled')),
  ],
  voices: [{ from: { node: 'score', port: 'params' }, role: 'score' }],
  overlay: ['conductorHud'],
});

export const midiOut = defineBranch({
  id: 'midi-out',
  description: 'The merged voices as MIDI, when enabled.',
  nodes: [{ id: 'midiOut', type: 'midi-out', params: {} }],
  edges: [
    to({ node: TRUNK.merge, port: 'params' }, { node: 'midiOut', port: 'params' }),
    to(ui('midiEnabled'), { node: 'midiOut', port: 'enabled' }),
    to(ui('midiPort'), { node: 'midiOut', port: 'port' }),
  ],
});

export const generative = defineBranch({
  id: 'generative',
  description: 'Gestures steer a generative model (indirect map into Lyria); the face input is a nicety.',
  nodes: [
    { id: 'imap', type: 'indirect-map', params: DEFAULT_STEER_CONFIG },
    { id: 'gen', type: 'lyria', params: {} },
  ],
  edges: [
    to({ node: TRUNK.feat, port: 'features' }, { node: 'imap', port: 'features' }),
    to({ node: 'faceFeat', port: 'features' }, { node: 'imap', port: 'face' }, true),
    to(ui('steerConfig'), { node: 'imap', port: 'steerConfig' }),
    to({ node: 'imap', port: 'steer' }, { node: 'gen', port: 'steer' }),
    to(ui('steerEnabled'), { node: 'gen', port: 'enabled' }),
    to(ui('steerPlaying'), { node: 'gen', port: 'playing' }),
    to(ui('steerVolume'), { node: 'gen', port: 'volume' }),
  ],
});

export const airDrum = defineBranch({
  id: 'air-drum',
  description: 'The air drum: strokes to pads, hits to the drum voice; the conductor clock is a nicety.',
  nodes: [
    { id: 'airDrum', type: 'air-drum', params: {} },
    { id: 'drumOut', type: 'drum-out', params: {} },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'airDrum', port: 'hands' }),
    to(ui('airDrum'), { node: 'airDrum', port: 'config' }),
    to({ node: 'conductor', port: 'time' }, { node: 'airDrum', port: 'time' }, true),
    // #269: the trained pattern in play (pattern + model), or null: the pattern mode.
    to(ui('airDrumPattern'), { node: 'airDrum', port: 'pattern' }),
    to(ui('airDrum'), overlay('airDrumConfig')),
    to({ node: 'airDrum', port: 'hits' }, overlay('drumHits')),
    to({ node: 'airDrum', port: 'hits' }, { node: 'drumOut', port: 'hits' }),
    to(ui('muteStrikes'), { node: 'drumOut', port: 'mute' }),
  ],
  overlay: ['drumPads'],
});

export const airBass = defineBranch({
  id: 'air-bass',
  description: 'The air bass: a neck quantised to the scale, plucked notes on the audio clock.',
  nodes: [
    { id: 'airBass', type: 'air-bass', params: {} },
    { id: 'bassOut', type: 'pluck-out', params: { timbre: 'bass', mono: true } },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'airBass', port: 'hands' }),
    to(ui('airBass'), { node: 'airBass', port: 'config' }),
    to(ui('scaleRight'), { node: 'airBass', port: 'scale' }),
    to(ui('octaveShift'), { node: 'airBass', port: 'octaveShift' }),
    to({ node: 'airBass', port: 'notes' }, { node: 'bassOut', port: 'notes' }),
    to(ui('muteStrikes'), { node: 'bassOut', port: 'mute' }),
  ],
});

export const airGuitar = defineBranch({
  id: 'air-guitar',
  description: 'The air guitar: enrolled chord shapes, a predicted strum on six strings.',
  nodes: [
    { id: 'airGuitar', type: 'air-guitar', params: {} },
    { id: 'guitarOut', type: 'pluck-out', params: { timbre: 'guitar', mono: false } },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'airGuitar', port: 'hands' }),
    to(ui('airGuitar'), { node: 'airGuitar', port: 'config' }),
    to(ui('airGuitarModel'), { node: 'airGuitar', port: 'model' }),
    to(ui('octaveShift'), { node: 'airGuitar', port: 'octaveShift' }),
    to({ node: 'airGuitar', port: 'notes' }, { node: 'guitarOut', port: 'notes' }),
    to(ui('muteStrikes'), { node: 'guitarOut', port: 'mute' }),
  ],
});

export const airFlute = defineBranch({
  id: 'air-flute',
  description: 'The air flute: enrolled fingerings choose the note, an enrolled breath gates it (face inputs optional).',
  nodes: [{ id: 'airFlute', type: 'air-flute', params: {} }],
  edges: [
    to({ node: 'airFlute', port: 'status' }, overlay('airFluteStatus')),
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'airFlute', port: 'hands' }),
    to({ node: 'faceVec', port: 'vector' }, { node: 'airFlute', port: 'face' }, true),
    to({ node: 'camFace', port: 'face' }, { node: 'airFlute', port: 'faceFrame' }, true),
    to(ui('airFlute'), { node: 'airFlute', port: 'config' }),
    to(ui('airFluteFingerModel'), { node: 'airFlute', port: 'fingerModel' }),
    to(ui('airFluteMouthModel'), { node: 'airFlute', port: 'mouthModel' }),
    to(ui('octaveShift'), { node: 'airFlute', port: 'octaveShift' }),
  ],
  voices: [{ from: { node: 'airFlute', port: 'params' }, role: 'instrument' }],
  overlay: ['mouthCue'],
});

/** Every branch, in composition order. Voice allocation follows this order. */
export const BRANCHES: readonly GraphBranch[] = [
  trunk,
  fieldVoices,
  faceSource,
  faceTimbre,
  faceChord,
  faceControls,
  bodySource,
  bodyRoute,
  conductor,
  midiOut,
  generative,
  airDrum,
  airBass,
  airGuitar,
  airFlute,
];

export const ALL_BRANCH_IDS: readonly string[] = BRANCHES.map((b) => b.id);
