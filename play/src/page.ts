/**
 * What every standalone game page does around its game: one AudioContext made on the first click,
 * the microphone through the browser hub (`src/audio/browser.ts`) with the analysers the game
 * reads, the runner (`./runner`) ticking the session every animation frame, the cues played by the
 * small synth, the canvas kept at the device's pixel ratio, and the Start / Stop / Again button.
 * A page says only which session to make, how to draw its view, and when it is over.
 */
import type { AudioInputLease } from '@thoremin/sdk-ui/audio/hub';
import type { AnalyserSpec } from '@thoremin/sdk/audio/analysers';
import { createBrowserAudioInput } from '@/audio/browser';
import { playCue } from './cue_synth';
import { createRunner, type Session } from './runner';

export interface GamePageOptions<V extends { notice?: string }> {
  canvas: HTMLCanvasElement;
  startButton: HTMLButtonElement;
  /** The analysers the game reads (its lease on the hub). */
  analysers: readonly AnalyserSpec[];
  /** A new session starting at `start` (context seconds). */
  session(start: number, ctx: AudioContext): Session<V>;
  /** Draw a view (or the page's idle picture when `view` is null) at CSS size W x H. */
  draw(g: CanvasRenderingContext2D, W: number, H: number, view: V | null): void;
  /** The game is over: the microphone goes off, the last view stays. */
  over(view: V): boolean;
  /** Seconds between Start and the game's start (the context resumes, the microphone opens). */
  leadS?: number;
}

export interface GamePage<V> {
  /** The last view drawn. */
  view(): V | null;
  mic(): string;
  /** The page's AudioContext, once Start made it. */
  audio(): AudioContext | undefined;
  stop(label?: string): void;
}

export function mountGamePage<V extends { notice?: string }>(o: GamePageOptions<V>): GamePage<V> {
  let ctx: AudioContext | undefined;
  const hub = createBrowserAudioInput({ audio: () => ctx });
  let lease: AudioInputLease | null = null;
  let runner: ReturnType<typeof createRunner<V>> | null = null;
  let last: V | null = null;

  function stop(label = 'Start'): void {
    lease?.release();
    lease = null;
    runner = null;
    o.startButton.textContent = label;
  }

  async function start(): Promise<void> {
    ctx ??= new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    hub.poke();
    lease?.release();
    lease = hub.acquire({ analysers: [...o.analysers] });
    const audio = ctx;
    const own = lease;
    runner = createRunner<V>(o.session(audio.currentTime + (o.leadS ?? 0.8), audio), {
      drain: () => own.drain(),
      now: () => audio.currentTime,
      sampleRate: () => audio.sampleRate,
      inputStage: () => hub.inputStage(),
      micState: () => hub.status().state,
      play: (cue) => playCue(audio, audio.destination, cue),
    });
    o.startButton.textContent = 'Stop';
  }

  o.startButton.addEventListener('click', () => {
    if (runner) stop();
    else void start();
  });

  function frame(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = o.canvas.clientWidth;
    const H = o.canvas.clientHeight;
    if (o.canvas.width !== Math.round(W * dpr) || o.canvas.height !== Math.round(H * dpr)) {
      o.canvas.width = Math.round(W * dpr);
      o.canvas.height = Math.round(H * dpr);
    }
    const g = o.canvas.getContext('2d');
    last = runner?.tick() ?? last;
    if (g) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.draw(g, W, H, last);
    }
    if (runner && last && o.over(last)) stop('Again');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const page: GamePage<V> = { view: () => last, mic: () => hub.status().state, audio: () => ctx, stop };
  /** What the browser smoke reads (`smoke/tests/play_pages.smoke.ts`). */
  (window as unknown as { thoreminPlay: unknown }).thoreminPlay = page;
  return page;
}
