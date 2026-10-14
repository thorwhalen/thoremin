/**
 * The branch table: today's instrument graph, cut along the lines every instrument shares
 * and the lines each capability draws (`docs/design/instruments-as-graphs-and-extensions.md`
 * §3.4). Composing the full table (these core branches plus the extensions', `ALL_BRANCHES` in
 * `src/app/graph.ts`) reproduces the graph `defaultGraph()` has
 * always built (pinned by `test/instruments/golden_graph.test.ts`); an instrument that
 * composes fewer branches simply has fewer nodes.
 *
 * Where a node lives is decided by who needs it, not by what it does:
 *
 *  - The TRUNK holds what every instrument shares: the hand source and its features, the UI
 *    bridge, the merge, the synth, the overlay, the two shell-level readers of the hands
 *    (the gesture classifier that drives command dispatch, and the hand feature vector that
 *    the Lab and the Trainer read), and the song player (#186 PR G: the Song tool's song
 *    plays under any instrument). They cost an early return per tick when idle and are
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
import { DEFAULT_STEER_CONFIG } from '@/nodes/mapping/indirect_map';
import { DEMO_LOOP_BEATS, DEMO_SCALE_NOTES } from '@/nodes/music/score';
import { BODY_GROUP_IDS, FACE_GROUP_IDS } from '@/features/labConfig';
import { defineBranch, type GraphBranch } from '@thoremin/sdk/instruments/branch';

import { TRUNK } from '@thoremin/sdk/instruments/trunk';
export { TRUNK, TRUNK_ID } from '@thoremin/sdk/instruments/trunk';

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
    // The song the player loaded in the Song tool (#186 PR G): idle (an early return)
    // until there is one.
    { id: 'songPlayer', type: 'song-player', params: {} },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: TRUNK.feat, port: 'hands' }),
    to({ node: TRUNK.cam, port: 'hands' }, overlay('hands')),
    to({ node: TRUNK.feat, port: 'features' }, overlay('features')),
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'handVec', port: 'hands' }),
    to({ node: 'handVec', port: 'vector' }, overlay('handVector')),
    to({ node: TRUNK.feat, port: 'features' }, { node: 'gesture', port: 'features' }),
    // The handedness dwell (#148): a dial, live on the sound path's hand reader.
    to(ui('handednessDwell'), { node: TRUNK.feat, port: 'handednessDwell' }),
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
    // The song (#186 PR G): the loaded song by identity, its transport, level and rate, and
    // a tool's claim, which silences it like every other voice.
    to(ui('songHandle'), { node: 'songPlayer', port: 'song' }),
    to(ui('songPlaying'), { node: 'songPlayer', port: 'playing' }),
    to(ui('songPlays'), { node: 'songPlayer', port: 'play' }),
    to(ui('songRate'), { node: 'songPlayer', port: 'rate' }),
    to(ui('songVolume'), { node: 'songPlayer', port: 'volume' }),
    to(ui('claimed'), { node: 'songPlayer', port: 'claimed' }),
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
    // The player's mute is NOT fed to the mapping node: the merge is the one place the
    // master mute applies (#91), and silencing here too would stop the hands' voices
    // before MIDI out could keep them flowing through a mute (#168 Q3). The mapping
    // contract keeps its `mute` port (default false) for hosts that want it.
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

/**
 * The face chord in three pieces (#330 P4), so the classifier can be swapped while the chord
 * stays: `face-expression` is the general expression model, `face-chord-voice` the chord it
 * plays, and `face-chord` joins the two. A personal categorizer (the faces extension's
 * `face-categorizer`) replaces `face-chord` and joins its own reading to the same voice;
 * the general model stays composed under it, as its fallback.
 */
export const faceExpression = defineBranch({
  id: 'face-expression',
  description: 'The general expression model: the face to seven expression scores.',
  requires: ['face-source'],
  nodes: [{ id: 'faceExpr', slot: 'expression', params: {} }],
  edges: [
    to({ node: 'camFace', port: 'face' }, { node: 'faceExpr', port: 'face' }),
    to(ui('expressionSensitivity'), { node: 'faceExpr', port: 'sensitivity' }),
  ],
});

