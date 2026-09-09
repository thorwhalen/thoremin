/**
 * The time-stretch seam (#186 PR G): how a loaded song is played at a rate the
 * dancer sets, pitch preserved.
 *
 * Default: the browser's own `HTMLMediaElement.playbackRate` with `preservesPitch`
 * (Baseline since December 2023 — Chrome 86, Firefox 101, Safari 17.2), routed into
 * the instrument's master gain through `createMediaElementSource`. Zero bytes, no
 * dependency, and a rate change is immediate. Its quality holds within roughly
 * 0.5–2× and degrades outside; the pace controller's clamp keeps it in range.
 *
 * The seam's next candidate is Signalsmith Stretch (MIT, 47 KB gzipped, a WASM
 * `AudioWorkletNode` with sample-accurate `schedule({rate})` and a pitch-shift the
 * native element lacks): the same interface, loaded lazily on first use. It is not
 * built here — the research map (§6.1) measured it; this file is where it plugs in.
 *
 * `createStretcher` is what the `song-player` node calls; a host may inject its own
 * through `ctx.resources.createStretcher` (the tests do), so the node is Node-testable.
 */

export interface Stretcher {
  /** Load a song by URL (an object URL for a local file). Resolves when playable. */
  load(url: string): Promise<void>;
  play(): void;
  pause(): void;
  /** Playback rate, pitch preserved. 1 = original tempo. */
  setRate(rate: number): void;
  setVolume(v: number): void;
  /** Current position in the song, seconds (of the ORIGINAL timeline). */
  position(): number;
  /** Song length in seconds, or NaN before load. */
  duration(): number;
  /** Is the transport running? */
  playing(): boolean;
  /** Has the song ended? */
  ended(): boolean;
  dispose(): void;
}

export interface StretcherOptions {
  audioContext: AudioContext;
  destination: AudioNode;
}

export type StretcherFactory = (opts: StretcherOptions) => Stretcher;

/** The native media-element stretcher (browser-only; constructed lazily by the node). */
export const createMediaElementStretcher: StretcherFactory = ({ audioContext, destination }) => {
  const el = document.createElement('audio');
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  // The whole point: a rate change must not change the pitch.
  (el as HTMLMediaElement & { preservesPitch: boolean }).preservesPitch = true;
  const gain = audioContext.createGain();
  gain.connect(destination);
  let source: MediaElementAudioSourceNode | null = null;
  let loadedUrl: string | null = null;
  return {
    async load(url) {
      if (loadedUrl === url) return;
      loadedUrl = url;
      el.src = url;
      if (!source) {
        // A media element may be wired to exactly one source node for its lifetime.
        source = audioContext.createMediaElementSource(el);
        source.connect(gain);
      }
      await new Promise<void>((resolve, reject) => {
        const ok = () => {
          cleanup();
          resolve();
        };
        const bad = () => {
          cleanup();
          reject(new Error('the song could not be decoded'));
        };
        const cleanup = () => {
          el.removeEventListener('canplay', ok);
          el.removeEventListener('error', bad);
        };
        el.addEventListener('canplay', ok);
        el.addEventListener('error', bad);
        el.load();
      });
    },
    play() {
      void el.play().catch(() => {
        /* autoplay policy: the host starts audio on a gesture, so this is rare */
      });
    },
    pause() {
      el.pause();
    },
    setRate(rate) {
      if (Number.isFinite(rate) && rate > 0 && el.playbackRate !== rate) el.playbackRate = rate;
    },
    setVolume(v) {
      gain.gain.value = Math.max(0, Math.min(1, v));
    },
    position: () => el.currentTime,
    duration: () => el.duration,
    playing: () => !el.paused && !el.ended,
    ended: () => el.ended,
    dispose() {
      el.pause();
      el.removeAttribute('src');
      source?.disconnect();
      gain.disconnect();
    },
  };
};
