/**
 * One-shot sample voices for the audio thread: a triggered sample starts at an exact sample
 * offset inside the current render quantum and plays to its end, mixed into the output.
 *
 * A fixed pool (no allocation once made); when every voice is busy the oldest is cut and
 * reused (16 one-shots at once is a roll no hand plays). A voice can be faded out from an
 * exact offset and a new one faded in part-way through its sample: that is how a provisional
 * decision is corrected (`./mapper.ts`, "sound early, decide late") without a click and
 * without losing the beat, since the corrected sample starts where it would have been had it
 * been chosen first. Samples are registered by id and must already be at the context's sample
 * rate (the host resamples on decode).
 */

export interface SamplerOptions {
  maxVoices?: number;
  /** Fade applied by stopAll, samples. */
  stopFade?: number;
}

export const SAMPLER_DEFAULTS = { maxVoices: 16, stopFade: 64 } as const;

export interface TriggerOptions {
  /** Start this many samples into the sample (a time-aligned correction). */
  startAt?: number;
  /** Fade in over this many samples. */
  fadeIn?: number;
}

export interface Sampler {
  setSample(id: string, data: Float32Array | null): void;
  has(id: string): boolean;
  /**
   * Start `id` at `offset` samples into the next {@link render} call's block. Returns a voice
   * handle (>= 0), or -1 for an unknown id.
   */
  trigger(id: string, gain: number, offset: number, options?: TriggerOptions): number;
  /** Fade a voice out over `samples`, starting `offset` samples into the next block. A stale handle is ignored. */
  release(handle: number, offset: number, samples: number): void;
  /** Mix every active voice into `out` (added, never overwritten). */
  render(out: Float32Array): void;
  /** Voices sounding now. */
  active(): number;
  stopAll(): void;
}

interface Voice {
  data: Float32Array | null;
  /** The handle the voice was last triggered with. */
  handle: number;
  pos: number;
  gain: number;
  /** Samples to wait before starting, inside the next block. */
  delay: number;
  fadeIn: number;
  fadeInLeft: number;
  /** Samples to wait before the fade-out starts, or -1 when none is due. */
  releaseIn: number;
  fadeOut: number;
  fadeOutLeft: number;
}

export function createSampler(options: SamplerOptions = {}): Sampler {
  const o = { ...SAMPLER_DEFAULTS, ...options };
  const samples = new Map<string, Float32Array>();
  const voices: Voice[] = Array.from({ length: o.maxVoices }, () => ({
    data: null,
    handle: -1,
    pos: 0,
    gain: 0,
    delay: 0,
    fadeIn: 0,
    fadeInLeft: 0,
    releaseIn: -1,
    fadeOut: 0,
    fadeOutLeft: 0,
  }));
  let next = 0;
  const release = (v: Voice, offset: number, n: number) => {
    v.releaseIn = Math.max(0, Math.floor(offset));
    v.fadeOut = Math.max(1, Math.floor(n));
    v.fadeOutLeft = v.fadeOut;
  };
  return {
    setSample(id, data) {
      if (data) samples.set(id, data);
      else samples.delete(id);
    },
    has: (id) => samples.has(id),
    trigger(id, gain, offset, opts = {}) {
      const data = samples.get(id);
      if (!data) return -1;
      const v = voices.find((x) => x.data === null) ?? voices.reduce((a, b) => (b.handle < a.handle ? b : a));
      v.data = data;
      v.handle = next++;
      v.pos = Math.max(0, Math.floor(opts.startAt ?? 0));
      v.gain = gain;
      v.delay = Math.max(0, Math.floor(offset));
      v.fadeIn = Math.max(0, Math.floor(opts.fadeIn ?? 0));
      v.fadeInLeft = v.fadeIn;
      v.releaseIn = -1;
      return v.handle;
    },
    release(handle, offset, n) {
      const v = voices.find((x) => x.data !== null && x.handle === handle);
      if (v) release(v, offset, n);
    },
    render(out) {
      for (const v of voices) {
        if (!v.data) continue;
        const data = v.data;
        let i = Math.min(out.length, v.delay);
        v.delay -= i;
        if (v.releaseIn > 0) v.releaseIn = Math.max(0, v.releaseIn - i);
        for (; i < out.length && v.pos < data.length; i++) {
          let g = v.gain;
          if (v.fadeInLeft > 0) {
            g *= 1 - v.fadeInLeft / (v.fadeIn + 1);
            v.fadeInLeft--;
          }
          if (v.releaseIn === 0) {
            if (v.fadeOutLeft <= 0) {
              v.pos = data.length;
              break;
            }
            g *= v.fadeOutLeft / v.fadeOut;
            v.fadeOutLeft--;
          } else if (v.releaseIn > 0) v.releaseIn--;
          out[i] += data[v.pos++] * g;
        }
        if (v.pos >= data.length) v.data = null;
      }
    },
    active: () => voices.reduce((n, v) => n + (v.data ? 1 : 0), 0),
    stopAll() {
      for (const v of voices) if (v.data && v.releaseIn < 0) release(v, 0, o.stopFade);
    },
  };
}
