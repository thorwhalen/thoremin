/**
 * Audio timing on a page of its own (`play/audio-timing.html`): clicks, the microphone's onsets
 * against them (`@thoremin/games`' calibration take, judged by `estimateOffset`), in one of two
 * modes the player picks. Tap along (the player taps on each click) gives the player's offset,
 * kept in this browser (`./offset`) for the timed games; Loopback (speaker on, no player, #881)
 * gives this device's input stage, kept in the per-device record the camera app shares and that
 * every listening page converts its heard times with. A refused take says why and keeps the old
 * value (`./timing_take`).
 */
import { createCalibrationSession, type CalibrationMode } from '@thoremin/games/calibrate';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { drawStage } from '@thoremin/games/stage';
import type { GameView } from '@thoremin/games/view';
import { reportedOutputStage } from '@thoremin/sdk/timing/output_stage';
import { inputStageRecordNow, inputStageStore, setInputStage } from '@thoremin/sdk-ui/audio/inputStage';
import { offsetLine, readOffset, writeOffset } from './offset';
import { mountGamePage, type GamePage } from './page';
import { rememberedSelect } from './remembered_select';
import { RAW_MICROPHONE, TAKE_MODE_HINTS, TAKE_MODE_LABELS, inputStageLine, keepTake } from './timing_take';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLElement>('timing');
const stageLine = $<HTMLElement>('stage-line');
const hint = $<HTMLElement>('mode-hint');
const modeSel = $<HTMLSelectElement>('mode');
const mode = rememberedSelect(modeSel, TAKE_MODE_LABELS, 'funfon.timingMode');
const showHint = () => (hint.textContent = TAKE_MODE_HINTS[mode()]);
modeSel.addEventListener('change', showHint);
showHint();
status.textContent = offsetLine(readOffset());

let take: ReturnType<typeof createCalibrationSession> | null = null;
let takeMode: CalibrationMode = 'tap';
let kept = false;

// Typed ahead: the loopback take reads the page's own input stage, so the page appears in its own options.
const page: GamePage<GameView> = mountGamePage<GameView>({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: GAMES_ANALYSERS,
  constraints: RAW_MICROPHONE,
  session: (start, ctx) => {
    takeMode = mode();
    take =
      takeMode === 'loopback'
        ? createCalibrationSession({ start, mode: 'loopback', stages: { inputStage: () => page.inputStage(), outputStage: () => reportedOutputStage(ctx, performance.now()) } })
        : createCalibrationSession({ start });
    kept = false;
    return take;
  },
  draw: (g, W, H, view) => {
    if (view) drawStage(g, { W, H }, view);
  },
  over: (view) => {
    if (view.phase !== 'results') return false;
    const r = take?.result();
    if (r && !kept) {
      kept = true;
      const refusal = keepTake(takeMode, r, { writeOffset, setInputStage, inputStage: () => page.inputStage(), now: () => new Date() });
      const verdict = refusal ? `Not kept (${refusal}).` : 'Kept.';
      if (takeMode === 'tap') status.textContent = `${verdict} ${offsetLine(readOffset())}`;
      else stageLine.textContent = `${verdict} ${inputStageLine(page.inputStage(), inputStageRecordNow())}`;
    }
    return true;
  },
});

const showStage = () => (stageLine.textContent = inputStageLine(page.inputStage(), inputStageRecordNow()));
// The stored record hydrates after mount: say the stage once it is read, and whenever it changes.
inputStageStore().subscribe(showStage);
showStage();