export const faceChordVoice = defineBranch({
  id: 'face-chord-voice',
  description: 'The expression chord: an expression to a voiced diatonic chord, whichever classifier reads it.',
  requires: ['face-source'],
  nodes: [{ id: 'exprChord', type: 'expression-chord', params: {} }],
  edges: [
    to(ui('chordSpec'), { node: 'exprChord', port: 'spec' }),
    to(ui('expressionDegrees'), { node: 'exprChord', port: 'degrees' }),
    to(ui('faceMapping'), { node: 'exprChord', port: 'faceMapping' }),
    to(ui('chordConfig'), { node: 'exprChord', port: 'chordConfig' }),
    to(ui('octaveShift'), { node: 'exprChord', port: 'octaveShift' }),
    to({ node: 'exprChord', port: 'triad' }, { node: 'chordSel', port: 'a' }),
  ],
  voices: [{ from: { node: 'exprChord', port: 'params' }, role: 'instrument' }],
  overlay: ['chordGuide', 'chordName'],
});

export const faceChord = defineBranch({
  id: 'face-chord',
  description: 'Expression to a diatonic chord: the expression classifier and the expression chord.',
  requires: ['face-expression', 'face-chord-voice'],
  edges: [
    to({ node: 'faceExpr', port: 'expression' }, { node: 'exprChord', port: 'expression' }),
    to({ node: 'faceExpr', port: 'expression' }, overlay('expression')),
  ],
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

/**
 * The song follows a leader: the dancer (#186 PR H, research map §9.6) or the conductor
 * (#187 PR 7, "Conduct a recording", the conducting map §6.7). One pace controller reads
 * the leader and the song's beat and sets the rate the song plays at. It closes a loop
 * through the song player, so the two edges back from the player are DELAYED (the
 * previous tick's song time and rate, extrapolated to now).
 *
 * The leaders arrive on OPTIONAL edges, each present when its branch is composed: the
 * dancer's pulse from the body source, the conductor's `recordingTime` from the conductor
 * (a time only while he leads the recording, so a conductor leading the score never
 * steers the song). With a conductor's time the node runs the beat servo and also drives
 * the player's transport (`followPlaying`) and cue; with the dancer's pulse alone it runs
 * the dancer's law and leaves the transport to the player. Composed while following is on
 * or the conductor leads the recording, and a song is loaded; the derivation composes the
 * leader's branch with it (the body source for the dancer, the conductor for himself).
 */
export const songPace = defineBranch({
  id: 'song-pace',
  description: "The song's tempo follows a leader: the dancer's pulse or the conductor's beat.",
  nodes: [{ id: 'pace', type: 'pace-controller', params: {} }],
  edges: [
    to({ node: 'bodyPulse', port: 'pulse' }, { node: 'pace', port: 'pulse' }, true),
    to({ node: 'conductor', port: 'recordingTime' }, { node: 'pace', port: 'lead' }, true),
    { from: { node: 'songPlayer', port: 'songTime' }, to: { node: 'pace', port: 'song' }, delayed: true },
    { from: { node: 'songPlayer', port: 'rate' }, to: { node: 'pace', port: 'rate' }, delayed: true },
    // Neither law leads a song still loading (#500).
    { from: { node: 'songPlayer', port: 'status' }, to: { node: 'pace', port: 'songStatus' }, delayed: true },
    to(ui('songRate'), { node: 'pace', port: 'base' }),
    to(ui('songFollowRange'), { node: 'pace', port: 'range' }),
    // A new song restarts the laws (#439): the handle's identity, not its time.
    to(ui('songHandle'), { node: 'pace', port: 'songHandle' }),
    to({ node: 'pace', port: 'rate' }, { node: 'songPlayer', port: 'followRate' }),
    to({ node: 'pace', port: 'playing' }, { node: 'songPlayer', port: 'followPlaying' }),
    to({ node: 'pace', port: 'cue' }, { node: 'songPlayer', port: 'cue' }),
  ],
});

/** The sampled orchestra's node id in the conductor branch: the one place it is written
 *  (the engine loop's status reporter reads the node by it, `src/app/orchestraStatus.ts`). */
export const ORCHESTRA_NODE_ID = 'orchestra';

export const conductor = defineBranch({
  id: 'conductor',
  description: 'Conducting: the ictus detector, the conducted score it drives, and the sampled orchestra that can play it.',
  nodes: [
    { id: 'conductor', type: 'conductor', params: {} },
    { id: 'score', type: 'score', params: { notes: DEMO_SCALE_NOTES, loopBeats: DEMO_LOOP_BEATS, baseGain: 0.4, sound: 'triangle' } },
    // The sampled orchestra (#187 PR 5): off until `conductor.orchestra.enabled`, and
    // loads nothing until then; takes the piece over from `score` once it is ready.
    { id: ORCHESTRA_NODE_ID, type: 'orchestra', params: {} },
  ],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: 'conductor', port: 'hands' }),
    // The body conductor (#375): the pose stream, present when the derivation composes the
    // body source (it does while `conductor.source` is `body`; a structural test pins that).
    to({ node: 'camBody', port: 'body' }, { node: 'conductor', port: 'body' }, true),
    // The dancer leading the score (#380): the dancer's pulse, present with the body source
    // (composed while `conductor.source` is `dancer`).
    to({ node: 'bodyPulse', port: 'pulse' }, { node: 'conductor', port: 'pulse' }, true),
    to(ui('conductor'), { node: 'conductor', port: 'config' }),
    to({ node: 'conductor', port: 'beat' }, { node: 'score', port: 'beat' }),
    to({ node: 'conductor', port: 'velocityScale' }, { node: 'score', port: 'velocityScale' }),
    to({ node: 'conductor', port: 'leadsScore' }, { node: 'score', port: 'enabled' }),
    to(ui('scoreDoc'), { node: 'score', port: 'doc' }),
    to(ui('scoreDoc'), { node: 'conductor', port: 'doc' }),
    to({ node: 'conductor', port: 'time' }, overlay('conductorTime')),
    to({ node: 'conductor', port: 'enabled' }, overlay('conductorEnabled')),
    to({ node: 'conductor', port: 'time' }, { node: ORCHESTRA_NODE_ID, port: 'time' }),
    to({ node: 'conductor', port: 'velocityScale' }, { node: ORCHESTRA_NODE_ID, port: 'velocityScale' }),
    to({ node: 'conductor', port: 'articulation' }, { node: ORCHESTRA_NODE_ID, port: 'articulation' }),
    to({ node: 'conductor', port: 'leadsScore' }, { node: ORCHESTRA_NODE_ID, port: 'conducting' }),
    to(ui('scoreDoc'), { node: ORCHESTRA_NODE_ID, port: 'doc' }),
    to(ui('conductor'), { node: ORCHESTRA_NODE_ID, port: 'config' }),
    to(ui('claimed'), { node: ORCHESTRA_NODE_ID, port: 'claimed' }),
    to({ node: ORCHESTRA_NODE_ID, port: 'playing' }, { node: 'score', port: 'replaced' }),
  ],
  voices: [{ from: { node: 'score', port: 'params' }, role: 'score' }],
  overlay: ['conductorHud'],
  // One hand at a time: the beating hand (`pickHand`), or the shaping hand while the body
  // beats. Which one depends on the hands in view, so `HAND_COUNT_POLICY` decides (#325).
  hands: 1,
});

