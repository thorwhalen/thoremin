/**
 * General MIDI percussion (#269): the drum names a pattern is written in, their MIDI
 * note numbers on channel 10, and the air drum's sound each one plays on.
 *
 * The air drum has six sounds (`DRUM_SOUNDS`); General MIDI has forty-odd instruments.
 * The map is many-to-one on purpose: a pattern written with an open hi-hat or a floor
 * tom still plays on the kit we have, and a MIDI drum track imported later lands on the
 * same six. Pure.
 */
import type { DrumSound } from '@/nodes/music/drum_pads';

/** The names a pattern row can be written under. */
export const DRUM_NAMES = ['kick', 'snare', 'hihat', 'openHihat', 'tom', 'floorTom', 'crash', 'ride'] as const;
export type DrumName = (typeof DRUM_NAMES)[number];

/** The General MIDI note each name is written as (the canonical one where GM has several). */
export const DRUM_MIDI: Record<DrumName, number> = {
  kick: 36,
  snare: 38,
  hihat: 42,
  openHihat: 46,
  tom: 47,
  floorTom: 43,
  crash: 49,
  ride: 51,
};

/** The air drum's sound for each name. */
export const DRUM_SOUND: Record<DrumName, DrumSound> = {
  kick: 'kick',
  snare: 'snare',
  hihat: 'hihat',
  openHihat: 'hihat',
  tom: 'tom',
  floorTom: 'tom',
  crash: 'crash',
  ride: 'ride',
};

/** Every General MIDI percussion note the kit can play, to its sound. Notes not listed
 *  (claves, cowbell, the Latin set) have no sound here. */
const GM_TO_SOUND: Record<number, DrumSound> = {
  35: 'kick',
  36: 'kick',
  37: 'snare', // side stick
  38: 'snare',
  39: 'snare', // hand clap
  40: 'snare',
  41: 'tom',
  42: 'hihat',
  43: 'tom',
  44: 'hihat', // pedal hi-hat
  45: 'tom',
  46: 'hihat',
  47: 'tom',
  48: 'tom',
  49: 'crash',
  50: 'tom',
  51: 'ride',
  52: 'crash', // china
  53: 'ride', // ride bell
  55: 'crash', // splash
  57: 'crash',
  59: 'ride',
};

/** The sound a General MIDI percussion note plays on, or null when the kit has none. */
export function soundForGmNote(midi: number): DrumSound | null {
  return GM_TO_SOUND[midi] ?? null;
}

/** The pattern name for a General MIDI note (the canonical name of its sound), or null. */
export function drumNameForGmNote(midi: number): DrumName | null {
  const exact = (Object.keys(DRUM_MIDI) as DrumName[]).find((n) => DRUM_MIDI[n] === midi);
  if (exact) return exact;
  const sound = soundForGmNote(midi);
  if (!sound) return null;
  return (Object.keys(DRUM_SOUND) as DrumName[]).find((n) => DRUM_SOUND[n] === sound) ?? null;
}
