/**
 * The MIDI output dial (#137; a slice since #600 S13): whether the merged voices also drive a Web
 * MIDI output, to which port, and whether the master mute silences it. It is instrument identity
 * (a hardware-synth instrument wants "plays over MIDI" saved with it); the port NAME is
 * device-specific, but a port that does not exist on this machine degrades to an honest
 * `no-ports` status, never an error.
 *
 * A FLAT slice: each field is its own dial (`midi.enabled`, `midi.port`, `midi.muteFollowsMaster`),
 * the keys it had before it was a slice, so a saved instrument and a bound command keep theirs.
 */
import { z } from 'zod';

export const MidiSettingsSchema = z.object({
  enabled: z.boolean().default(false).meta({ facets: ['MIDI'], title: 'MIDI output', description: 'Send the played voices to a Web MIDI output (external synth or DAW)' }),
  /** A FREE string, not an enum: the real options are the live device list (`MidiStatus.ports`),
   *  which only exists at runtime; the panel renders them as a select, the palette and the
   *  assistant take the name as text. '' targets the first available port. */
  port: z.string().default('').meta({ facets: ['MIDI'], title: 'MIDI port', description: 'MIDI output port name (empty = first available)' }),
  /** Whether the master mute (M) silences the MIDI stream too (#168 Q3). On is what the
   *  instrument always did; off keeps the notes flowing to a DAW while the local monitor is quiet. */
  muteFollowsMaster: z
    .boolean()
    .default(true)
    .meta({ facets: ['MIDI'], title: 'Mute silences MIDI too', description: 'When on, the master mute (M) also stops the MIDI notes; when off, only the local sound is muted and notes keep flowing to your DAW' }),
});
export type MidiSettings = z.infer<typeof MidiSettingsSchema>;

/** The shipped MIDI defaults: off, first available port, the master mute silences MIDI too. */
export const DEFAULT_MIDI: MidiSettings = { enabled: false, port: '', muteFollowsMaster: true };
