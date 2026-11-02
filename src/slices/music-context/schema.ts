/**
 * The music-context dial: whether the instrument's scale follows the music (`scaleFrom`), how a
 * key is fitted to the instrument's scale (`fit`), how far ahead a change is announced, and how far
 * ahead the expectations reach. One object dial (`musicContext.*`); instrument identity, saved with
 * an instrument (a play-along instrument is one that follows the music).
 */
import { z } from 'zod';
import { SCALE_FITS } from '@thoremin/sdk/context/scale';

export const SCALE_OWNERS = ['dials', 'music'] as const;
export type ScaleOwner = (typeof SCALE_OWNERS)[number];

export const MusicContextSettingsSchema = z.object({
  scaleFrom: z
    .enum(SCALE_OWNERS)
    .default('dials')
    .meta({ title: 'Scale from', description: "Who owns the instrument's scale: the settings (dials), or the music playing (its key, changing where the music changes key)" }),
  fit: z
    .enum(SCALE_FITS)
    .default('flavour')
    .meta({ title: 'Fit to the key', description: "How the music's key sets the scale: keep the instrument's kind of scale in the new key (flavour), or play the key's own seven notes (key)" }),
  lookAheadBeats: z.number().min(0).max(8).default(1).meta({ title: 'Look-ahead (beats)', description: 'How far ahead a key or chord change is announced, so it lands on its beat' }),
  horizonBeats: z.number().min(0).max(32).default(4).meta({ title: 'Expectations ahead (beats)', description: 'How far ahead the coming bars, chords and notes are listed' }),
});
export type MusicContextSettings = z.infer<typeof MusicContextSettingsSchema>;

export const DEFAULT_MUSIC_CONTEXT: MusicContextSettings = MusicContextSettingsSchema.parse({});

/** The dial's key and the transient field holding the timeline in force. */
export const MUSIC_CONTEXT_DIAL = 'musicContext' as const;
export const MUSIC_CONTEXT_ACTIVE = 'musicContextActive';
