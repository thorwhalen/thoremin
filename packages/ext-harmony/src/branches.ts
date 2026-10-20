/**
 * The harmony slice's branches (#674; the air extension's until then): the chord map and its face
 * colouring, the chord wheel and its two face branches, and the chord chart. Their ids, nodes and
 * edges are what they were; the chord map's strum sink is now this slice's own node type, and the
 * overlay elements its own ids (`{extension}/chordMap`).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { SONG_PLAYER, TRUNK } from '@thoremin/sdk/instruments/trunk';
import { overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { HARMONY_EXTENSION_ID } from './id';

/** The chord map's overlay element (#610 item 4; it was core's `cellGrid`): this slice's own,
 *  drawn from its grid. */
export const CHORD_MAP_ELEMENT = 'chordMap';
/** The node type of the chord map's strum sink: the SDK's plucked-string sink (`makePluckOutNode`). */
export const CHORD_STRUM_OUT = 'chord-strum-out';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }, optional = false) =>
  optional ? { from, to: toRef, optional: true } : { from, to: toRef };

export const chordMap = defineBranch({
  id: 'chord-map',
  description: "The chord map: a key's chords on the screen, the chord hand pointing at one; held with a melody from the other hand, or strummed by it.",
  nodes: [
    { id: 'chordMap', type: 'chord-map', params: {} },
    // Its strums' sink: the SDK's plucked-string sink, under this slice's own type (#674).
    { id: 'chordStrumOut', type: CHORD_STRUM_OUT, params: { timbre: 'guitar', mono: false } },
  ],
  edges: [
    // Through the handedness dwell (#314): at the default dwell of 0 it is the camera's own frame.
    to({ node: TRUNK.hands, port: 'hands' }, { node: 'chordMap', port: 'hands' }),
    to(ui('chordMap'), { node: 'chordMap', port: 'config' }),
    // The chord-source scale is the key; the Chord sound section is how a held chord sounds.
    to(ui('chordSpec'), { node: 'chordMap', port: 'spec' }),
    to(ui('chordConfig'), { node: 'chordMap', port: 'chordConfig' }),
    to(ui('octaveShift'), { node: 'chordMap', port: 'octaveShift' }),
    to(ui('chordMapMidi'), { node: 'chordMap', port: 'midi' }),
    to(ui('chordMapAudio'), { node: 'chordMap', port: 'audio' }),
    // The song's beat (H9 of #613), read while the map keeps time with the song (an optional edge:
    // the song slice's player, present when the build lists it, #600 S15).
    to({ node: SONG_PLAYER, port: 'songTime' }, { node: 'chordMap', port: 'time' }, true),
    // The conductor's beat, while conducting (an optional edge: composed only with the conductor).
    to({ node: 'conductor', port: 'time' }, { node: 'chordMap', port: 'conductorTime' }, true),
    to({ node: 'chordMap', port: 'notes' }, { node: 'chordStrumOut', port: 'notes' }),
    to(ui('muteStrikes'), { node: 'chordStrumOut', port: 'mute' }),
    to({ node: 'chordMap', port: 'grid' }, overlay(overlayPortName(HARMONY_EXTENSION_ID, CHORD_MAP_ELEMENT, 'grid'))),
  ],
  voices: [{ from: { node: 'chordMap', port: 'params' }, role: 'instrument' }],
  // Its chord on the shared chord name, chord guide and keyboard strip (#600 S4's pool, #610).
  // Below the face (30) and pose (20) chords, so composing it moves none of their inputs; an
  // instrument rarely plays both, and the map lights its own chord either way.
  chords: [{ from: { node: 'chordMap', port: 'triad' }, priority: 10 }],
  overlay: [overlayElementId(HARMONY_EXTENSION_ID, CHORD_MAP_ELEMENT)],
});

/** The chord wheel's overlay element (#600 S5): this slice's own, drawn from its grid. */
export const CHORD_WHEEL_ELEMENT = 'chordWheel';

export const chordWheel = defineBranch({
  id: 'chord-wheel',
  description: 'The chord wheel: the chord in force in the centre, a move per wedge; push the hand toward a move and the wheel recentres.',
  nodes: [{ id: 'chordWheel', type: 'chord-wheel', params: {} }],
  edges: [
    to({ node: TRUNK.hands, port: 'hands' }, { node: 'chordWheel', port: 'hands' }),
    to(ui('chordWheel'), { node: 'chordWheel', port: 'config' }),
    to(ui('chordSpec'), { node: 'chordWheel', port: 'spec' }),
    to(ui('chordConfig'), { node: 'chordWheel', port: 'chordConfig' }),
    to(ui('octaveShift'), { node: 'chordWheel', port: 'octaveShift' }),
    to({ node: SONG_PLAYER, port: 'songTime' }, { node: 'chordWheel', port: 'time' }, true),
    to({ node: 'conductor', port: 'time' }, { node: 'chordWheel', port: 'conductorTime' }, true),
    to({ node: 'chordWheel', port: 'grid' }, overlay(overlayPortName(HARMONY_EXTENSION_ID, CHORD_WHEEL_ELEMENT, 'grid'))),
  ],
  voices: [{ from: { node: 'chordWheel', port: 'params' }, role: 'instrument' }],
  // On the shared chord display, after the face, pose and chord-map chords.
  chords: [{ from: { node: 'chordWheel', port: 'triad' }, priority: 8 }],
  overlay: [overlayElementId(HARMONY_EXTENSION_ID, CHORD_WHEEL_ELEMENT)],
});

