/**
 * The Signalsmith stretcher's edges (#187 PR 7), beside `song_stretcher_signalsmith.test.ts`
 * (whose fakes this file mirrors): a tempo change mid-song re-anchors the position at the OLD
 * rate before the new one applies (else the song would jump), a seek is guarded and moves the
 * worklet, a song played to its end stops the worklet and restarts from the top on play, a
 * dispose while the worklet is still starting closes it on arrival, a worklet that answers after
 * the start timeout is closed rather than left running, and once on the fallback every call is
 * the media element's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fail: false,
  node: null as null | Record<string, unknown>,
  /** When set, the factory waits for this before answering. */
  gate: null as null | Promise<void>,
  element: null as null | Record<string, ReturnType<typeof vi.fn>>,
}));
vi.mock('@/slices/song/app/song_stretcher', () => ({
  createMediaElementStretcher: () => {
    h.element = {
      load: vi.fn(async () => {}),
      play: vi.fn(),
      pause: vi.fn(),
      setRate: vi.fn(),
      setVolume: vi.fn(),
      fade: vi.fn(),
      seek: vi.fn(),
      blocked: vi.fn(() => true),
      unlock: vi.fn(),
      position: vi.fn(() => 42),
      playing: vi.fn(() => true),
      ended: vi.fn(() => false),
      dispose: vi.fn(),
    };
    return h.element;
  },
}));
import { createSignalsmithStretcherWith, type SignalsmithFactory } from '@/slices/song/app/song_stretcher_signalsmith';
import { SONG } from '../helpers/extensions';

const load = async (): Promise<SignalsmithFactory> => async () => {
  if (h.gate) await h.gate;
  if (h.fail) throw new Error('no AudioWorklet');
  return h.node as unknown as AudioNode;
};

