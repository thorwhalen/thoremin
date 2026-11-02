/**
 * The player's entries about the music, as commands (the single write path: the Music tool, the
 * palette, the assistant and a bound gesture all reach them alike): the key, the tap, the chart,
 * and clearing them. They write a per-device pref about the piece, never an instrument setting.
 */
import { z } from 'zod';
import { defineCommand, ok, err } from 'acture';
import { KEY_MODES } from '@thoremin/sdk/score/schema';
import { parseChart } from '@thoremin/sdk/context/from_user';
import { chartPlaceable, clearTaps, tap, writeEntry } from './user';

const CATEGORY = 'Music';
const NO_PIECE = 'Nothing is loaded to say it about: load a song in the Song tool, or a piece in the Conductor.';

export const setMusicKeyCmd = defineCommand({
  id: 'music.key.set',
  title: "Set the music's key",
  description: "Say what key the music playing is in (0 = C ... 11 = B, and its mode); the instrument's scale follows it when its scale comes from the music.",
  category: CATEGORY,
  params: z.object({ tonic: z.number().int().min(0).max(11).describe('The key note: 0 = C, 1 = C#/Db, ... 11 = B'), mode: z.enum(KEY_MODES).default('major').describe('major, minor, or a church mode') }),
  execute: async ({ tonic, mode }) => (writeEntry((e) => ({ ...e, key: { tonic, mode } })) ? ok({ tonic, mode }) : err('no_piece', NO_PIECE)),
});

export const clearMusicKeyCmd = defineCommand({
  id: 'music.key.clear',
  title: "Forget the music's key",
  description: 'Go back to the key the music itself states (a score), or none.',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => (writeEntry((e) => ({ ...e, key: null })) ? ok({ key: null }) : err('no_piece', NO_PIECE)),
});

export const tapTempoCmd = defineCommand({
  id: 'music.tempo.tap',
  title: 'Tap the tempo',
  description: 'Tap along with the music playing, from the first beat of a bar; after four taps the tempo and the bar line are set.',
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    const r = tap(performance.now() / 1000);
    if (r === 'no-song') return err('no_song', 'Play the song first: each tap is placed on its position.');
    return ok(r);
  },
});

export const clearTempoCmd = defineCommand({
  id: 'music.tempo.clear',
  title: 'Forget the tapped tempo',
  description: "Forget the tapped tempo; the chart then follows the song's own beat.",
  category: CATEGORY,
  params: z.object({}),
  execute: async () => {
    clearTaps({ tempo: true });
    return ok({ tempo: null });
  },
});

export const setChartCmd = defineCommand({
  id: 'music.chart.set',
  title: 'Set the chord chart',
  description: 'The chords of the music playing, bar by bar: "C | F G | Am | G7". Bar 1 is the tapped downbeat (or the song\'s first beat). An empty chart clears it.',
  category: CATEGORY,
  params: z.object({ chart: z.string().max(4000).describe('Bars separated by |, chords in a bar by spaces; % repeats a bar, N.C. is no chord') }),
  execute: async ({ chart }) => {
    const { errors } = parseChart(chart);
    if (errors.length) return err('bad_chart', `Not chords: ${errors.slice(0, 5).join(', ')}`);
    if (!writeEntry((e) => ({ ...e, chart }))) return err('no_piece', NO_PIECE);
    // Saved either way; `placed` false says it waits for a tempo (a song with no beat of its own).
    return ok({ bars: parseChart(chart).bars.length, placed: chartPlaceable() });
  },
});

export const MUSIC_COMMANDS = [setMusicKeyCmd, clearMusicKeyCmd, tapTempoCmd, clearTempoCmd, setChartCmd];
