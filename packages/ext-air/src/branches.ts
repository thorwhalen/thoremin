/**
 * The air instruments' branches (the drum, the bass, the guitar, the flute; the chord instruments' are the
 * harmony slice's since #674): one branch each,
 * attached to the trunk by the hand source and the UI bridge. Moved out of the core branch
 * table in PR 5a of the instruments-as-graphs ADR; the node files they name live under `./nodes/` (5b).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import { overlayElementId, overlayPortName } from '@thoremin/sdk/instruments/extension';
import { DRUM_PADS_ELEMENT } from './nodes/overlay/drum_pads';
import { BREATH_CUE_ELEMENT } from './nodes/overlay/breath_cue';

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

export const AIR_BRANCHES = [airDrum, airBass, airGuitar, airFlute] as const;
