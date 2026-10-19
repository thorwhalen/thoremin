/**
 * The air extension (PR 5a of the instruments-as-graphs ADR): the drum, the bass, the guitar
 * and the flute as ONE manifest. The app folds over `EXTENSIONS` for its node registry, its
 * branch table, its dials form, its settings schema and type (`defineExtension` keeps the
 * slices' keys literal, so the `Settings` type computed from the generated list declaration
 * knows `airDrum`), its `store-controls` ports and its derivation; its class and catalog rows
 * are contributions too (#600 S8). Still named in core, as strings, not imports: the overlay's
 * drum and breath ports (S10 moves them), and the catalog script's category row. The four shipped
 * air instruments are this manifest's `instruments`, seeded by core after its own, and
 * their training routes its `training` (`./training.ts`).
 *
 * The package `@thoremin/ext-air` (`packages/ext-air`, named by `extensions.json`): `nodes/` (the
 * four instruments and their two sinks), `lib/` (vocabulary, fingering prior and charts, hand
 * shape, guitar voicings, drum patterns and their fit), `app/` (status stores, taps, enrolment
 * and training components, pattern and pad collections, the typed controls) and `panels/` (the
 * editor sections). It imports only packages: the SDK (`@thoremin/sdk`, and on its React side
 * `@thoremin/sdk-ui`) and libraries; `test/packages_purity.test.ts` and
 * `test/extensions_boundary.test.ts` hold that.
 *
 * Pure: no React (the editor sections and status hooks are `./ui.tsx`, the React half).
 */
import { defineExtension, transientPort } from '@thoremin/sdk/instruments/extension';
import type { TrainedModel } from '@thoremin/sdk/enroll';
import type { PatternPlay } from './lib/pattern_play';
import type { NodeDef } from '@thoremin/dag';
import { airDrumNode } from './nodes/air_drum';
import { airBassNode } from './nodes/air_bass';
import { airGuitarNode } from './nodes/air_guitar';
import { airFluteNode } from './nodes/air_flute';
import { drumOutNode } from './nodes/drum_out';
import { pluckOutNode } from './nodes/pluck_out';
import { chordMapNode } from './nodes/chord_map';
import { chordWheelNode } from './nodes/chord_wheel';
import { drawCellGrid, cellGridOf } from '@thoremin/sdk/nodes/cell_grid_draw';
import { CHORD_WHEEL_ELEMENT } from './branches';
import { AIR_BRANCHES } from './branches';
import { AIR_DIAL_SLICES } from './dials';
import { AIR_TRAINING } from './training';
import { DRUM_PADS_ELEMENT, drumPadsElement } from './nodes/overlay/drum_pads';
import { BREATH_CUE_ELEMENT, breathCueElement } from './nodes/overlay/breath_cue';

/** What every air instrument changes besides its own dial: the theremin voices silent, no
 *  note grid, no note names on the hands. */
const SILENT_THEREMIN = {
  handMap: { maxGain: 0 },
  overlay: { scaleGuide: { show: false }, markers: { showNotes: false } },
} as const;

const on = (x: unknown): boolean => !!x && typeof x === 'object' && (x as { enabled?: boolean }).enabled === true;

/** Whether one of this extension's dials is on, read from the whole settings object. */
const dialOn = (key: string) => (s: Readonly<Record<string, unknown>>): boolean => on(s[key]);

