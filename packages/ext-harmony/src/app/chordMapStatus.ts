/**
 * chordMapStatus — the live chord-map state the engine loop reports, for its settings section
 * and the Instruments view: the key, whether the chord hand is seen, the chord in force, the
 * melody note, and the strums (how many, how many predicted ahead). Ephemeral per-frame runtime
 * state in the shared readout store (#969): the DAG produces it, React only displays it.
 */
import { createStatusStore, type StatusState } from '@thoremin/sdk-ui/statusStore';
import { IDLE_CHORD_MAP_STATUS, type ChordMapStatus } from '../nodes/chord_map';

export type ChordMapLive = ChordMapStatus;
export const ABSENT_CHORD_MAP_LIVE: ChordMapLive = IDLE_CHORD_MAP_STATUS;

/** The node id the reporter reads: the `chordMap` node of the `chord-map` branch. */
export const CHORD_MAP_NODE_ID = 'chordMap';

export type ChordMapStatusState = StatusState<ChordMapLive, 'live'>;

/** What to tell the player, per state, and where they are on the idiom the trail draws (#713). */
export function describeChordMapLive(live: ChordMapLive): string {
  const said = describeState(live);
  const idiom = live.enabled ? live.idiom : null;
  if (!idiom) return said;
  if (idiom.step === 0) return `${said} ${idiom.name}: follow the trail from its first chord.`;
  return `${said} ${idiom.name}: ${idiom.onPath ? `chord ${idiom.step} of ${idiom.steps}` : `off the path (it waits at chord ${idiom.step})`}.`;
}

function describeState(live: ChordMapLive): string {
  if (!live.enabled) return 'Off. Tick "Play the chord map" (the Chord Map instruments have it on).';
  if (live.signs === 'waiting' && live.chord === null && !live.inputChord) return `Key of ${live.key}. Show your hand and fingerspell a letter A to G: its chord lights up.`;
  if (live.signs !== 'off' && live.chord === null && !live.inputChord) return `Key of ${live.key}. Fingerspell a letter A to G${live.sign ? ` (reading ${live.sign})` : ''}.`;
  if (live.midi === 'waiting') return 'Waiting for the browser: allow MIDI access to hear your keyboard.';
  if (live.midi === 'denied') return 'MIDI access was refused. Allow it in the site settings, or choose the chords with your hand.';
  if (live.midi === 'unavailable') return 'This browser cannot hear MIDI (Safari has no Web MIDI): use Chrome, Edge or Firefox, or choose the chords with your hand.';
  if (live.midi === 'no-input') return 'No MIDI keyboard found. Plug one in: it is heard as soon as it appears.';
  if (live.audio === 'waiting') return 'Waiting for the browser: allow the microphone to hear your instrument.';
  if (live.audio === 'refused') return 'Listening is off while a streaming player plays: close it, or choose the chords with your hand.';
  if (live.audio === 'denied') return 'The microphone was refused. Allow it in the site settings, or choose the chords with your hand.';
  if (live.audio === 'unavailable') return 'This browser offers no microphone here: choose the chords with your hand or a MIDI keyboard.';
  if (live.audio === 'quiet' && live.chord === null && !live.inputChord) return `Key of ${live.key}. Play a chord near the microphone: a guitar, a piano, a band.`;
  if ((live.midi === 'listening' || live.audio === 'listening' || live.audio === 'quiet') && live.chord === null) {
    if (!live.inputChord) return live.audio !== 'off' ? `Key of ${live.key}. Listening for a chord.` : `Key of ${live.key}. Play a chord on your MIDI keyboard.`;
    return live.play === 'strum' ? `${live.inputChord}. Strum it with your other hand.` : `${live.inputChord}. Raise or lower your other hand for a melody on its notes.`;
  }
  if (!live.pointing && live.midi === 'off' && live.audio === 'off' && live.signs === 'off') return 'Show your chord hand: put its palm over a chord on the screen.';
  if (live.chord === null) return `Key of ${live.key}. Move your chord hand over a chord.`;
  const chord = `${live.chord} (${live.numeral})${live.mode === 'brighter' ? ', the smile made it major' : live.mode === 'darker' ? ', the frown made it minor' : ''}${live.tension > 1 ? ', with a ninth' : live.tension > 0 ? ', with a seventh' : ''}`;
  if (live.play === 'hold') return live.melody ? `${chord}, melody ${live.melody} (${live.melodySet === 'chord' ? 'chord tones' : live.melodySet}).` : `${chord}. Raise or lower your other hand for a melody on its notes.`;
  if (!live.ready) return `${chord}. Strum down once with your other hand to teach it your stroke.`;
  if (live.strums === 0) return `${chord}. Strum with your other hand.`;
  const ms = Math.round(Math.abs(live.lastLead) * 1000);
  return live.lastLead >= 0 ? `${chord}: strummed ${ms} ms before the strum.` : `${chord}: strummed ${ms} ms after the strum.`;
}

/** Quantise what the view shows. */
export function chordMapLiveKey(l: ChordMapLive): string {
  return [l.enabled ? 1 : 0, l.play, l.key, l.pointing ? 1 : 0, l.chord ?? '-', l.melody ?? '-', l.melodySet, l.strums, l.predicted, Math.round(l.lastLead * 1000), l.ready ? 1 : 0, l.signs, l.sign ?? '-', l.inputChord ?? '-', l.idiom ? `${l.idiom.step}${l.idiom.onPath ? '' : '!'}` : '-'].join('|');
}

/** The chord map's readout store, reporter and status hook (the shared readout store, #969). */
export const CHORD_MAP_STATUS = createStatusStore(CHORD_MAP_NODE_ID, { absent: ABSENT_CHORD_MAP_LIVE, keyOf: chordMapLiveKey, field: 'live' });

export const useChordMapStatus = CHORD_MAP_STATUS.useStatus;

/** The per-frame sink over the chord map node (to this store by default). */
export const makeChordMapReporter = CHORD_MAP_STATUS.makeReporter;
