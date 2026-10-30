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
import { SMOOTHING_DEFAULT } from '@thoremin/games/tuning';
import { drawFieldOrIdle, planeAspect, skipButton, targetAt } from './field_page';
import { mountAdjust } from './adjust';
import { mountGamePage } from './page';
import { mountSpecBar } from './spec_bar';
import { popCourseFromSong } from '@thoremin/games/spec';

const BALLOONS = 8;
const LOUDNESS_LABELS: Record<LoudnessMode, string> = { auto: 'Loudness: learns your range', soft: 'Loudness: soft voice', normal: 'Loudness: normal voice', loud: 'Loudness: loud voice' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const difficultySel = $<HTMLSelectElement>('difficulty');
const loudnessSel = $<HTMLSelectElement>('loudness');
for (const d of DIFFICULTIES) difficultySel.add(new Option(d, d, d === 'normal', d === 'normal'));
for (const m of LOUDNESS_MODES) loudnessSel.add(new Option(LOUDNESS_LABELS[m], m));

let round: ReturnType<typeof createPopSession> | null = null;
let cursor: ReturnType<typeof createPitchCursor> | null = null;
const header = document.querySelector('header')!;
const level = () => POP_LEVELS[difficultySel.value as Difficulty];
const adjust = mountAdjust({
  game: 'pop-the-notes',
  host: header,
  knobs: [
    { key: 'size', label: 'Balloon size', value: 1 },
    { key: 'holdS', label: 'Hold to pop', value: level().holdS },
    { key: 'smoothing', label: 'Smoothing', value: SMOOTHING_DEFAULT },
  ],
  onChange: (v) => {
    round?.tune({ sizeScale: v.size, holdS: v.holdS });
    cursor?.tune?.({ smoothing: v.smoothing });
  },
});
difficultySel.addEventListener('change', () => adjust.setDefault('holdS', level().holdS));
const spec = mountSpecBar({ game: 'pop-the-notes', host: header, controls: { difficulty: difficultySel, ...adjust.inputs } });

const backdrop = { columns: pitchColumns(), yLabel: 'louder' };
const idle = { game: 'pop' as const, title: 'Pop the Notes', backdrop, wrapX: true, hint: 'Press Start, then sing.' };

const page = mountGamePage({
  canvas,
  startButton: $<HTMLButtonElement>('start'),
  analysers: PITCH_ANALYSERS,
  session: (start) => {
    const lv = level();
    const v = adjust.values();
    cursor = createPitchCursor({ loudness: createLoudnessScale({ mode: loudnessSel.value as LoudnessMode }), smoothing: v.smoothing });
    return (round = createPopSession({
      title: 'Pop the Notes',
      start,
      // An opened song's notes are the balloons, in its order; else a random course.
      targets: spec.song() ? popCourseFromSong(spec.song()!, { rMin: lv.rMin, rMax: lv.rMax, seed: Date.now() }) : pitchLoudnessCourse({ count: spec.settings().count ?? BALLOONS, rMin: lv.rMin, rMax: lv.rMax, seed: Date.now() }),
      cursor,
      backdrop,
      wrapX: true,
      aspect: planeAspect(canvas),
      holdS: v.holdS ?? lv.holdS,
      sizeScale: v.size,
      hint: 'Sing louder to go up, softer to go down. Too hard? Tap the balloon, or Skip.',
    }));
  },
  draw: (g, W, H, view) => drawFieldOrIdle(g, W, H, view, idle),
  over: (view) => view.phase === 'results',
});

skipButton($<HTMLButtonElement>('start'), () => round?.skip());
// A tap on a balloon skips that one.
canvas.addEventListener('pointerdown', (e) => {
  const t = targetAt(canvas, page.view(), e);
  if (t) round?.skip(t.id);
});
