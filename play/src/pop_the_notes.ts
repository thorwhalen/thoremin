/**
 * Pop the Notes on a page of its own (`play/pop-the-notes.html`): the voice is a dot, its pitch
 * class across (one octave that wraps) and its loudness up, on the player's own range or a fixed
 * one; holding it on a balloon bursts it. The session is `@thoremin/games`' pop over its pitch
 * cursor; the page only picks the course and the loudness range.
 */
import { createPitchCursor, pitchColumns } from '@thoremin/games/cursor';
import { DIFFICULTIES, type Difficulty } from '@thoremin/games/difficulty';
import { PITCH_ANALYSERS } from '@thoremin/games/listen';
import { createLoudnessScale, LOUDNESS_MODES, type LoudnessMode } from '@thoremin/games/loudness';
import { createPopSession, pitchLoudnessCourse, POP_LEVELS } from '@thoremin/games/pop';
import { drawFieldOrIdle, planeAspect } from './field_page';
import { mountGamePage } from './page';

const BALLOONS = 8;
const LOUDNESS_LABELS: Record<LoudnessMode, string> = { auto: 'Loudness: learns your range', soft: 'Loudness: soft voice', normal: 'Loudness: normal voice', loud: 'Loudness: loud voice' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const difficultySel = $<HTMLSelectElement>('difficulty');
const loudnessSel = $<HTMLSelectElement>('loudness');
for (const d of DIFFICULTIES) difficultySel.add(new Option(d, d, d === 'normal', d === 'normal'));
for (const m of LOUDNESS_MODES) loudnessSel.add(new Option(LOUDNESS_LABELS[m], m));

const backdrop = { columns: pitchColumns(), yLabel: 'louder' };
const idle = { game: 'pop' as const, title: 'Pop the Notes', backdrop, wrapX: true, hint: 'Press Start, then sing.' };

mountGamePage({
  canvas,
  startButton: $<HTMLButtonElement>('start'),
  analysers: PITCH_ANALYSERS,
  session: (start) => {
    const level = POP_LEVELS[difficultySel.value as Difficulty];
    return createPopSession({
      title: 'Pop the Notes',
      start,
      targets: pitchLoudnessCourse({ count: BALLOONS, rMin: level.rMin, rMax: level.rMax, seed: Date.now() }),
      cursor: createPitchCursor({ loudness: createLoudnessScale({ mode: loudnessSel.value as LoudnessMode }) }),
      backdrop,
      wrapX: true,
      aspect: planeAspect(canvas),
      holdS: level.holdS,
      hint: 'Sing louder to go up, softer to go down.',
    });
  },
  draw: (g, W, H, view) => drawFieldOrIdle(g, W, H, view, idle),
  over: (view) => view.phase === 'results',
});
