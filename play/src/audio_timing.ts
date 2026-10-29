/**
 * Audio timing on a page of its own (`play/audio-timing.html`): clicks, the player taps or claps on
 * each, and the microphone's onsets against the clicks give this device's offset (`@thoremin/games`'
 * calibration take, judged by `estimateOffset`). An accepted take is kept in this browser
 * (`./offset`) for the timed games; a refused one says why and keeps the old value.
 */
import { createCalibrationSession } from '@thoremin/games/calibrate';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { drawStage } from '@thoremin/games/stage';
import { offsetLine, readOffset, writeOffset } from './offset';
import { mountGamePage } from './page';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $<HTMLElement>('timing');
status.textContent = offsetLine(readOffset());

let take: ReturnType<typeof createCalibrationSession> | null = null;
let kept = false;

mountGamePage({
  canvas: $<HTMLCanvasElement>('stage'),
  startButton: $<HTMLButtonElement>('start'),
  analysers: GAMES_ANALYSERS,
  session: (start) => {
    take = createCalibrationSession({ start });
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
      if (!r.refusal) {
        writeOffset({ offset: r.offset, spread: r.spread, at: new Date().toISOString() });
        status.textContent = `Kept. ${offsetLine(readOffset())}`;
      } else status.textContent = `Not kept (${r.refusal}). ${offsetLine(readOffset())}`;
    }
    return true;
  },
});
