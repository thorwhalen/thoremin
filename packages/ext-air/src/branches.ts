/**
 * The air instruments' branches (the drum, the bass, the guitar, the flute, the chord map): one branch each,
 * attached to the trunk by the hand source and the UI bridge. Moved out of the core branch
 * table in PR 5a of the instruments-as-graphs ADR; the node files they name live under `./nodes/` (5b).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { DRUM_PADS_ELEMENT } from './nodes/overlay/drum_pads';
import { BREATH_CUE_ELEMENT } from './nodes/overlay/breath_cue';

/** The chord map's overlay element (#610 item 4; it was core's `cellGrid`): the air extension's
 *  own, drawn from its grid. */
export const CHORD_MAP_ELEMENT = 'chordMap';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }, optional = false) =>
  optional ? { from, to: toRef, optional: true } : { from, to: toRef };

export const airDrum = defineBranch({
  id: 'air-drum',
  description: 'The air drum: strokes to pads, hits to the drum voice; the conductor clock is a nicety.',
  nodes: [
    { id: 'airDrum', type: 'air-drum', params: {} },
    { id: 'drumOut', type: 'drum-out', params: {} },
  ],
  edges: [
    to({ node: TRUNK.hands, port: 'hands' }, { node: 'airDrum', port: 'hands' }),
    to(ui('airDrum'), { node: 'airDrum', port: 'config' }),
    to({ node: 'conductor', port: 'time' }, { node: 'airDrum', port: 'time' }, true),
    // #269: the trained pattern in play (pattern + model), or null: the pattern mode.
    to(ui('airDrumPattern'), { node: 'airDrum', port: 'pattern' }),
    // The pads on the video (#600 S10: this extension's own overlay element). Its config, the
    // `airDrum` dial, is delivered by the host.
    to({ node: 'airDrum', port: 'hits' }, overlay(overlayPortName('air', DRUM_PADS_ELEMENT, 'hits'))),
    to({ node: TRUNK.cam, port: 'hands' }, overlay(overlayPortName('air', DRUM_PADS_ELEMENT, 'hands'))),
    to({ node: 'airDrum', port: 'hits' }, { node: 'drumOut', port: 'hits' }),
    to(ui('muteStrikes'), { node: 'drumOut', port: 'mute' }),
  ],
  overlay: [overlayElementId('air', DRUM_PADS_ELEMENT)],
});

export const airBass = defineBranch({
  id: 'air-bass',
  description: 'The air bass: a neck quantised to the scale, plucked notes on the audio clock.',
  nodes: [
    { id: 'airBass', type: 'air-bass', params: {} },
    { id: 'bassOut', type: 'pluck-out', params: { timbre: 'bass', mono: true } },
  ],
  edges: [
    to({ node: TRUNK.hands, port: 'hands' }, { node: 'airBass', port: 'hands' }),
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
    to({ node: TRUNK.hands, port: 'hands' }, { node: 'airGuitar', port: 'hands' }),
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
    // The breath cue (#600 S10: this extension's own overlay cue); its config, the `airFlute` dial,
    // is delivered by the host.
    to({ node: 'airFlute', port: 'status' }, overlay(overlayPortName('air', BREATH_CUE_ELEMENT, 'status'))),
    to({ node: TRUNK.hands, port: 'hands' }, { node: 'airFlute', port: 'hands' }),
    to({ node: 'faceVec', port: 'vector' }, { node: 'airFlute', port: 'face' }, true),
    to({ node: 'camFace', port: 'face' }, { node: 'airFlute', port: 'faceFrame' }, true),
    to(ui('airFlute'), { node: 'airFlute', port: 'config' }),
    to(ui('airFluteFingerModel'), { node: 'airFlute', port: 'fingerModel' }),
    to(ui('airFluteMouthModel'), { node: 'airFlute', port: 'mouthModel' }),
    to(ui('octaveShift'), { node: 'airFlute', port: 'octaveShift' }),
  ],
  voices: [{ from: { node: 'airFlute', port: 'params' }, role: 'instrument' }],
  overlay: [overlayElementId('air', BREATH_CUE_ELEMENT)],
});

export const chordMap = defineBranch({
  id: 'chord-map',
  description: "The chord map: a key's chords on the screen, the chord hand pointing at one; held with a melody from the other hand, or strummed by it.",
  nodes: [
    { id: 'chordMap', type: 'chord-map', params: {} },
    { id: 'chordStrumOut', type: 'pluck-out', params: { timbre: 'guitar', mono: false } },
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
    // The song's beat (H9 of #613), read while the map keeps time with the song.
    to({ node: TRUNK.song, port: 'songTime' }, { node: 'chordMap', port: 'time' }),
    to({ node: 'chordMap', port: 'notes' }, { node: 'chordStrumOut', port: 'notes' }),
    to(ui('muteStrikes'), { node: 'chordStrumOut', port: 'mute' }),
    to({ node: 'chordMap', port: 'grid' }, overlay(overlayPortName('air', CHORD_MAP_ELEMENT, 'grid'))),
  ],
  voices: [{ from: { node: 'chordMap', port: 'params' }, role: 'instrument' }],
  // Its chord on the shared chord name, chord guide and keyboard strip (#600 S4's pool, #610).
  // Below the face (30) and pose (20) chords, so composing it moves none of their inputs; an
  // instrument rarely plays both, and the map lights its own chord either way.
  chords: [{ from: { node: 'chordMap', port: 'triad' }, priority: 10 }],
  overlay: [overlayElementId('air', CHORD_MAP_ELEMENT)],
});

/** The chord wheel's overlay element (#600 S5): the air extension's own, drawn from its grid. */
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
    to({ node: TRUNK.song, port: 'songTime' }, { node: 'chordWheel', port: 'time' }),
    to({ node: 'chordWheel', port: 'grid' }, overlay(overlayPortName('air', CHORD_WHEEL_ELEMENT, 'grid'))),
  ],
  voices: [{ from: { node: 'chordWheel', port: 'params' }, role: 'instrument' }],
  // On the shared chord display, after the face, pose and chord-map chords.
  chords: [{ from: { node: 'chordWheel', port: 'triad' }, priority: 8 }],
  overlay: [overlayElementId('air', CHORD_WHEEL_ELEMENT)],
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

export const AIR_BRANCHES = [airDrum, airBass, airGuitar, airFlute, chordMap, chordMapFace, chordWheel, chordWheelFace] as const;
