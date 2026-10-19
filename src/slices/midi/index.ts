/**
 * The MIDI output slice (#137; a slice since #600 S13, the first of Phase E): the merged voices as
 * a Web MIDI output, with its node (`midi-out`, its WEBMIDI.js engine lazily imported), its branch,
 * its dial and, in its React half (`./ui.tsx`), its editor section and status. Listed in
 * `extensions.json` like any extension, so the core-alone build (`npm run test:core`) proves the
 * shell no longer names it.
 *
 * Its dial is FLAT (`layout: 'flat'`): `midi.enabled`, `midi.port` and `midi.muteFollowsMaster`
 * are the keys it had in core, so a saved instrument and a bound command keep theirs. Its node's
 * live inputs predate the slice; the dial derives them (`ports`), so the graph is unchanged.
 */
import { defineBranch } from '@thoremin/sdk/instruments/branch';
import { defineExtension, dialSlice } from '@thoremin/sdk/instruments/extension';
import { TRUNK } from '@thoremin/sdk/instruments/trunk';
import type { NodeDef } from '@thoremin/dag';
import { midiOutNode } from './nodes/midi_out';
import { DEFAULT_MIDI, MidiSettingsSchema, type MidiSettings } from './schema';

const ui = (port: string) => ({ node: TRUNK.ui, port });
const to = (from: { node: string; port: string }, toRef: { node: string; port: string }) => ({ from, to: toRef });

export const MIDI_BRANCH_ID = 'midi-out';

export const midiOut = defineBranch({
  id: MIDI_BRANCH_ID,
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

export const MIDI_EXTENSION = defineExtension({
  // The id names what it does: not `midi` (core's word for a note number), nor `midi-out` (its node
  // type and branch id, which core must never spell, while the flat-slice table names this id).
  id: 'midi-output',
  nodes: [midiOutNode] as unknown as NodeDef<unknown>[],
  branches: [midiOut],
  dials: [
    dialSlice({
      key: 'midi',
      schema: MidiSettingsSchema.default(DEFAULT_MIDI),
      kind: 'midi-config',
      meta: { facets: ['MIDI'], title: 'MIDI output', description: 'The played voices on a Web MIDI output' },
      layout: 'flat',
      // The node's live inputs, as core's bridge fed them before the slice.
      ports: [
        { name: 'midiEnabled', kind: 'boolean', read: (d: MidiSettings) => d.enabled },
        { name: 'midiPort', kind: 'string', read: (d: MidiSettings) => d.port },
        { name: 'midiMuteFollowsMaster', kind: 'boolean', read: (d: MidiSettings) => d.muteFollowsMaster },
      ],
    }),
  ] as const,
  derive: (s) => ((s as { midi?: Partial<MidiSettings> }).midi?.enabled === true ? [MIDI_BRANCH_ID] : []),
});

export default MIDI_EXTENSION;
