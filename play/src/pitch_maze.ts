/**
 * The Pitch Maze on a page of its own (`play/pitch-maze.html`): a ball climbs by itself through
 * walls whose openings are a tune's notes, moved across by the voice's pitch class; it gets through
 * a wall only while the opening's note is held. The session is `@thoremin/games`' maze over its
 * pitch cursor; the tunes are the Sing lessons.
 */
import { createPitchCursor, pitchColumns } from '@thoremin/games/cursor';
import { DIFFICULTIES, type Difficulty } from '@thoremin/games/difficulty';
import { lessonsFor } from '@thoremin/games/lessons';
import { PITCH_ANALYSERS } from '@thoremin/games/listen';
import { createMazeSession, MAZE_LEVELS } from '@thoremin/games/maze';
import { drawFieldOrIdle } from './field_page';
import { mountGamePage } from './page';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lessonSel = $<HTMLSelectElement>('lesson');
const difficultySel = $<HTMLSelectElement>('difficulty');
const tunes = lessonsFor('sing');
for (const l of tunes) lessonSel.add(new Option(l.title, l.id));
for (const d of DIFFICULTIES) difficultySel.add(new Option(`${d} (opening ${MAZE_LEVELS[d].gapSemitones} semitones)`, d, d === 'normal', d === 'normal'));

const backdrop = { columns: pitchColumns() };
const idle = { game: 'maze' as const, title: 'Pitch Maze', backdrop, wrapX: true, hint: 'Press Start, then sing the note of each opening.' };

mountGamePage({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: PITCH_ANALYSERS,
  session: (start) => {
    const tune = tunes.find((l) => l.id === lessonSel.value) ?? tunes[0];
    return createMazeSession({
      title: tune.title,
      start,
      notes: tune.notes.flatMap((n) => (n.midi === undefined ? [] : [n.midi])),
      cursor: createPitchCursor(),
      backdrop,
      ...MAZE_LEVELS[difficultySel.value as Difficulty],
      hint: 'Hold the note of the opening until the ball is through.',
    });
  },
  draw: (g, W, H, view) => drawFieldOrIdle(g, W, H, view, idle),
  over: (view) => view.phase === 'results',
});
