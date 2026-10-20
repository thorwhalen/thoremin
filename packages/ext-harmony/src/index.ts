/**
 * The harmony slice (#674; H5 of #613): the chord instruments as one extension, moved out of the air
 * extension, which keeps the drum, the bass, the guitar and the flute. The chord map (a key's chords
 * on the screen, the chord hand pointing at one), the chord wheel (the chord in force in the centre, a
 * move per wedge) and the chord chart (a conducted piece's chords on the conductor's beat), with their
 * dials, branches, overlay elements, transients (a MIDI keyboard's held notes, the microphone's
 * chroma), shipped instruments and catalog rows (`docs/design/harmonic-layers.md`).
 *
 * Moved, not changed: the dial keys, kinds and versions, the branch ids and every node's params are
 * what they were, so a stored state and a saved instrument read back byte-identical and every seed
 * loads. What differs is whose they are: the overlay elements are this slice's (`{id}/chordMap`),
 * the chord map's strum sink is its own node type (the SDK's plucked-string sink), and the libraries
 * it shared with the air guitar (the strum, the guitar voicing, the note events, the player's hands)
 * are the SDK's. Its catalog rows stay under the air extension's class, "Air instruments", for now,
 * so a build that lists this slice lists `air` too: the fold refuses a row of an unknown class at
 * load (`test/harmony/harmony_without_conductor.test.ts` pins it; a class of its own is #705).
 *
 * The package `@thoremin/ext-harmony` (`packages/ext-harmony`, named by `extensions.json`): `nodes/`,
 * `lib/` (the map's layouts and tracker, the chart's reduction, MIDI and microphone readings),
 * `app/` (status stores, the MIDI and microphone listeners, the typed controls), `panels/`. It
 * imports only the SDK packages and libraries.
 *
 * Pure: no React (the editor sections and status hooks are `./ui.tsx`, the React half).
 */
import type { NodeDef } from '@thoremin/dag';
import { defineExtension, transientPort } from '@thoremin/sdk/instruments/extension';
import { drawCellGrid, cellGridOf } from '@thoremin/sdk/nodes/cell_grid_draw';
import { makePluckOutNode } from '@thoremin/sdk/nodes/pluck_out';
import { chordMapNode } from './nodes/chord_map';
import { chordWheelNode } from './nodes/chord_wheel';
import { chordChartNode } from './nodes/chord_chart';
import type { MidiHeld } from './lib/midi_held';
import type { AudioHeard } from './lib/audio_heard';
import { CHORD_MAP_ELEMENT, CHORD_STRUM_OUT, CHORD_WHEEL_ELEMENT, HARMONY_BRANCHES } from './branches';
import { HARMONY_DIAL_SLICES } from './dials';
import { HARMONY_EXTENSION_ID } from './id';

/** What every chord instrument changes besides its own dial (the air instruments' rule): the
 *  theremin voices silent, no note grid, no note names on the hands. */
const SILENT_THEREMIN = {
  handMap: { maxGain: 0 },
  overlay: { scaleGuide: { show: false }, markers: { showNotes: false } },
} as const;

const on = (x: unknown): boolean => !!x && typeof x === 'object' && (x as { enabled?: boolean }).enabled === true;

/** Whether one of this extension's dials is on, read from the whole settings object. */
const dialOn = (key: string) => (s: Readonly<Record<string, unknown>>): boolean => on(s[key]);

/** The chord map's strum sink: the SDK's plucked-string sink under this slice's own type. */
const chordStrumOutNode = makePluckOutNode(CHORD_STRUM_OUT, {
  title: 'Chord strum out',
  description: "Sounds the chord map's strums (the chord's guitar voicing) on the audio clock at the time each was predicted for (WebAudio plucks from primitives, no samples).",
});

