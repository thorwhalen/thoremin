/**
 * The voice sink (#163 §4) — the spoken channel, as a {@link GuidanceSink}.
 *
 * Plays the cached clip for each line the runner says. Cached audio only: the clip
 * set is generated offline (`scripts/gen_cue_voice.py`, via braidio) and shipped in
 * `public/voice/`; a line with no clip is simply not spoken — the written channel
 * always shows it, so nothing is lost.
 *
 * ## Queueing
 *
 * Lines arrive faster than they can be spoken, and a line that is still waiting when
 * the situation changes is stale. So: one clip at a time, in order; ANY new line drops
 * every nudge still waiting (a newer nudge supersedes an older one — the runner only
 * re-says when the situation changed — and an instruction or an end phrase ends the
 * situation the nudge was about), and a new instruction drops an earlier, still-unspoken
 * instruction. At most one nudge ever waits, so the spoken channel lags the written one
 * by at most the clip in flight. The written channel is never delayed by any of this.
 *
 * ## Cancelling
 *
 * Turning voice off, or stopping the routine, must SILENCE the clip in flight, not
 * just the queue — so the player takes an `AbortSignal`, and the sink owns one
 * controller per clip: a cancelled clip's settling is ignored (it cannot re-trigger the
 * pump or wedge `playing`), and a clip that never fires `ended` cannot wedge the sink
 * for the page's lifetime because the next cancel aborts it.
 *
 * ## Autoplay
 *
 * Browsers refuse audio that was not preceded by a user gesture, and WebKit applies
 * that per element. The default player therefore reuses ONE `HTMLAudioElement` and
 * exposes `unlock()`, which the voice toggle calls inside its click: the element is
 * loaded under the gesture once and plays freely from timers and microtasks after.
 * When play still fails, the failure is swallowed (the sink contract: never throw,
 * never block) and the text channel carries on.
 */
import type { GuidanceSink } from './guidance';
import type { TranscriptLine } from './store';
import { clipFor, type VoiceManifest } from './speakable';

/** Something that plays one URL to completion; `signal` aborts it early. Injectable
 *  (tests; a Web Audio player). Must settle — resolve or reject — eventually. */
export type ClipPlayer = (url: string, signal: AbortSignal) => Promise<void>;

export interface VoiceSinkOptions {
  manifest: VoiceManifest;
  /** URL prefix the manifest's file names are relative to (`.../voice/`). */
  baseUrl: string;
  /** Defaults to a reusable-`Audio`-element player ({@link createAudioElementPlayer}). */
  player?: ClipPlayer;
  /** Starts enabled? Default false (voice is a toggle; text is not). */
  enabled?: boolean;
}

export interface VoiceSink extends GuidanceSink {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** Silence the clip in flight and drop everything waiting (Stop, the panel closing). */
  hush(): void;
  /** Lines waiting to be spoken (for tests / a meter). */
  pending(): number;
  /** True while a clip is in flight. */
  isPlaying(): boolean;
}

export interface AudioElementPlayer {
  play: ClipPlayer;
  /** Load the element inside a user gesture so later plays are allowed. Idempotent. */
  unlock(): void;
}

/** The default player: one reusable `Audio` element, unlockable under a gesture. */
export function createAudioElementPlayer(): AudioElementPlayer {
  let el: HTMLAudioElement | null = null;
  const element = (): HTMLAudioElement | null => {
    if (typeof Audio === 'undefined') return null;
    if (!el) el = new Audio();
    return el;
  };
  return {
    unlock() {
      const a = element();
      if (!a) return;
      try {
        // A silent, gesture-scoped load is what lifts the element's autoplay gate.
        a.muted = true;
        a.src = 'data:audio/mp3;base64,';
        void a.play()?.catch(() => undefined);
        a.pause();
        a.muted = false;
      } catch {
        // Nothing to do: the first real play will report for itself.
      }
    },
    play: (url, signal) =>
      new Promise<void>((resolve) => {
        const a = element();
        if (!a || signal.aborted) {
          resolve();
          return;
        }
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          a.removeEventListener('ended', finish);
          a.removeEventListener('error', finish);
          signal.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          try {
            a.pause();
          } catch {
            // ignore
          }
          finish();
        };
        a.addEventListener('ended', finish);
        a.addEventListener('error', finish);
        signal.addEventListener('abort', onAbort);
        a.src = url;
        const p = a.play();
        // (jsdom returns undefined from play(); a browser returns a promise that rejects
        // when autoplay is blocked — either way the line is simply not spoken.)
        if (p && typeof p.catch === 'function') p.catch(finish);
      }),
  };
}

export function createVoiceSink(options: VoiceSinkOptions): VoiceSink {
  const player = options.player ?? createAudioElementPlayer().play;
  let enabled = options.enabled ?? false;
  const queue: TranscriptLine[] = [];
  /** The clip in flight, or null. Its controller is the owner token: a settle from a
   *  clip that is no longer `current` is ignored. */
  let current: AbortController | null = null;

  const urlFor = (line: TranscriptLine): string | null => {
    const file = clipFor(options.manifest, line.say);
    return file ? `${options.baseUrl}${file}` : null;
  };

  const dropGuidance = () => {
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === 'guidance') queue.splice(i, 1);
  };

  const pump = (): void => {
    if (current) return;
    const next = queue.shift();
    if (!next) return;
    const url = urlFor(next);
    if (!url) {
      pump();
      return;
    }
    const ctrl = new AbortController();
    current = ctrl;
    // The player is a seam (a Web Audio player, a test double): whatever it does —
    // rejects, throws synchronously, returns nothing — the queue must keep moving.
    let p: Promise<void>;
    try {
      p = Promise.resolve(player(url, ctrl.signal));
    } catch {
      p = Promise.resolve();
    }
    void p
      .catch(() => undefined)
      .then(() => {
        if (current !== ctrl) return; // cancelled: a newer owner is in charge
        current = null;
        pump();
      });
  };

  const cancel = () => {
    const c = current;
    current = null;
    c?.abort();
  };

  return {
    say(line) {
      if (!enabled) return;
      // ANY new line makes every waiting nudge stale; a new instruction also drops an
      // earlier, still-unspoken instruction (a cue skipped as soon as it began must not
      // be announced late). A `cannot` is written as "<reason> Moving on." and is spoken
      // the same way: the reason first, then the runner's phrase.
      dropGuidance();
      if (line.kind === 'instruction') {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === 'instruction') queue.splice(i, 1);
      }
      if (line.kind === 'end' && line.why) queue.push({ ...line, say: line.why, why: undefined });
      queue.push(line);
      pump();
    },
    stop() {
      queue.length = 0;
      cancel();
    },
    hush() {
      queue.length = 0;
      cancel();
    },
    setEnabled(on) {
      enabled = on;
      if (!on) {
        queue.length = 0;
        cancel();
      }
    },
    isEnabled: () => enabled,
    pending: () => queue.length,
    isPlaying: () => current !== null,
  };
}
