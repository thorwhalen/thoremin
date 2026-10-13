/**
 * Song commands (#186 PR G) — the song's transport as `acture` commands, so the Song
 * tool's button, the bar's stop control, the palette and the AI assistant all go through
 * the one dispatch surface (#87) to play and pause the song the player loaded.
 *
 * The transport is transient hot-store state, never a dial (a saved instrument must not
 * start playing on load), which is why these reach it through the song host seam
 * (`./songHost`) and not the dials layer. Loading a song is not a command: a decoded
 * file is not a parameter, and the browser opens its file picker only from a click.
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
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

/** All song commands, registered together. */
export const SONG_COMMANDS = [playSongCmd, pauseSongCmd] as const;
