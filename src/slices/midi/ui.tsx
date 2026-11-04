/**
 * The MIDI output slice's React half (#600 S13): its editor section (the switch, the live device
 * list, the mute dial), its status hook (the `midi-out` node's status into the store the section
 * reads; it was a hand-wired reporter in `useEngine.ts`), and what it leaves sounding while the
 * player has muted (the notes, when its mute dial is off).
 */
import type { ExtensionUi } from '@thoremin/sdk-ui/types';
import { MidiControls } from './panels/midi';
import { MIDI_STATUS } from './app/midiStatus';
import type { MidiSettings } from './schema';
import { provideMidiSinkFactory } from './nodes/midi_out';

// The node's browser MIDI engine (WEBMIDI.js), installed when this half loads (before any engine
// starts) and imported only when output is first enabled: nothing MIDI ships in the main chunk.
provideMidiSinkFactory(async (opts) => (await import('./app/midi_engine')).openWebMidiSink(opts));

export const MIDI_UI: ExtensionUi = {
  id: 'midi-output',
  panels: [{ instrumentId: 'midi', section: 'MIDI', Controls: MidiControls, Readout: () => null, readoutOn: () => false }],
  // The store's own hook: the host passes it the tick's time in ms, which paces its throttle.
  statusHooks: [MIDI_STATUS.statusHook],
  onMount: [],
  // #168 Q3: with its mute dial off, M quiets only the local monitor; the notes still flow.
  stillSounding: [
    {
      id: 'midi',
      whileMuted: (s) => {
        const midi = s.midi as Partial<MidiSettings> | undefined;
        return midi?.enabled === true && midi.muteFollowsMaster === false ? 'MIDI still on' : null;
      },
    },
  ],
};

export default MIDI_UI;
