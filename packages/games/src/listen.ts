/**
 * What a listening game hears in one tick: the pitch frames and onsets the microphone's
 * analysers posted since the last tick, each at the engine time of the audio it describes.
 *
 * The games' own minimal input, kept apart from the audio seam's event schema (lane B's
 * `audio-events`): the game node adapts those events to this, so a change of the seam's shape
 * touches one adapter, and a test feeds the games recorded or scripted input directly.
 */
import type { AudioEvent } from '@thoremin/sdk/audio/types';

export interface HeardPitch {
  t: number;
  /** Hz, or null when nothing periodic was heard. */
  f0: number | null;
  clarity: number;
}

export interface HeardOnset {
  t: number;
  /** The detector's strength, for display; the judge ignores it. */
  strength: number;
}

export interface Heard {
  pitch: readonly HeardPitch[];
  onsets: readonly HeardOnset[];
}

export const NOTHING_HEARD: Heard = { pitch: [], onsets: [] };

/** The analyser ids the games' `audio-events` node runs (its lease on the audio-input hub). */
export const GAMES_ANALYSERS = [
  { name: 'onset', id: 'onset' },
  { name: 'pitch', id: 'pitch' },
];

/** An event on the audio seam's `audio-events` port: an analyser's event, its id, its engine time. */
export type TimedAudioEvent = AudioEvent & { source: string; t: number };

/**
 * The adapter from the audio seam to the games: the tick's `pitch` events of the games' pitch
 * analyser and `onset` events of its onset analyser (another consumer's analysers are ignored).
 */
export function heardFrom(events: readonly TimedAudioEvent[] | undefined): Heard {
  if (!events || events.length === 0) return NOTHING_HEARD;
  const pitch: HeardPitch[] = [];
  const onsets: HeardOnset[] = [];
  for (const e of events) {
    if (e.kind === 'pitch' && e.source === 'pitch') pitch.push({ t: e.t, f0: e.f0, clarity: e.clarity });
    else if (e.kind === 'onset' && e.source === 'onset') onsets.push({ t: e.t, strength: e.strength });
  }
  return { pitch, onsets };
}

/** The same input with every time moved by `-offset` (the player's calibrated offset). */
export function shifted(heard: Heard, offset: number): Heard {
  if (offset === 0) return heard;
  return {
    pitch: heard.pitch.map((p) => ({ ...p, t: p.t - offset })),
    onsets: heard.onsets.map((o) => ({ ...o, t: o.t - offset })),
  };
}

/** What to tell the player about the microphone, from the audio hub's state; null while it is live. */
export function micNotice(state: string): string | null {
  switch (state) {
    case '':
    case 'live':
      return null;
    case 'denied':
      return 'The microphone was refused: allow it in the browser to play.';
    case 'unsupported':
      return 'This browser offers no microphone.';
    case 'failed':
      return 'The microphone could not be opened.';
    case 'unavailable':
      return 'No audio input here.';
    case 'waiting-audio':
      return 'Click or press a key to start the sound.';
    default:
      return 'Opening the microphone...';
  }
}