function fakes(durationS = 10) {
  const ctx = {
    currentTime: 0,
    createGain: () => ({
      gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
    decodeAudioData: async () => {
      const own = [new Float32Array(4), new Float32Array(4)];
      return { numberOfChannels: 2, length: 4, duration: durationS, getChannelData: (c: number) => own[c] };
    },
  };
  const schedules: Array<Record<string, unknown>> = [];
  const node = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    schedule: (c: Record<string, unknown>) => schedules.push(c),
    addBuffers: vi.fn(async (channels: Float32Array[]) => (channels[0].length / 4) * durationS),
    dropBuffers: vi.fn(async () => ({})),
    setUpdateInterval: async () => {},
    port: { onmessage: null },
  };
  h.node = node;
  const s = createSignalsmithStretcherWith({ audioContext: ctx as never, destination: {} as never }, load);
  return { ctx, node, schedules, s };
}

beforeEach(() => {
  h.fail = false;
  h.gate = null;
  h.element = null;
  globalThis.fetch = (async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.runIf(SONG)('the Signalsmith stretcher, at its edges', () => {
  it('a tempo change mid-song re-anchors at the old rate, so the position does not jump', async () => {
    const { ctx, s, schedules } = fakes();
    await s.load('blob:x');
    s.play();
    ctx.currentTime = 2;
    expect(s.position()).toBeCloseTo(2, 9);
    s.setRate(2);
    expect(schedules.at(-1)).toEqual({ rate: 2, output: 2 });
    expect(s.position()).toBeCloseTo(2, 9);
    ctx.currentTime = 3;
    expect(s.position()).toBeCloseTo(4, 9);
  });

  it('ignores a rate that is no rate, or unchanged; a rate set while paused only applies on play', async () => {
    const { ctx, s, schedules } = fakes();
    await s.load('blob:x');
    const n = schedules.length;
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1]) s.setRate(bad);
    s.setRate(1.5);
    expect(schedules).toHaveLength(n);
    s.play();
    expect(schedules.at(-1)).toMatchObject({ active: true, rate: 1.5 });
    ctx.currentTime = 2;
    expect(s.position()).toBeCloseTo(3, 9);
  });

  it('a seek moves the worklet and the position; a nonsense seek is ignored', async () => {
    const { ctx, s, schedules } = fakes();
    await s.load('blob:x');
    s.seek!(4);
    expect(schedules.at(-1)).toEqual({ input: 4, output: 0 });
    expect(s.position()).toBe(4);
    const n = schedules.length;
    s.seek!(-1);
    s.seek!(Number.NaN);
    expect(schedules).toHaveLength(n);
    s.play();
    ctx.currentTime = 1;
    expect(s.position()).toBeCloseTo(5, 9);
  });

  it('a seek before any song is loaded does nothing', () => {
    const { s, schedules } = fakes();
    s.seek!(3);
    expect(schedules).toEqual([]);
  });

  it('a song played to its end stops the worklet; play then starts it from the top', async () => {
    const { ctx, s, schedules } = fakes(10);
    await s.load('blob:x');
    s.play();
    ctx.currentTime = 12;
    expect(s.position()).toBe(10);
    expect(schedules.at(-1)).toEqual({ active: false, output: 12 });
    expect(s.playing()).toBe(false);
    expect(s.ended()).toBe(true);
    s.play();
    expect(schedules.at(-1)).toMatchObject({ active: true, input: 0 });
    expect(s.ended()).toBe(false);
  });

  it('play while playing and pause while paused change nothing', async () => {
    const { s, schedules } = fakes();
    await s.load('blob:x');
    s.pause();
    const n = schedules.length;
    s.pause();
    s.play();
    s.play();
    expect(schedules).toHaveLength(n + 1);
  });

  it('play and pause before any song are no-ops', () => {
    const { s, schedules } = fakes();
    s.play();
    s.pause();
    expect(schedules).toEqual([]);
  });

  it('a dispose while the worklet is starting closes it on arrival, and the load fails', async () => {
    let open: () => void = () => {};
    h.gate = new Promise((r) => (open = r));
    const { node, s } = fakes();
    const p = s.load('blob:x');
    s.dispose();
    open();
    await expect(p).rejects.toThrow('the song player could not start');
    expect(node.disconnect).toHaveBeenCalled();
    expect(node.connect).not.toHaveBeenCalled();
  });

  it('a dispose while a failing worklet starts makes no fallback', async () => {
    let open: () => void = () => {};
    h.gate = new Promise((r) => (open = r));
    h.fail = true;
    const { s } = fakes();
    const p = s.load('blob:x');
    s.dispose();
    open();
    await expect(p).rejects.toThrow('the song player could not start');
    expect(h.element).toBeNull();
  });

  it('a worklet that answers after the start timeout is closed, and the song plays on the element', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let open: () => void = () => {};
    h.gate = new Promise((r) => (open = r));
    const { node, s } = fakes();
    const p = s.load('blob:x');
    await vi.advanceTimersByTimeAsync(60_000);
    await p;
    expect(h.element!.load).toHaveBeenCalledWith('blob:x');
    open();
    await vi.advanceTimersByTimeAsync(0);
    expect(node.disconnect).toHaveBeenCalledOnce();
    expect(node.connect).not.toHaveBeenCalled();
  });

  it('on the fallback, every call is the media element\'s', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.fail = true;
    const { s } = fakes();
    await s.load('blob:x');
    const el = h.element!;
    s.setRate(1.5);
    expect(el.setRate).toHaveBeenLastCalledWith(1.5);
    s.fade!(0, 0.2);
    expect(el.fade).toHaveBeenCalledWith(0, 0.2);
    s.seek!(3);
    expect(el.seek).toHaveBeenCalledWith(3);
    s.setVolume(0.3);
    expect(el.setVolume).toHaveBeenLastCalledWith(0.3);
    s.play();
    s.pause();
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.pause).toHaveBeenCalledOnce();
    expect(s.blocked!()).toBe(true);
    s.unlock!();
    expect(el.unlock).toHaveBeenCalledOnce();
    expect(s.position()).toBe(42);
    expect(s.playing()).toBe(true);
    expect(s.ended()).toBe(false);
    s.dispose();
    expect(el.dispose).toHaveBeenCalledOnce();
  });

  it('without a fallback it is never blocked, and unlock does nothing', async () => {
    const { s } = fakes();
    await s.load('blob:x');
    expect(s.blocked!()).toBe(false);
    expect(s.unlock!()).toBeUndefined();
  });
});
