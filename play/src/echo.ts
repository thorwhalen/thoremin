/**
 * Echo the Rhythm on a page of its own (`play/echo.html`): a bar of rhythm plays over a quiet
 * metronome, a count of 1-2-3-4, and the player claps it back; each bar alone, then stacked.
 * `@thoremin/games`' Echo session, its stage, the onset analyser and the player's measured offset.
 */
import { DIFFICULTIES, ONSET_WINDOWS, type Difficulty } from '@thoremin/games/difficulty';
import { createEchoSession, ECHO_LEVELS, type EchoView } from '@thoremin/games/echo';
import { drawEcho } from '@thoremin/games/echo_stage';
import { ONSET_ANALYSERS } from '@thoremin/games/listen';
import { BG, DIM, text } from '@thoremin/games/stage';
import { offsetLine, readOffset } from './offset';
import { mountGamePage } from './page';
import { mountSpecBar } from './spec_bar';
import { echoLevelFromSong } from '@thoremin/games/spec';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const levelSel = $<HTMLSelectElement>('level');
const difficultySel = $<HTMLSelectElement>('difficulty');
const clickAnswer = $<HTMLInputElement>('click-answer');
for (const l of ECHO_LEVELS) levelSel.add(new Option(l.title, l.id));
for (const d of DIFFICULTIES) difficultySel.add(new Option(d, d, d === 'normal', d === 'normal'));
$<HTMLElement>('timing').textContent = offsetLine(readOffset());
const shipped = () => ECHO_LEVELS.find((l) => l.id === levelSel.value) ?? ECHO_LEVELS[0];
const spec = mountSpecBar({
  game: 'echo',
  host: document.querySelector('header')!,
  controls: { difficulty: difficultySel, lesson: levelSel, clickWhileAnswering: clickAnswer },
  songSelect: levelSel,
  shippedSong: () => ({ title: shipped().title, bpm: shipped().bpm, beatsPerBar: shipped().beatsPerBar, notes: shipped().notes }),
});

mountGamePage<EchoView>({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: ONSET_ANALYSERS,
  session: (start) => {
    // An opened song is the rhythm; a spec's settings (tempo, stacking, pass mark) apply to either.
    const s = spec.settings();
    const song = spec.song();
    const level = song ? echoLevelFromSong(song, s) : { ...shipped(), ...(s.bpm ? { bpm: s.bpm } : {}), ...(s.stack ? { stack: s.stack } : {}), ...(s.barsPerPiece ? { barsPerPiece: s.barsPerPiece } : {}) };
    return createEchoSession(level, {
      start,
      windows: ONSET_WINDOWS[difficultySel.value as Difficulty],
      offset: readOffset()?.offset ?? 0,
      clickWhileAnswering: clickAnswer.checked,
      ...(s.passAt !== undefined ? { passAt: s.passAt } : {}),
      ...(s.retries !== undefined ? { retries: s.retries } : {}),
    });
  },
  draw: (g, W, H, view) => {
    if (view) drawEcho(g, W, H, view);
    else {
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      text(g, 'Press Start, listen, then clap it back.', W / 2, H / 2, 18, DIM, 'center');
    }
  },
  over: (view) => view.phase === 'results',
});
