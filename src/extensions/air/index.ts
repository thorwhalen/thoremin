/**
 * The air extension (PR 5a of the instruments-as-graphs ADR): the drum, the bass, the guitar
 * and the flute as ONE manifest. The app folds over `EXTENSIONS` for its node registry, its
 * branch table, its dials form, its `store-controls` ports and its derivation. Still named in
 * core, on purpose or until 5b: the settings schema's typed spread of the air shape, the hot
 * store's fields, `AIR_INSTRUMENTS` (the library's class derivation), the seeds, the readout
 * table `panels/air.tsx`, and the catalog script's category row.
 *
 * The node files still live at their pre-extension paths (`src/nodes/music/air_*`,
 * `src/nodes/output/{drum,pluck}_out`): 5b moves them once the trainer stream is done with
 * `src/air`. This manifest is what makes that move a `git mv`.
 *
 * Pure: no React (the editor sections and status hooks are `./ui.tsx`, the React half).
 */
import type { Extension } from '@/instruments/extension';
import type { NodeDef } from '@/dag';
import { airDrumNode } from '@/nodes/music/air_drum';
import { airBassNode } from '@/nodes/music/air_bass';
import { airGuitarNode } from '@/nodes/music/air_guitar';
import { airFluteNode } from '@/nodes/music/air_flute';
import { drumOutNode } from '@/nodes/output/drum_out';
import { pluckOutNode } from '@/nodes/output/pluck_out';
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
