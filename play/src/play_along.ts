/**
 * Play Along Lessons on a page of its own (`play/play-along.html`): notes travel to a hit line and
 * each clap, tap or note is judged perfect, great or good, early or late; rhythm lessons to clap and
 * a melody to sing or play. `@thoremin/games`' Play along session, with the player's measured offset.
 */
import { DIFFICULTIES, ONSET_WINDOWS, PITCH_TOLERANCE, type Difficulty } from '@thoremin/games/difficulty';
import { lessonsFor } from '@thoremin/games/lessons';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { createPlayAlongSession } from '@thoremin/games/play_along';
import { drawStage } from '@thoremin/games/stage';
import { offsetLine, readOffset } from './offset';
import { mountGamePage } from './page';
import { mountSpecBar } from './spec_bar';
import { rememberedSelect } from './remembered_select';
import { NOTE_VIEW_LABELS } from '@thoremin/games/note_view';
import { STAFF_MODE_LABELS } from '@thoremin/games/staff';
import { lessonFromSong, songFromLesson } from '@thoremin/games/spec';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lessonSel = $<HTMLSelectElement>('lesson');
const difficultySel = $<HTMLSelectElement>('difficulty');
const viewSel = $<HTMLSelectElement>('view');
const noteView = rememberedSelect(viewSel, NOTE_VIEW_LABELS, 'funfon.noteView');
const staffSel = $<HTMLSelectElement>('staff');
const staffMode = rememberedSelect(staffSel, STAFF_MODE_LABELS, 'funfon.staff');
const lessons = lessonsFor('play-along');
for (const l of lessons) lessonSel.add(new Option(l.title, l.id));
for (const d of DIFFICULTIES) difficultySel.add(new Option(d, d, d === 'normal', d === 'normal'));
$<HTMLElement>('timing').textContent = offsetLine(readOffset());
const shipped = () => lessons.find((l) => l.id === lessonSel.value) ?? lessons[0];
const spec = mountSpecBar({ game: 'play-along', host: document.querySelector('header')!, controls: { difficulty: difficultySel, lesson: lessonSel, view: viewSel, staff: staffSel }, songSelect: lessonSel, shippedSong: () => songFromLesson(shipped()) });

mountGamePage({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: GAMES_ANALYSERS,
  session: (start) => {
    const song = spec.song();
    const lesson = song ? lessonFromSong(song, 'play-along', spec.settings()) : shipped();
    const d = difficultySel.value as Difficulty;
    return createPlayAlongSession(lesson, { start, windows: ONSET_WINDOWS[d], toleranceCents: PITCH_TOLERANCE[d], offset: readOffset()?.offset ?? 0 });
  },
  draw: (g, W, H, view) => {
    if (view) drawStage(g, { W, H, notes: noteView(), staff: staffMode() }, view);
  },
  over: (view) => view.phase === 'results',
});