export const AIR_EXTENSION = defineExtension({
  id: 'air',
  // The class the air instruments are listed under (#600 S8: a contribution; core owns `field`).
  classes: [{ id: 'air', label: 'Air instruments', emoji: '🌬️', colour: 'hsl(32 75% 50%)' }],
  // Its rows of the Instruments view's catalog, in display order: the id and emoji become the
  // system tag; the first row an instrument plays decides its class.
  catalog: [
    { id: 'drum', label: 'Air drum', emoji: '🥁', class: 'air', usesScale: false, on: dialOn('airDrum') },
    // 🎸 for the bass; 🤘 for the air guitar (the air guitarist's own sign).
    { id: 'bass', label: 'Air bass', emoji: '🎸', class: 'air', usesScale: true, on: dialOn('airBass') },
    // The guitar plays the chords the player enrolled, not the scale.
    { id: 'guitar', label: 'Air guitar', emoji: '🤘', class: 'air', usesScale: false, on: dialOn('airGuitar') },
    // The flute plays the notes the player named when enrolling fingerings, not the scale.
    { id: 'flute', label: 'Air flute', emoji: '🪈', class: 'air', usesScale: false, on: dialOn('airFlute') },
    // The chord map plays the chords of the chord-source scale, the key the Sound section sets.
    { id: 'chords', label: 'Chord map', emoji: '🎼', class: 'air', usesScale: true, on: dialOn('chordMap') },
    // The chord wheel steps through a space of chords from the chord-source key.
    { id: 'wheel', label: 'Chord wheel', emoji: '🎡', class: 'air', usesScale: true, on: dialOn('chordWheel') },
  ],
  // Its overlay elements: the chord wheel's grid (#600 S5), fed its grid, configured by its dial;
  // and (#600 S10; they were core's) the drum's pads and sticks on the video, just beneath the chord
  // map's grid where core drew them, and the flute's breath cue, stacked on its edge where core put
  // it. Every element's options are this extension's dials, delivered by the host.
  overlay: [
    { name: CHORD_WHEEL_ELEMENT, category: 'guide', inputs: [{ name: 'grid', kind: 'cell-grid' }], config: { dialKey: 'chordWheel' } },
    { name: DRUM_PADS_ELEMENT, category: 'guide', drawBefore: 'cellGrid', inputs: [{ name: 'hits', kind: 'drum-hits' }, { name: 'hands', kind: 'hands-frame' }], config: { dialKey: 'airDrum' } },
    { name: BREATH_CUE_ELEMENT, category: 'output', cue: true, drawBefore: 'faceExpression', inputs: [{ name: 'status', kind: 'air-flute-status' }], config: { dialKey: 'airFlute' } },
  ],
  overlayElements: [
    drumPadsElement,
    breathCueElement,
    {
      name: CHORD_WHEEL_ELEMENT,
      draw(g, frame, inputs) {
        if ((inputs.config as { enabled?: boolean } | undefined)?.enabled !== true) return;
        const grid = cellGridOf(inputs.grid);
        if (grid) drawCellGrid(g, frame.W, frame.H, grid);
      },
    },
  ],
  nodes: [airDrumNode, airBassNode, airGuitarNode, airFluteNode, drumOutNode, pluckOutNode, chordMapNode, chordWheelNode] as unknown as NodeDef<unknown>[],
  branches: AIR_BRANCHES,
  dials: AIR_DIAL_SLICES,
  // The enrolled classifiers: transient hot-store fields the nodes read as ports. Always
  // emitted, null included, so clearing an enrolment reaches the node.
  transient: [
    transientPort<TrainedModel>()('airGuitarModel', 'shape-model'),
    transientPort<TrainedModel>()('airFluteFingerModel', 'shape-model'),
    transientPort<TrainedModel>()('airFluteMouthModel', 'shape-model'),
    // #269: the trained drum pattern in play (pattern + model), resolved by the app off the tick.
    transientPort<PatternPlay>()('airDrumPattern', 'drum-pattern'),
  ],
  // The four air instruments (#249), played by miming, listed in their own class. Each
  // silences the theremin voices (hand-map max gain 0) so the hands only play the air
  // instrument (raise it in the Hand section to play a melody over it), and hides the note
  // grid and the note names on the hands: they would label notes nobody hears.
  instruments: [
    // Strike the air, hear a drum at the strike (#233).
    { name: 'Air Drum', patch: { ...SILENT_THEREMIN, airDrum: { enabled: true } } },
    // Pluck a bass that is not there: the neck hand's distance from the plucking hand picks
    // the note from this scale (E minor pentatonic over the two octaves from E2: a real bass's
    // lowest octave, E1, is mostly below what a laptop speaker plays), a pluck sounds it.
    {
      name: 'Air Bass',
      patch: {
        ...SILENT_THEREMIN,
        right: { root: 4, type: 'minorPentatonic', baseOctave: 2, octaves: 2 },
        left: { root: 4, type: 'minorPentatonic', baseOctave: 2, octaves: 2 },
        airBass: { enabled: true },
      },
    },
    // Strum chords in the air: the chord hand's shape against the chords this player taught
    // it (the enrolment step, in its settings), a predicted strum of the other hand.
    { name: 'Air Guitar', patch: { ...SILENT_THEREMIN, airGuitar: { enabled: true } } },
    // Play a flute in the air: enrolled finger lifts of both hands choose the note, the
    // enrolled blowing mouth sounds it (the enrolment steps are in its settings).
    { name: 'Air Flute', patch: { ...SILENT_THEREMIN, airFlute: { enabled: true } } },
    // Point at a key's chords (Pur Pasteur's harmonic map): the left hand over a chord holds
    // it, the right hand's height plays a melody on its tones. C major, as in the video; the
    // key is the chord-source scale (the Sound section's root and scale).
    // Each change voice-led, common tones held, as the video voices it (H3 of #613); the melody
    // hand's tilt chooses its notes (chord tones, pentatonic, scale), as the video's right hand.
    { name: 'Chord Map', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, melodyNotes: 'tilt' } } },
    // The same map coloured by the face (H7 of #613): a held smile turns A minor to A major, a
    // frown back; an open mouth with raised brows adds the seventh, then the ninth.
    { name: 'Chord Map + Face', patch: { ...SILENT_THEREMIN, right: { root: 9, type: 'minor' }, faceChord: { voicing: 'voiceLed' }, chordMap: { enabled: true, melodyNotes: 'tilt', face: true } } },
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
    { name: 'Chord Map Strum', patch: { ...SILENT_THEREMIN, right: { root: 0, type: 'major' }, chordMap: { enabled: true, play: 'strum' } } },
  ],
  training: AIR_TRAINING,
  derive: (s) => {
    const settings = s as Record<string, unknown>;
    const ids: string[] = [];
    if (on(settings.airDrum)) ids.push('air-drum');
    if (on(settings.airBass)) ids.push('air-bass');
    if (on(settings.airGuitar)) ids.push('air-guitar');
    if (on(settings.airFlute)) ids.push('air-flute');
    if (on(settings.chordMap)) {
      ids.push('chord-map');
      // The face model is composed only while the face colours the map.
      if ((settings.chordMap as { face?: boolean }).face === true) ids.push('chord-map-face');
    }
    if (on(settings.chordWheel)) {
      ids.push('chord-wheel');
      // The face model is composed only while the face steers.
      const steer = (settings.chordWheel as { steer?: string }).steer;
      if (steer === 'face' || steer === 'both') ids.push('chord-wheel-face');
    }
    return ids;
  },
});

export default AIR_EXTENSION;
