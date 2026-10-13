/**
 * The default {@link Stretcher} for the `song-player` node (#186 PR G): the browser's own
 * `HTMLMediaElement.playbackRate` with `preservesPitch` (Baseline since December 2023:
 * Chrome 86, Firefox 101, Safari 17.2), routed into the instrument's master gain through
 * `createMediaElementSource`. No bytes, no dependency, and a rate change is immediate;
 * its quality holds within about 0.5x to 2x, which is the node's clamp (research map
 * §6.1). Browser-only (a DOM element), so the node imports this module dynamically on
 * first need and Node tests inject their own stretcher instead.
 */
import type { Stretcher, StretcherFactory } from './song_player';

export const createMediaElementStretcher: StretcherFactory = ({ audioContext, destination }): Stretcher => {
  const el = document.createElement('audio');
  el.preload = 'auto';
  // The whole point: a rate change must not change the pitch.
  (el as HTMLMediaElement & { preservesPitch: boolean }).preservesPitch = true;
  const gain = audioContext.createGain();
  gain.connect(destination);
  // A media element may feed exactly one source node for its lifetime: made once.
  const source = audioContext.createMediaElementSource(el);
  source.connect(gain);
  let pending: (() => void) | null = null;
  let volume = 1;

  return {
    load(url) {
      pending?.();
      el.pause();
      el.src = url;
      return new Promise<void>((resolve, reject) => {
        const done = () => {
          el.removeEventListener('canplay', ok);
          el.removeEventListener('error', bad);
          pending = null;
        };
        const ok = () => {
          done();
          resolve();
        };
        const bad = () => {
          done();
          reject(new Error('the song could not be decoded'));
        };
        // A superseded load settles as a failure its caller ignores (it checks the id).
        pending = bad;
        el.addEventListener('canplay', ok);
        el.addEventListener('error', bad);
        el.load();
      });
    },
    play() {
      // An ended element restarts from the beginning on play() (the HTML spec).
      void el.play().catch(() => {
        /* the autoplay policy: the audio was started on a tap, so this is rare */
      });
    },
    pause() {
      el.pause();
    },
    setRate(rate) {
      if (Number.isFinite(rate) && rate > 0 && el.playbackRate !== rate) el.playbackRate = rate;
    },
    setVolume(v) {
      if (v === volume) return;
      volume = v;
      gain.gain.setTargetAtTime(v, audioContext.currentTime, 0.03);
    },
    position: () => el.currentTime,
    playing: () => !el.paused && !el.ended,
    ended: () => el.ended,
    dispose() {
      pending?.();
      el.pause();
      el.removeAttribute('src');
      el.load();
      source.disconnect();
      gain.disconnect();
    },
  };
};