/**
 * The face steers the chord wheel (the face as harmonic expression: each expression a move): the
 * general expression model's reading into the wheel. Its own branch, composed only while the face
 * steers, so a hand-steered wheel never loads the face model.
 */
export const chordWheelFace = defineBranch({
  id: 'chord-wheel-face',
  description: 'The face steers the chord wheel: each expression held a moment makes its move.',
  requires: ['chord-wheel', 'face-expression'],
  nodes: [],
  edges: [to({ node: 'faceExpr', port: 'expression' }, { node: 'chordWheel', port: 'expression' })],
});

/**
 * ASL's signs steer the chord wheel: the sign reader's reading into the wheel, a letter A..G held
 * going to its chord. Composed only while signs steer; requires the ASL plugin's reader (a build
 * without the plugin leaves this branch out, #697), whose own dial must be on for it to read.
 */
export const chordWheelSigns = defineBranch({
  id: 'chord-wheel-signs',
  description: 'Signs steer the chord wheel: a fingerspelled letter A..G held a moment goes to its chord.',
  requires: ['chord-wheel', 'asl-signs'],
  nodes: [],
  // The ASL plugin's reader node (`aslSigns`) and its category port.
  edges: [to({ node: 'aslSigns', port: 'signs' }, { node: 'chordWheel', port: 'signs' })],
});

/**
 * The player's pose categorizer steers the chord wheel: each category held a moment makes a move.
 * Composed only while the categorizer steers; requires the faces extension's pose categorizer
 * branch, which reads the categorizer the Pose categorizer section names.
 */
export const chordWheelCategorizer = defineBranch({
  id: 'chord-wheel-categorizer',
  description: 'Your pose categorizer steers the chord wheel: each of your poses held a moment makes a move.',
  requires: ['chord-wheel', 'pose-categorizer'],
  nodes: [],
  // The faces extension's pose categorizer node (`poseCat`) and its category port.
  edges: [to({ node: 'poseCat', port: 'category' }, { node: 'chordWheel', port: 'poses' })],
});

/**
 * The face colours the chord map (H7 of #613): the face's smoothed controls into the map, whose
 * valence turns the key to its parallel major or minor and whose arousal adds tensions. Its own
 * branch, composed only while the face colours, so a hands-only map never loads the face model.
 */
export const chordMapFace = defineBranch({
  id: 'chord-map-face',
  description: "The face colours the chord map: a held smile or frown turns the key major or minor, an open mouth and raised brows add the seventh and the ninth.",
  requires: ['chord-map', 'face-source'],
  nodes: [],
  edges: [to({ node: 'faceFeat', port: 'features' }, { node: 'chordMap', port: 'face' })],
  overlay: ['faceLandmarks'],
});

/** The face sets the next-chord wheel's surprise (#672): its smoothed controls into the wheel,
 *  composed only while the face is the surprise's source. */
export const chordWheelAffect = defineBranch({
  id: 'chord-wheel-affect',
  description: "The face sets the next-chord wheel's surprise: an open mouth and raised brows put the rarer progressions on top.",
  requires: ['chord-wheel', 'face-source'],
  nodes: [],
  edges: [to({ node: 'faceFeat', port: 'features' }, { node: 'chordWheel', port: 'face' })],
});

/**
 * Conduct a chord chart (H9 of #613, the design's 6.6): the conducted piece's chords, walked by
 * the conductor's beat. It requires the conductor, whose branch it composes; the conductor then
 * reads the piece and the beat, as it does for the orchestra.
 */
export const chordChart = defineBranch({
  id: 'chord-chart',
  description: "Conduct a chord chart: the conducted piece's chords, beat by beat, played voice-led on the conductor's beat.",
  requires: ['conductor'],
  nodes: [{ id: 'chordChart', type: 'chord-chart', params: {} }],
  edges: [
    to({ node: 'conductor', port: 'time' }, { node: 'chordChart', port: 'time' }),
    to({ node: 'conductor', port: 'leadsScore' }, { node: 'chordChart', port: 'leads' }),
    to(ui('conductor'), { node: 'chordChart', port: 'conductor' }),
    to({ node: 'conductor', port: 'velocityScale' }, { node: 'chordChart', port: 'velocityScale' }),
    to(ui('scoreDoc'), { node: 'chordChart', port: 'doc' }),
    to(ui('chordChart'), { node: 'chordChart', port: 'config' }),
    to(ui('chordConfig'), { node: 'chordChart', port: 'chordConfig' }),
    to(ui('octaveShift'), { node: 'chordChart', port: 'octaveShift' }),
  ],
  voices: [{ from: { node: 'chordChart', port: 'params' }, role: 'instrument' }],
  // On the shared chord display, after the face, pose, chord-map and wheel chords.
  chords: [{ from: { node: 'chordChart', port: 'triad' }, priority: 7 }],
});

export const HARMONY_BRANCHES = [chordMap, chordMapFace, chordWheel, chordWheelFace, chordWheelSigns, chordWheelCategorizer, chordWheelAffect, chordChart] as const;
