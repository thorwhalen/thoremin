/**
 * The chord map's microphone, its BROWSER half (H8 of #613): `mic_chord_in.test.ts` injects
 * the microphone; this file lets `startMicChordIn` open it the way a browser does, over stubbed
 * `navigator.mediaDevices` and `AudioContext`, and pins what the player cannot see: echo
 * cancellation on and speech processing off, the analyser's size, a suspended context resumed
 * and, if refused, resumed again on the next tap or key, a microphone that opened but could not
 * be analysed stopped at once (reason `failed`, not `denied`), the default reading pace, a
 * microphone that opens after the map stopped following it closed again, and the stop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMicChordIn } from '@thoremin/ext-harmony/app/micChordIn';
import type { AudioHeard } from '@thoremin/ext-harmony/lib/audio_heard';

type MapState = { chordMap?: { enabled?: boolean; follow?: string } };

const store = (follow: string) => {
  let state: MapState = { chordMap: { enabled: true, follow } };
  const subs = new Set<(s: MapState) => void>();
  return {
    subs,
    getState: () => state,
    subscribe: (l: (s: MapState) => void) => (subs.add(l), () => void subs.delete(l)),
    set: (f: string) => {
      state = { chordMap: { enabled: true, follow: f } };
      subs.forEach((l) => l(state));
    },
  };
};

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A browser with a microphone: the stream, its tracks, and the AudioContext it is read through. */
function browser({ running = true, analyserThrows = false, resumeRejects = false } = {}) {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn(async (_c: MediaStreamConstraints) => stream);
  const contexts: FakeCtx[] = [];
  const listeners = new Map<string, () => void>();
  interface FakeCtx {
    state: string;
    sampleRate: number;
    resume: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    analyser?: { fftSize: number; smoothingTimeConstant: number; frequencyBinCount: number; getFloatFrequencyData: (a: Float32Array) => void };
    source?: { connect: ReturnType<typeof vi.fn> };
  }
  class Ctx {
    state = running ? 'running' : 'suspended';
    sampleRate = 44100;
    resume = vi.fn(() => (resumeRejects ? Promise.reject(new Error('no gesture')) : Promise.resolve()));
    close = vi.fn(() => Promise.resolve());
    analyser?: FakeCtx['analyser'];
    source?: FakeCtx['source'];
    constructor() {
      contexts.push(this as unknown as FakeCtx);
    }
    createAnalyser() {
      if (analyserThrows) throw new Error('sample-rate mismatch');
      this.analyser = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        get frequencyBinCount() {
          return this.fftSize / 2;
        },
        getFloatFrequencyData: (a: Float32Array) => a.fill(-100),
      };
      return this.analyser;
    }
    createMediaStreamSource() {
      this.source = { connect: vi.fn() };
      return this.source;
    }
  }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('window', {
    AudioContext: Ctx,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string, fn: () => void) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  });
  return { track, getUserMedia, contexts, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the chord map microphone, opened by the browser', () => {
  it('asks for the microphone with echo cancellation on and speech processing off, and analyses it finely', async () => {
    const b = browser();
    const heard: (AudioHeard | null)[] = [];
    let tick: (() => void) | null = null;
    const stop = startMicChordIn({ store: store('audio'), publish: (h) => heard.push(h), every: (fn) => ((tick = fn), () => (tick = null)) });
    await flush();
    expect(b.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    const [ctx] = b.contexts;
    expect(ctx.analyser!.fftSize).toBe(8192);
    expect(ctx.analyser!.smoothingTimeConstant).toBe(0.5);
    expect(ctx.source!.connect).toHaveBeenCalledWith(ctx.analyser);
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(b.listeners.size).toBe(0); // running: nothing to unlock
    tick!();
    expect(heard.at(-1)).toEqual({ available: true, chroma: [], sounding: false });
    stop();
    expect(b.track.stop).toHaveBeenCalledOnce();
    expect(ctx.close).toHaveBeenCalledOnce();
    expect(heard.at(-1)).toBeNull();
  });

  it('a context the browser keeps suspended is resumed again on the next tap or key, and the listeners go with the microphone', async () => {
    const b = browser({ running: false, resumeRejects: true });
    const s = store('audio');
    startMicChordIn({ store: s, publish: () => {}, every: () => () => {} });
    await flush();
    const [ctx] = b.contexts;
    expect([...b.listeners.keys()].sort()).toEqual(['keydown', 'pointerdown']);
    b.listeners.get('pointerdown')!();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    s.set('hands');
    expect(b.listeners.size).toBe(0);
    expect(b.track.stop).toHaveBeenCalledOnce();
  });

  it('a microphone that opened but cannot be analysed is stopped at once and reads as failed', async () => {
    const b = browser({ analyserThrows: true });
    const heard: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => heard.push(h) });
    await flush();
    expect(b.track.stop).toHaveBeenCalledOnce();
    expect(b.contexts[0].close).toHaveBeenCalledOnce();
    expect(heard.at(-1)).toMatchObject({ available: false, reason: 'failed' });
  });

  it('a refused permission reads as denied', async () => {
    const b = browser();
    b.getUserMedia.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'));
    const heard: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => heard.push(h) });
    await flush();
    expect(heard.at(-1)).toMatchObject({ reason: 'denied' });
  });

  it('a browser with no microphone API or no AudioContext is unsupported', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { AudioContext: class {} });
    const a: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => a.push(h) });
    expect(a).toEqual([{ available: false, chroma: [], sounding: false, reason: 'unsupported' }]);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: async () => ({}) } });
    vi.stubGlobal('window', {});
    const b: (AudioHeard | null)[] = [];
    startMicChordIn({ store: store('audio'), publish: (h) => b.push(h) });
    expect(b.at(-1)).toMatchObject({ reason: 'unsupported' });
  });

  it('reads ten times a second by default, and stops reading with the microphone', async () => {
    vi.useFakeTimers();
    browser();
    const heard: (AudioHeard | null)[] = [];
    const s = store('audio');
    startMicChordIn({ store: s, publish: (h) => heard.push(h) });
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toHaveLength(1); // pending
    await vi.advanceTimersByTimeAsync(100);
    expect(heard).toHaveLength(2);
    expect(heard.at(-1)).toMatchObject({ available: true });
    s.set('hands');
    const n = heard.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(heard).toHaveLength(n);
  });

  it('a microphone that opens after the map stopped following it is closed again, never read', async () => {
    let resolveOpen: (m: unknown) => void = () => {};
    const close = vi.fn();
    const s = store('audio');
    const every = vi.fn(() => () => {});
    startMicChordIn({
      store: s,
      publish: () => {},
      every,
      open: () => new Promise((r) => (resolveOpen = r as (m: unknown) => void)),
    });
    s.set('hands');
    resolveOpen({ sampleRate: 44100, fftSize: 8192, read: () => new Float32Array(4096), close });
    await flush();
    expect(close).toHaveBeenCalledOnce();
    expect(every).not.toHaveBeenCalled();
  });

  it('the stop unsubscribes from the dial', () => {
    const s = store('hands');
    const stop = startMicChordIn({ store: s, publish: () => {}, open: null });
    expect(s.subs.size).toBe(1);
    stop();
    expect(s.subs.size).toBe(0);
  });
});
