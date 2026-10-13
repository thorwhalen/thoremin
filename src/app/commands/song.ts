/**
 * Song commands (#186 PR G) — the song's transport as `acture` commands, so the Song
 * tool's button, the bar's stop control, the palette and the AI assistant all go through
 * the one dispatch surface (#87) to play and pause the song the player loaded, and to set
 * its level and tempo.
 *
 * The transport is transient hot-store state, never a dial (a saved instrument must not
 * start playing on load), and the level and tempo are a per-device pref (the song plays
 * under any instrument), which is why these reach them through the song host seam
 * (`./songHost`) and not the dials layer. Loading a song is not a command: a decoded
 * file is not a parameter, and the browser opens its file picker only from a click.
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
import { SONG_RATE_MAX, SONG_RATE_MIN } from '@/settings/schema';
import { songHost } from './songHost';

const CATEGORY = 'Song';

/** Play the loaded song (from the start when it had ended). */
export const playSongCmd = defineCommand({
  id: 'song.play',
  title: 'Play the song',
  description: 'Play the song loaded in the Song tool (from the start when it had finished).',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    const host = songHost();
    const name = host.loaded();
    if (!name) return err('no_song', 'No song is loaded: open the Song tool and choose an audio file.');
    host.setPlaying(true);
    return ok({ song: name, playing: true });
  },
});

/** Pause the song where it is. */
export const pauseSongCmd = defineCommand({
  id: 'song.pause',
  title: 'Pause the song',
  description: 'Pause the song loaded in the Song tool; playing again resumes where it stopped.',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    songHost().setPlaying(false);
    return ok({ playing: false });
  },
});

/** Set the song's level. */
export const setSongVolumeCmd = defineCommand({
  id: 'song.volume.set',
  title: 'Set the song volume',
  description: 'The level of the song loaded in the Song tool, 0 (silent) to 1.',
  category: CATEGORY,
  params: z.object({ volume: z.number().min(0).max(1).describe('0 = silent, 1 = full') }),
  execute: async ({ volume }) => {
    songHost().setVolume(volume);
    return ok({ volume });
  },
});

/** Set the song's tempo, pitch preserved. */
export const setSongRateCmd = defineCommand({
  id: 'song.rate.set',
  title: 'Set the song tempo',
  description: 'How fast the song plays, pitch preserved: 1 is its own tempo, 0.9 is 10 % slower.',
  category: CATEGORY,
  params: z.object({ rate: z.number().min(SONG_RATE_MIN).max(SONG_RATE_MAX).describe('Playback rate; 1 = the song\'s own tempo') }),
  execute: async ({ rate }) => {
    songHost().setRate(rate);
    return ok({ rate });
  },
});

/** All song commands, registered together. */
export const SONG_COMMANDS = [playSongCmd, pauseSongCmd, setSongVolumeCmd, setSongRateCmd] as const;
