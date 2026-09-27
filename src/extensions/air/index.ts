/**
 * The air extension (PR 5a of the instruments-as-graphs ADR): the drum, the bass, the guitar
 * and the flute as ONE manifest. The app folds over `EXTENSIONS` for its node registry, its
 * branch table, its dials form, its `store-controls` ports and its derivation. Still named in
 * core, on purpose: the settings schema's typed spread of the air shape, the hot store's
 * fields, `AIR_INSTRUMENTS` (the library's class derivation), the seeds, and the catalog
 * script's category row.
 *
 * Since 5b the air files live here: `nodes/` (the four instruments and their two sinks),
 * `lib/` (vocabulary, fingering prior, hand shape, guitar voicings), `app/` (status stores,
 * taps, enrolment and training components, pattern and pad collections) and `panels/` (the
 * editor sections). What they import from core is the SDK surface, listed as data in
 * `test/extensions_boundary.test.ts`.
 *
 * Pure: no React (the editor sections and status hooks are `./ui.tsx`, the React half).
 */
import type { Extension } from '@/instruments/extension';
import type { NodeDef } from '@/dag';
import { airDrumNode } from '@/extensions/air/nodes/air_drum';
import { airBassNode } from '@/extensions/air/nodes/air_bass';
import { airGuitarNode } from '@/extensions/air/nodes/air_guitar';
import { airFluteNode } from '@/extensions/air/nodes/air_flute';
import { drumOutNode } from '@/extensions/air/nodes/drum_out';
import { pluckOutNode } from '@/extensions/air/nodes/pluck_out';
import { AIR_BRANCHES } from './branches';
import { AIR_DIAL_SLICES } from './dials';

const on = (x: unknown): boolean => !!x && typeof x === 'object' && (x as { enabled?: boolean }).enabled === true;

export const AIR_EXTENSION: Extension = {
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
  derive: (s) => {
    const settings = s as Record<string, unknown>;
    const ids: string[] = [];
    if (on(settings.airDrum)) ids.push('air-drum');
    if (on(settings.airBass)) ids.push('air-bass');
    if (on(settings.airGuitar)) ids.push('air-guitar');
    if (on(settings.airFlute)) ids.push('air-flute');
    return ids;
  },
};