export const HARMONY_EXTENSION = defineExtension({
  id: HARMONY_EXTENSION_ID,
  // Its rows of the Instruments view's catalog, under the air extension's class (as before #674).
  catalog: [
    // The chord map plays the chords of the chord-source scale, the key the Sound section sets.
    { id: 'chords', label: 'Chord map', emoji: '🎼', class: 'air', usesScale: true, on: dialOn('chordMap') },
    // The chord wheel steps through a space of chords from the chord-source key.
    { id: 'wheel', label: 'Chord wheel', emoji: '🎡', class: 'air', usesScale: true, on: dialOn('chordWheel') },
    // The chord chart plays the conducted piece's own chords, not the scale.
    // It walks the conducted piece: listed only in a build that ships the conductor (#697).
    { id: 'chart', label: 'Chord chart', emoji: '📜', class: 'air', usesScale: false, on: dialOn('chordChart'), requires: ['conductor'] },
  ],
  // Its overlay elements: the chord wheel's grid (#600 S5) and the chord map's (#610 item 4; core's
  // `cellGrid` before), just above the drum pads and beneath the markers, where core drew it. Each
  // element's options are this slice's dials, delivered by the host.
  overlay: [
    { name: CHORD_WHEEL_ELEMENT, category: 'guide', inputs: [{ name: 'grid', kind: 'cell-grid' }], config: { dialKey: 'chordWheel' } },
    { name: CHORD_MAP_ELEMENT, category: 'guide', drawBefore: 'markers', inputs: [{ name: 'grid', kind: 'cell-grid' }], config: { dialKey: 'chordMap' } },
  ],
  overlayElements: [
    {
      name: CHORD_MAP_ELEMENT,
      draw(g, frame, inputs) {
        const config = inputs.config as { enabled?: boolean; gridOnVideo?: { show?: boolean } } | undefined;
        if (config?.enabled !== true || config.gridOnVideo?.show === false) return;
        const grid = cellGridOf(inputs.grid);
        if (grid) drawCellGrid(g, frame.W, frame.H, grid);
      },
    },
    {
      name: CHORD_WHEEL_ELEMENT,
      draw(g, frame, inputs) {
        if ((inputs.config as { enabled?: boolean } | undefined)?.enabled !== true) return;
        const grid = cellGridOf(inputs.grid);
        if (grid) drawCellGrid(g, frame.W, frame.H, grid);
      },
    },
  ],
  nodes: [chordMapNode, chordWheelNode, chordChartNode, chordStrumOutNode] as unknown as NodeDef<unknown>[],
  branches: HARMONY_BRANCHES,
  dials: HARMONY_DIAL_SLICES,
  transient: [
    // H8 of #613: the notes a MIDI keyboard holds, while the chord map follows one.
    transientPort<MidiHeld>()('chordMapMidi', 'held-notes'),
    // H8 of #613: the microphone's chroma, while the chord map follows the microphone.
    transientPort<AudioHeard>()('chordMapAudio', 'audio-chroma'),
  ],
  // The chord instruments, seeded after the air instruments, in the order they always were.
  instruments: [
    // Point at a key's chords (Pur Pasteur's harmonic map): the left hand over a chord holds
    // it, the right hand's height plays a melody on its tones. C major, as in the video; the
    // key is the chord-source scale (the Sound section's root and scale).
    // Each change voice-led, common tones held, as the video voices it (H3 of #613); the melody
    // hand's tilt chooses its notes (chord tones, pentatonic, scale), as the video's right hand.
    { name: 'Chord Map', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, melodyNotes: 'tilt' } } },
    // The same map coloured by the face (H7 of #613): a held smile turns A minor to A major, a
    // frown back; an open mouth with raised brows adds the seventh, then the ninth.
    { name: 'Chord Map + Face', patch: { ...SILENT_THEREMIN, right: { root: 9, type: 'minor' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, melodyNotes: 'tilt', face: true } } },
    // A pentatonic's own five chords (#671): stacks of its own thirds, the sus chords and the
    // sixths of folk and pop harmony, laid out on five hexes (every step visits all five).
    { name: 'Pentatonic Map', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'pentatonic' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, chordsFrom: 'scale' } } },
    // MIDI chooses, the camera performs (H8 of #613): the chords a MIDI keyboard holds light up
    // on the map, and the other hand plays the melody over them (or strums them).
    { name: 'Play Along (MIDI)', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, follow: 'midi', melodyNotes: 'tilt' } } },
    // The microphone chooses (H8 of #613): a guitar's, a piano's or a band's chords light up on the
    // map, heard a quarter second before they count, and the other hand plays the melody over them.
    { name: 'Play Along (microphone)', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, follow: 'audio', melodyNotes: 'tilt' } } },
    // The same map, strummed: the right hand strums the chord under the left, predicted
    // before the frame that shows the strum (the air guitar's timing).
    // A next-chord wheel (H5 of #613): the key's six diatonic moves around the chord in force,
    // voice-led; push the left hand toward a move and hold it.
    { name: 'Chord Wheel', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordWheel: { enabled: true } } },
    // The wheel steered by the face (the face as harmonic expression, #613 H6): each expression
    // held a moment is a move (a smile to the dominant, a sad face to the relative minor).
    { name: 'Face Wheel', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordWheel: { enabled: true, steer: 'face' } } },
    // The same wheel with the Tonnetz's moves (P, L, R, N, S, H): it leaves the key.
    { name: 'Tonnetz Wheel', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordWheel: { enabled: true, moves: 'tonnetz' } } },
    // Walk a cycle on the beat (H11 of #613): hold a push out and the wheel keeps making that
    // move, one per beat, arpeggiated so the beat is heard: up walks the cycle of fourths.
    { name: 'Wheel Walk', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed', rendering: 'arpUp', bpm: 90 }, chordWheel: { enabled: true, walk: true } } },
    // The design's next-chord wheel (§6.2, H10 of #613): the likeliest next chord on top (Piston's
    // usual root progressions), each chord's distance from home in Lerdahl's tonal pitch space;
    // raise the right hand for rarer progressions on top (#672).
    { name: 'Next-Chord Wheel', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordWheel: { enabled: true, order: 'likely', tension: 'tps', surpriseFrom: 'hand' } } },
    // Conduct a chord chart (H9 of #613, the design's 6.6): Haydn's quartet read for its chords,
    // played voice-led and arpeggiated on the conductor's beat under the first violin's tune,
    // which is all the conductor's own score plays (the quartet is not doubled).
    { name: 'Conduct the Chords', patch: { ...SILENT_THEREMIN, faceChord: { voicing: 'voiceLed', rendering: 'arpUpDown' }, conductor: { enabled: true, piece: 'haydn-op76-3', parts: 'violin' }, chordChart: { enabled: true } }, requires: ['conductor'] },
    // Signs steer (the sign-harmony lane): fingerspell a letter A..G and the wheel goes to that
    // letter's chord, its wedges showing the moves from there. Requires the ASL plugin (its
    // reader on, its own chords off: the wheel plays them).
    { name: 'Sign Wheel', patch: { ...SILENT_THEREMIN, right: { root: 2, type: 'major' }, faceChord: { voicing: 'voiceLed' }, asl: { enabled: true, chords: false }, chordWheel: { enabled: true, steer: 'signs' } }, requires: ['asl-signs'] },
    // A signed letter lights its chord on the map, and the other hand plays the melody over it.
    { name: 'Sign Map', patch: { ...SILENT_THEREMIN, right: { root: 2, type: 'major' }, faceChord: { voicing: 'voiceLed' }, asl: { enabled: true, chords: false }, chordMap: { enabled: true, follow: 'signs', melodyNotes: 'tilt' } }, requires: ['asl-signs'] },
    { name: 'Chord Map Strum', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, chordMap: { enabled: true, play: 'strum' } } },
  ],
  derive: (s) => {
    const settings = s as Record<string, unknown>;
    const ids: string[] = [];
    if (on(settings.chordMap)) {
      ids.push('chord-map');
      // The face model is composed only while the face colours the map.
      if ((settings.chordMap as { face?: boolean }).face === true) ids.push('chord-map-face');
      // The sign reader's reading, only while signs choose the chord.
      if ((settings.chordMap as { follow?: string }).follow === 'signs') ids.push('chord-map-signs');
    }
    if (on(settings.chordChart)) ids.push('chord-chart');
    if (on(settings.chordWheel)) {
      ids.push('chord-wheel');
      // The face model is composed only while the face steers.
      const steer = (settings.chordWheel as { steer?: string }).steer;
      if (steer === 'face' || steer === 'both') ids.push('chord-wheel-face');
      // A category reader, composed only while it steers (each requires its reader's branch).
      if (steer === 'signs') ids.push('chord-wheel-signs');
      if (steer === 'categorizer') ids.push('chord-wheel-categorizer');
      // The face model, too, while the face sets the surprise.
      // (only while the wheel is ranked: the key's moves, likeliest on top).
      const wheel = settings.chordWheel as { surpriseFrom?: string; order?: string; moves?: string };
      if (wheel.surpriseFrom === 'face' && wheel.order === 'likely' && (wheel.moves ?? 'diatonic') === 'diatonic') ids.push('chord-wheel-affect');
    }
    return ids;
  },
});

export default HARMONY_EXTENSION;
