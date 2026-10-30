/**
 * Match the Note on a page of its own (`play/match-the-note.html`): a note is played, the player
 * finds it with the voice or any instrument and holds it in tune. No camera, no graph, no React,
 * no app shell: the game session and its stage (`@thoremin/games`), the microphone's pitch on the
 * audio thread (the browser hub, through `./page`) and a few DOM controls. The bundle check
 * (`scripts/check_play_bundle.ts`) keeps it that way.
 */
import { mountAdjust } from './adjust';
import { createMatchSession, MATCH_HOLD_S } from '@thoremin/games/match';
import { lessonsFor } from '@thoremin/games/lessons';
import { DIFFICULTIES, MATCH_TOLERANCE, type Difficulty } from '@thoremin/games/difficulty';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { drawStage } from '@thoremin/games/stage';
import { mountGamePage } from './page';
import { mountSpecBar } from './spec_bar';
import { lessonFromSong, songFromLesson } from '@thoremin/games/spec';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lessonSel = $<HTMLSelectElement>('lesson');
const difficultySel = $<HTMLSelectElement>('difficulty');

for (const l of lessonsFor('match')) lessonSel.add(new Option(l.title, l.id));
for (const d of DIFFICULTIES) difficultySel.add(new Option(`${d} (within ${MATCH_TOLERANCE[d]} cents)`, d, d === 'normal', d === 'normal'));
const shipped = () => lessonsFor('match').find((l) => l.id === lessonSel.value) ?? lessonsFor('match')[0];
const adjust = mountAdjust({
  game: 'match-the-note',
  host: document.querySelector('header')!,
  knobs: [
    { key: 'tolerance', label: 'In tune within', value: MATCH_TOLERANCE[difficultySel.value as Difficulty] },
    { key: 'holdS', label: 'Hold for', value: MATCH_HOLD_S },
  ],
  // Read at Start: a note's hold is timed from where it was found.
  onChange: () => {},
});
difficultySel.addEventListener('change', () => adjust.setDefault('tolerance', MATCH_TOLERANCE[difficultySel.value as Difficulty]));

const spec = mountSpecBar({ game: 'match-the-note', host: document.querySelector('header')!, controls: { difficulty: difficultySel, lesson: lessonSel, ...adjust.inputs }, songSelect: lessonSel, shippedSong: () => songFromLesson(shipped()) });

mountGamePage({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: GAMES_ANALYSERS,
  session: (start) => {
    const song = spec.song();
    const lesson = song ? lessonFromSong(song, 'match-the-note', spec.settings()) : shipped();
    const v = adjust.values();
    return createMatchSession(lesson, { start, toleranceCents: v.tolerance ?? MATCH_TOLERANCE[difficultySel.value as Difficulty], ...(v.holdS ? { holdS: v.holdS } : {}) });
  },
  draw: (g, W, H, view) => {
    if (view) drawStage(g, { W, H }, view);
  },
  // The results are in: the microphone goes off, the card stays.
  over: (view) => view.phase === 'results',
});
