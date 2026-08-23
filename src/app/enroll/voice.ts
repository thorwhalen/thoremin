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
 * Lines arrive faster than they can be spoken (a nudge 250 ms after an instruction),
 * and a nudge that is still queued when the cue ENDS is stale. So: one clip at a time,
 * in order; an instruction, an end phrase or "done" drops every nudge still waiting.
 * The written channel is never delayed by any of this.
 *
 * ## Autoplay
 *
 * Browsers refuse audio that was not preceded by a user gesture. The toggle IS a user
 * gesture, and Start is one too, so in practice play succeeds; when it does not, the
 * failure is swallowed (the sink contract: never throw, never block) and the text
 * channel carries on.
 */
import type { GuidanceSink } from './guidance';
import type { TranscriptLine } from './store';
import type { VoiceManifest } from './speakable';

/** Something that plays one URL to completion. Injectable (tests; a Web Audio player). */
export type ClipPlayer = (url: string) => Promise<void>;

export interface VoiceSinkOptions {
  manifest: VoiceManifest;
  /** URL prefix the manifest's file names are relative to (`.../voice/`). */
  baseUrl: string;
  /** Defaults to an `HTMLAudioElement`-backed player. */
  player?: ClipPlayer;
  /** Starts enabled? Default false (voice is a toggle; text is not). */
  enabled?: boolean;
}

export interface VoiceSink extends GuidanceSink {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  /** Lines waiting to be spoken (for tests / a meter). */
  pending(): number;
}

/** The default player: a fresh `Audio` per clip, resolved on `ended` or on error. */
export const audioElementPlayer: ClipPlayer = (url) =>
  new Promise<void>((resolve) => {
    if (typeof Audio === 'undefined') {
      resolve();
      return;
    }
    const a = new Audio(url);
    a.addEventListener('ended', () => resolve(), { once: true });
    a.addEventListener('error', () => resolve(), { once: true });
    const p = a.play();
    // (jsdom returns undefined from play(); a browser returns a promise that rejects
    // when autoplay is blocked — either way the line is simply not spoken.)
    if (p && typeof p.catch === 'function') p.catch(() => resolve());
  });

export function createVoiceSink(options: VoiceSinkOptions): VoiceSink {
  const player = options.player ?? audioElementPlayer;
  let enabled = options.enabled ?? false;
  const queue: TranscriptLine[] = [];
  let playing = false;

  const urlFor = (line: TranscriptLine): string | null => {
    const file = options.manifest.clips[line.say];
    return file ? `${options.baseUrl}${file}` : null;
  };

  const pump = (): void => {
    if (playing) return;
    const next = queue.shift();
    if (!next) return;
    const url = urlFor(next);
    if (!url) {
      pump();
      return;
    }
    playing = true;
    void player(url)
      .catch(() => undefined)
      .then(() => {
        playing = false;
        pump();
      });
  };

  return {
    say(line) {
      if (!enabled) return;
      // A new instruction (or the end of a cue) makes every waiting nudge stale.
      if (line.kind !== 'guidance') {
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].kind === 'guidance') queue.splice(i, 1);
      }
      // A `cannot` is written as "<reason> Moving on." — and must be SPOKEN the same
      // way: the reason first, then the runner's phrase.
      if (line.kind === 'end' && line.why) queue.push({ ...line, say: line.why, why: undefined });
      queue.push(line);
      pump();
    },
    setEnabled(on) {
      enabled = on;
      if (!on) queue.length = 0;
    },
    isEnabled: () => enabled,
    pending: () => queue.length,
  };
}
