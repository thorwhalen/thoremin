/**
 * The air extension (PR 5a of the instruments-as-graphs ADR): the drum, the bass, the guitar
 * and the flute as ONE manifest. The app folds over `EXTENSIONS` for its node registry, its
 * branch table, its dials form, its settings schema and type (`defineExtension` keeps the
 * slices' keys literal, so the `Settings` type computed from the generated list declaration
 * knows `airDrum`), its `store-controls` ports and its derivation. Still named in core, as
 * strings and types, not imports: the hot store's transient fields, `AIR_INSTRUMENTS` (the
 * library's class derivation) and the catalog script's category row. The four shipped
 * air instruments are this manifest's `instruments`, seeded by core after its own, and
 * their training routes its `training` (`./training.ts`).
 *
 * Since 5b the air files live here: `nodes/` (the four instruments and their two sinks),
 * `lib/` (vocabulary, fingering prior, hand shape, guitar voicings), `app/` (status stores,
 * taps, enrolment and training components, pattern and pad collections) and `panels/` (the
 * editor sections). What they import from core is the SDK surface, listed as data in
 * `test/extensions_boundary.test.ts`.
 *
 * Pure: no React (the editor sections and status hooks are `./ui.tsx`, the React half).
 */
import { defineExtension } from '@thoremin/sdk/instruments/extension';
import type { NodeDef } from '@thoremin/dag';
import { airDrumNode } from '@/extensions/air/nodes/air_drum';
import { airBassNode } from '@/extensions/air/nodes/air_bass';
import { airGuitarNode } from '@/extensions/air/nodes/air_guitar';
import { airFluteNode } from '@/extensions/air/nodes/air_flute';
import { drumOutNode } from '@/extensions/air/nodes/drum_out';
import { pluckOutNode } from '@/extensions/air/nodes/pluck_out';
import { AIR_BRANCHES } from './branches';
import { AIR_DIAL_SLICES } from './dials';
import { AIR_TRAINING } from './training';

/** What every air instrument changes besides its own dial: the theremin voices silent, no
 *  note grid, no note names on the hands. */
const SILENT_THEREMIN = {
  handMap: { maxGain: 0 },
  overlay: { scaleGuide: { show: false }, markers: { showNotes: false } },
} as const;

const on = (x: unknown): boolean => !!x && typeof x === 'object' && (x as { enabled?: boolean }).enabled === true;

export const AIR_EXTENSION = defineExtension({
  id: 'air',
  nodes: [airDrumNode, airBassNode, airGuitarNode, airFluteNode, drumOutNode, pluckOutNode] as unknown as NodeDef<unknown>[],
  branches: AIR_BRANCHES,
  dials: AIR_DIAL_SLICES,
  // The enrolled classifiers: transient hot-store fields the nodes read as ports. Always
  // emitted, null included, so clearing an enrolment reaches the node.
  transient: [
    { field: 'airGuitarModel', kind: 'shape-model' },
    { field: 'airFluteFingerModel', kind: 'shape-model' },
    { field: 'airFluteMouthModel', kind: 'shape-model' },
    // #269: the trained drum pattern in play (pattern + model), resolved by the app off the tick.
    { field: 'airDrumPattern', kind: 'drum-pattern' },
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
  ],
  training: AIR_TRAINING,
  derive: (s) => {
    const settings = s as Record<string, unknown>;
    const ids: string[] = [];
    if (on(settings.airDrum)) ids.push('air-drum');
    if (on(settings.airBass)) ids.push('air-bass');
    if (on(settings.airGuitar)) ids.push('air-guitar');
    if (on(settings.airFlute)) ids.push('air-flute');
    return ids;
  },
});

export default AIR_EXTENSION;
