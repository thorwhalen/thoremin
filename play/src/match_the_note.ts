/**
 * Match the Note on a page of its own (`play/match-the-note.html`): a note is played, the player
 * finds it with the voice or any instrument and holds it in tune. No camera, no graph, no React,
 * no app shell: the game session and its stage (`@thoremin/games`), the microphone's pitch on the
 * audio thread (the browser hub, `src/audio/browser.ts`) and a few DOM controls. The bundle check
 * (`scripts/check_play_bundle.ts`) keeps it that way.
 */
import { createMatchSession } from '@thoremin/games/match';
import { lessonsFor } from '@thoremin/games/lessons';
import { DIFFICULTIES, MATCH_TOLERANCE, type Difficulty } from '@thoremin/games/difficulty';
import { GAMES_ANALYSERS } from '@thoremin/games/listen';
import { drawStage } from '@thoremin/games/stage';
import type { AudioInputLease } from '@thoremin/sdk-ui/audio/hub';
import type { GameView } from '@thoremin/games/view';
import { createBrowserAudioInput } from '@/audio/browser';
import { playCue } from './cue_synth';
import { createRunner } from './runner';

/** Seconds between Start and the first reference note (the context resumes, the microphone opens). */
const LEAD_S = 0.8;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('stage');
const lessonSel = $<HTMLSelectElement>('lesson');
const difficultySel = $<HTMLSelectElement>('difficulty');
const startBtn = $<HTMLButtonElement>('start');

for (const l of lessonsFor('match')) lessonSel.add(new Option(l.title, l.id));
for (const d of DIFFICULTIES) difficultySel.add(new Option(`${d} (within ${MATCH_TOLERANCE[d]} cents)`, d, d === 'normal', d === 'normal'));

let ctx: AudioContext | undefined;
const hub = createBrowserAudioInput({ audio: () => ctx });
let lease: AudioInputLease | null = null;
let runner: ReturnType<typeof createRunner> | null = null;
/** The last view drawn: it stays on the stage after Stop or the results. */
let last: GameView | null = null;

function stop(label = 'Start'): void {
  lease?.release();
  lease = null;
  runner = null;
  startBtn.textContent = label;
}

async function start(): Promise<void> {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  hub.poke();
  lease?.release();
  lease = hub.acquire({ analysers: GAMES_ANALYSERS });
  const audio = ctx;
  const own = lease;
  const lesson = lessonsFor('match').find((l) => l.id === lessonSel.value) ?? lessonsFor('match')[0];
  const session = createMatchSession(lesson, { start: audio.currentTime + LEAD_S, toleranceCents: MATCH_TOLERANCE[difficultySel.value as Difficulty] });
  runner = createRunner(session, {
    drain: () => own.drain(),
    now: () => audio.currentTime,
    sampleRate: () => audio.sampleRate,
    inputStage: () => hub.inputStage(),
    micState: () => hub.status().state,
    play: (cue) => playCue(audio, audio.destination, cue),
  });
  startBtn.textContent = 'Stop';
}

startBtn.addEventListener('click', () => {
  if (runner) stop();
  else void start();
});

function frame(): void {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d');
  last = runner?.tick() ?? last;
  if (g && last) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStage(g, { W, H }, last);
  }
  // The results are in: the microphone goes off, the card stays.
  if (runner && last?.phase === 'results') stop('Again');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** What the browser smoke reads (`smoke/tests/play_pages.smoke.ts`). */
(window as unknown as { thoreminPlay: unknown }).thoreminPlay = { view: () => last, mic: () => hub.status().state };