export const midiOut = defineBranch({
  id: 'midi-out',
  description: 'The merged voices as MIDI, when enabled.',
  nodes: [{ id: 'midiOut', type: 'midi-out', params: {} }],
  edges: [
    // The merge BEFORE the master mute, plus the player's mute and the dial that says
    // whether it applies to MIDI (#168 Q3): `midi.muteFollowsMaster`, on by default. A
    // tool's claim (the Trainer) is its own port and always silences.
    to({ node: TRUNK.merge, port: 'unmuted' }, { node: 'midiOut', port: 'params' }),
    to(ui('mute'), { node: 'midiOut', port: 'mute' }),
    to(ui('claimed'), { node: 'midiOut', port: 'claimed' }),
    to(ui('midiMuteFollowsMaster'), { node: 'midiOut', port: 'muteFollowsMaster' }),
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

/**
 * The CORE branches, in composition order. Extensions append theirs (`src/extensions`); the
 * full table an app composes from is `ALL_BRANCHES` in `src/app/graph.ts`.
 * Voice allocation follows this order.
 */
export const BRANCHES: readonly GraphBranch[] = [
  trunk,
  fieldVoices,
  faceSource,
  faceTimbre,
  faceExpression,
  faceChordVoice,
  faceChord,
  faceControls,
  bodySource,
  bodyRoute,
  songPace,
  conductor,
  midiOut,
  generative,
];

/** The core branch ids; an app's full list is the core plus every extension's. */
export const ALL_BRANCH_IDS: readonly string[] = BRANCHES.map((b) => b.id);
