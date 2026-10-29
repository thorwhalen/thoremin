/**
 * The Pitch Maze on a page of its own (`play/pitch-maze.html`): a ball travels by itself along a
 * tune's notes, moved across by the voice's pitch class. The first levels are walls whose openings
 * are the notes (held to get through: forgiving); the higher ones are the road, the tune as a piano
 * roll running to the horizon, its lanes narrower level by level, scored while the voice is on the
 * note and lost at zero points. The session is `@thoremin/games`' track over its pitch cursor; the
 * tunes are the Sing lessons.
 */
import { createPitchCursor, pitchColumns } from '@thoremin/games/cursor';
import { lessonsFor } from '@thoremin/games/lessons';
import { PITCH_ANALYSERS } from '@thoremin/games/listen';
import { createTrackSession, trackFor, TRACK_LEVELS } from '@thoremin/games/maze';
import { drawFieldOrIdle } from './field_page';
import { mountGamePage } from './page';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lessonSel = $<HTMLSelectElement>('lesson');
const levelSel = $<HTMLSelectElement>('level');
const tunes = lessonsFor('sing');
for (const l of tunes) lessonSel.add(new Option(l.title, l.id));
TRACK_LEVELS.forEach((l, i) => levelSel.add(new Option(`${i + 1}. ${l.name}`, l.id, i === 1, i === 1)));

const backdrop = { columns: pitchColumns() };
const idle = { game: 'maze' as const, title: 'Pitch Maze', backdrop, wrapX: true, hint: 'Press Start, then sing the notes.' };

mountGamePage({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: PITCH_ANALYSERS,
  session: (start) => {
    const tune = tunes.find((l) => l.id === lessonSel.value) ?? tunes[0];
    const level = TRACK_LEVELS.find((l) => l.id === levelSel.value) ?? TRACK_LEVELS[1];
    const notes = tune.notes.flatMap((n) => (n.midi === undefined ? [] : [{ midi: n.midi, beats: n.beats }]));
    const track = trackFor(notes, tune.bpm, level);
    return createTrackSession({
      title: tune.title,
      start,
      ...track,
      cursor: createPitchCursor(),
      backdrop,
      hint: level.kind === 'wall' ? 'Hold the note of the opening until the ball is through.' : 'Stay on the lit lane: points while on it, lost while off.',
    });
  },
  draw: (g, W, H, view) => drawFieldOrIdle(g, W, H, view, idle),
  over: (view) => view.phase === 'results',
});
