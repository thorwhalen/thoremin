/**
 * Match the Note on a page of its own (`play/match-the-note.html`): a note is played, the player
 * finds it with the voice or any instrument and holds it in tune. No camera, no graph, no React,
 * no app shell: the game session and its stage (`@thoremin/games`), the microphone's pitch on the
 * audio thread (the browser hub, through `./page`) and a few DOM controls. The bundle check
 * (`scripts/check_play_bundle.ts`) keeps it that way.
 */
import { createMatchSession } from '@thoremin/games/match';
import { lessonsFor } from '@thoremin/games/lessons';
import { DIFFICULTIES, MATCH_TOLERANCE, type Difficulty } from '@thoremin/games/difficulty';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { drawStage } from '@thoremin/games/stage';
import { mountGamePage } from './page';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lessonSel = $<HTMLSelectElement>('lesson');
const difficultySel = $<HTMLSelectElement>('difficulty');

for (const l of lessonsFor('match')) lessonSel.add(new Option(l.title, l.id));
for (const d of DIFFICULTIES) difficultySel.add(new Option(`${d} (within ${MATCH_TOLERANCE[d]} cents)`, d, d === 'normal', d === 'normal'));

mountGamePage({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: GAMES_ANALYSERS,
  session: (start) => {
    const lesson = lessonsFor('match').find((l) => l.id === lessonSel.value) ?? lessonsFor('match')[0];
    return createMatchSession(lesson, { start, toleranceCents: MATCH_TOLERANCE[difficultySel.value as Difficulty] });
  },
  draw: (g, W, H, view) => {
    if (view) drawStage(g, { W, H }, view);
  },
  // The results are in: the microphone goes off, the card stays.
  over: (view) => view.phase === 'results',
});
