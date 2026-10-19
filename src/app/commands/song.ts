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
import { SONG_START_BEAT_MAX, SONG_HOLD_FADE_MAX, SONG_FOLLOW_RANGE_MAX, SONG_FOLLOW_RANGE_MIN, SONG_RATE_MAX, SONG_RATE_MIN } from '@/settings/schema';
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

/** Make the song follow the dancer, or stop it following (#186 PR H). */
export const setSongFollowCmd = defineCommand({
  id: 'song.follow.set',
  title: 'Follow the dancer',
  description:
    "Whether the song's tempo follows the dancer's pulse (the body camera starts while a song is loaded); off plays it at its own tempo.",
  category: CATEGORY,
  params: z.object({ follow: z.boolean().describe('true = the song follows the dancer') }),
  execute: async ({ follow }) => {
    songHost().setFollow(follow);
    return ok({ follow });
  },
});

/** How far following may pull the song from its tempo. */
export const setSongFollowRangeCmd = defineCommand({
  id: 'song.followRange.set',
  title: 'Set the follow range',
  description: "How far from the song's set tempo following the dancer may pull it: 0.1 is +-10 %.",
  category: CATEGORY,
  params: z.object({
    range: z.number().min(SONG_FOLLOW_RANGE_MIN).max(SONG_FOLLOW_RANGE_MAX).describe('A fraction of the tempo; 0.1 = +-10 %'),
  }),
  execute: async ({ range }) => {
    songHost().setFollowRange(range);
    return ok({ range });
  },
});

/** How long the song fades when the conductor holds it (#366). */
export const setSongHoldFadeCmd = defineCommand({
  id: 'song.holdFade.set',
  title: 'Set the hold fade',
  description: 'Seconds the song fades out when the conductor holds or stops, and back in on the release; 0 cuts it.',
  category: CATEGORY,
  params: z.object({ seconds: z.number().min(0).max(SONG_HOLD_FADE_MAX).describe('Fade length in seconds; 0 = a cut') }),
  execute: async ({ seconds }) => {
    songHost().setHoldFade(seconds);
    return ok({ seconds });
  },
});

/** Whether a Play lands the song's beat on the dancer's cycle at once (#346 item 1). */
export const setSongAlignStartCmd = defineCommand({
  id: 'song.alignStart.set',
  title: "Land the song on the dancer's step at the start",
  description: "While the song follows the dancer, a Play moves the song once (at most half a beat) so its beat lands on the dancer's cycle start, instead of closing the phase error gradually.",
  category: CATEGORY,
  params: z.object({ on: z.boolean().describe('Whether to align the song at the start') }),
  execute: async ({ on }) => {
    songHost().setAlignStart(on);
    return ok({ on });
  },
});

/** How far the song slows while it fades on a conductor's hold (#573). */
export const setSongHoldSlowCmd = defineCommand({
  id: 'song.holdSlow.set',
  title: 'Set the slowdown on a hold',
  description: "How far toward the slowest rate the song slows while it fades out on the conductor's hold, so the held note stretches; 0 keeps the rate. Needs the hold fade.",
  category: CATEGORY,
  params: z.object({ fraction: z.number().min(0).max(1).describe('0 = no slowdown, 1 = all the way to the slowest rate') }),
  execute: async ({ fraction }) => {
    songHost().setHoldSlow(fraction);
    return ok({ fraction });
  },
});

/** Where in the song the conductor's first beat lands (#364). */
export const setSongStartBeatCmd = defineCommand({
  id: 'song.startBeat.set',
  title: 'Set the song beat the conductor starts on',
  description: "The song's beat (0 = its first tracked beat) on which the conductor's first beat lands when he conducts a recording; skips an intro or a pickup.",
  category: CATEGORY,
  params: z.object({ beat: z.number().int().min(0).max(SONG_START_BEAT_MAX).describe('A whole song beat; 0 = the first tracked beat') }),
  execute: async ({ beat }) => {
    songHost().setStartBeat(beat);
    return ok({ beat });
  },
});

/** All song commands, registered together. */
export const SONG_COMMANDS = [playSongCmd, pauseSongCmd, setSongVolumeCmd, setSongRateCmd, setSongFollowCmd, setSongFollowRangeCmd, setSongHoldFadeCmd, setSongHoldSlowCmd, setSongAlignStartCmd, setSongStartBeatCmd] as const;
