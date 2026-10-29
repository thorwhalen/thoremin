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
  /** RMS of the window, 0..1, when the analyser said (the loudness of the audio the pitch describes). */
  rms?: number;
}

export interface HeardOnset {
  t: number;
  /** The detector's strength, for display; the judge ignores it. */
  strength: number;
}

/** The vocal tract's resonances over one window (the vowel games), Hz or null. */
export interface HeardFormants {
  t: number;
  f1: number | null;
  f2: number | null;
  f3: number | null;
  rms: number;
}

export interface Heard {
  pitch: readonly HeardPitch[];
  onsets: readonly HeardOnset[];
  /** Only when a game asked for the formant analyser. */
  formants?: readonly HeardFormants[];
}

export const NOTHING_HEARD: Heard = { pitch: [], onsets: [] };

/** The analyser ids the games' `audio-events` node runs (its lease on the audio-input hub). */
export const GAMES_ANALYSERS = [
  { name: 'onset', id: 'onset' },
  { name: 'pitch', id: 'pitch' },
];

/** The onset analyser alone: what Echo reads (claps and taps, no pitch). */
export const ONSET_ANALYSERS = [{ name: 'onset', id: 'onset' }];

/** The formant analyser: what the vowel games read. */
export const FORMANT_ANALYSERS = [{ name: 'formants', id: 'formants' }];

/** The pitch analyser alone: what the field games read (their loudness rides on the pitch frames). */
export const PITCH_ANALYSERS = [{ name: 'pitch', id: 'pitch' }];

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
  const formants: HeardFormants[] = [];
  for (const e of events) {
    if (e.kind === 'formants' && e.source === 'formants') formants.push({ t: e.t, f1: e.f1, f2: e.f2, f3: e.f3, rms: e.rms });
    if (e.kind === 'pitch' && e.source === 'pitch') pitch.push(e.rms === undefined ? { t: e.t, f0: e.f0, clarity: e.clarity } : { t: e.t, f0: e.f0, clarity: e.clarity, rms: e.rms });
    else if (e.kind === 'onset' && e.source === 'onset') onsets.push({ t: e.t, strength: e.strength });
  }
  return formants.length ? { pitch, onsets, formants } : { pitch, onsets };
}

/** The same input with every time moved by `-offset` (the player's calibrated offset). */
export function shifted(heard: Heard, offset: number): Heard {
  if (offset === 0) return heard;
  return {
    pitch: heard.pitch.map((p) => ({ ...p, t: p.t - offset })),
    onsets: heard.onsets.map((o) => ({ ...o, t: o.t - offset })),
    ...(heard.formants ? { formants: heard.formants.map((f) => ({ ...f, t: f.t - offset })) } : {}),
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
