/**
 * Game specs (`@thoremin/games/spec`): a song as each game's notes, what a game refuses, the schema
 * on an imported file, and a spec through the funfon formats (`play/src/formats.ts`: formatcast with
 * the music and game packs) as JSON, YAML and TOML and back, a song file read as a song.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { echoLevelFromSong, gameSpec, lessonFromSong, popCourseFromSong, songFromLesson, songProblem } from '@thoremin/games/spec';
import { parseGameSpec } from '@thoremin/games/spec_schema';
import { createEchoSession, stackRounds, barsOf } from '@thoremin/games/echo';
import { lessonById } from '@thoremin/games/lessons';
import { songFromText } from '@thoremin/sdk/score/song';
import { readFile, writeFile } from '../../play/src/formats';

const TUNE = songFromText('bpm=96 bar=3 C4 D4 E4 C4 E4:2 -', 'Waltz');
const RHYTHM = songFromText('bar=4 x x x:0.5 x:0.5 x  x:2 x x', 'Beat');

describe('a song as each game', () => {
  it('a lesson for the lesson games: its tempo, a bar of count-in, none for Match the Note', () => {
    const sing = lessonFromSong(TUNE, 'sing-along');
    expect(sing).toMatchObject({ title: 'Waltz', game: 'sing', bpm: 96, countIn: 3 });
    expect(sing.notes).toEqual(TUNE.notes);
    expect(lessonFromSong(TUNE, 'match-the-note').countIn).toBe(0);
    expect(lessonFromSong(TUNE, 'pitch-maze', { bpm: 60 }).bpm).toBe(60);
  });

  it('an Echo level: its bar and the spec\'s stacking', () => {
    const level = echoLevelFromSong(RHYTHM, { stack: 'grow' });
    expect(level.beatsPerBar).toBe(4);
    expect(barsOf(level)).toBe(2);
    expect(stackRounds(barsOf(level), 1, level.stack)).toHaveLength(3);
    expect(createEchoSession(level, { start: 0 }).rounds).toHaveLength(3);
  });

  it('Pop the Notes balloons on the song\'s pitch classes, in order', () => {
    const course = popCourseFromSong(TUNE, { rMin: 0.05, rMax: 0.1, seed: 2 });
    expect(course.map((b) => Math.round(b.x * 12 - 0.5))).toEqual([0, 2, 4, 0, 4]);
  });

  it('a game that needs pitches refuses a rhythm, and says why', () => {
    expect(songProblem('pitch-maze', RHYTHM)).toMatch(/needs a melody/);
    expect(songProblem('echo', RHYTHM)).toBeNull();
    expect(songProblem('echo', TUNE)).toBeNull();
    expect(songProblem('vowels', TUNE)).toMatch(/no songs/);
  });
});

describe('a spec from outside', () => {
  it('names what is wrong with a file that is not one', () => {
    expect(() => parseGameSpec({ kind: 'funfon-game', version: 1, game: 'tetris', settings: {} })).toThrow(/Not a funfon game: game/);
    expect(() => parseGameSpec({ kind: 'funfon-game', version: 1, game: 'echo', settings: { stack: 'sideways' } })).toThrow(/settings.stack/);
    expect(() => parseGameSpec({ kind: 'funfon-game', version: 1, game: 'echo', settings: { tempo: 3 } })).toThrow(/Unrecognized key/);
    expect(parseGameSpec({ kind: 'funfon-game', version: 1, game: 'vowels' }).settings).toEqual({});
  });

  it('round-trips through JSON, YAML and TOML files, song included', async () => {
    const spec = gameSpec('echo', { difficulty: 'hard', stack: 'grow', passAt: 0.8, clickWhileAnswering: true }, RHYTHM, 'My beat');
    for (const format of ['json', 'yaml', 'toml']) {
      const file = await writeFile(spec, 'game', format, 'My beat (echo)');
      expect(file.name).toBe(`My-beat-echo.${format}`);
      const read = await readFile(file);
      expect('spec' in read && read.spec, format).toEqual(spec);
    }
  });

  it('a shipped lesson saved as a song and opened again; a MIDI file opened as a song', async () => {
    const song = songFromLesson(lessonById('sing-ode')!, 4);
    for (const format of ['midi', 'notes', 'json', 'yaml']) {
      const read = await readFile(await writeFile(song, 'song', format, 'Ode to Joy'));
      expect('song' in read && read.song.notes, format).toEqual(song.notes);
    }
    const midi = await readFile(new File([readFileSync('public/scores/beethoven-symphony-5-1.mid')], 'symphony.mid'));
    expect('song' in midi && midi.song.notes.length).toBeGreaterThan(50);
  });
});
