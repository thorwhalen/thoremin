/**
 * The ASL branches: the sign reader (hands to a reading, drawn as a big label and a bar per
 * sign) and, on top of it, the sign chords (A..G to chords of the key, into the synth).
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const overlay = (port: string) => ({ node: TRUNK.overlay, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }) => ({ from, to: toRef });

export const ASL_SIGNS_NODE_ID = 'aslSigns';
export const SIGN_CHORD_NODE_ID = 'signChord';

export const aslSigns = defineBranch({
  id: 'asl-signs',
  description: 'The ASL sign reader: the hands to a score per sign, drawn as the named sign and a bar per sign.',
  nodes: [{ id: ASL_SIGNS_NODE_ID, type: 'asl-signs', params: {} }],
  edges: [
    to({ node: TRUNK.cam, port: 'hands' }, { node: ASL_SIGNS_NODE_ID, port: 'hands' }),
    to(ui('asl'), { node: ASL_SIGNS_NODE_ID, port: 'config' }),
    to({ node: ASL_SIGNS_NODE_ID, port: 'signs' }, overlay('categories')),
  ],
  overlay: ['categoryLabel', 'categoryBars'],
});

export const aslChord = defineBranch({
  id: 'asl-chord',
  description: 'ASL chords: the letters A..G play the chord of the key whose root has that letter, voiced like the face chords.',
  requires: ['asl-signs'],
  nodes: [
    { id: SIGN_CHORD_NODE_ID, type: 'sign-chord', params: {} },
    // The chord selector the face branches share (same id, type and params: one node).
    { id: 'chordSel', type: 'chord-select', params: {} },
  ],
  edges: [
    to({ node: ASL_SIGNS_NODE_ID, port: 'reading' }, { node: SIGN_CHORD_NODE_ID, port: 'reading' }),
    to(ui('chordSpec'), { node: SIGN_CHORD_NODE_ID, port: 'spec' }),
    to(ui('chordConfig'), { node: SIGN_CHORD_NODE_ID, port: 'chordConfig' }),
    to(ui('octaveShift'), { node: SIGN_CHORD_NODE_ID, port: 'octaveShift' }),
    to(ui('asl'), { node: SIGN_CHORD_NODE_ID, port: 'config' }),
    to({ node: SIGN_CHORD_NODE_ID, port: 'triad' }, { node: 'chordSel', port: 'c' }),
    to({ node: 'chordSel', port: 'chord' }, overlay('chord')),
    to({ node: SIGN_CHORD_NODE_ID, port: 'captions' }, overlay('categoryCaptions')),
  ],
  voices: [{ from: { node: SIGN_CHORD_NODE_ID, port: 'params' }, role: 'instrument' }],
  overlay: ['chordName'],
});

export const ASL_BRANCHES = [aslSigns, aslChord] as const;
