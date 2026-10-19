/**
 * The Signalsmith stretcher (#187 PR 7): the song player's default, an adapter from the
 * `Stretcher` seam onto Signalsmith Stretch's worklet node (its `schedule` time map, its
 * reported input time), with the media element as the fallback where the worklet cannot
 * start. The package (injected through the loader seam) and the element are replaced: this pins the adapter's bookkeeping,
 * what it schedules and where it says the song is.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  fail: false,
  node: null as null | Record<string, unknown>,
  element: vi.fn(),
}));
vi.mock('@/slices/song/app/song_stretcher', () => ({
  createMediaElementStretcher: (...a: unknown[]) => {
    h.element(...a);
    return { load: async () => {}, play() {}, pause() {}, setRate() {}, setVolume() {}, position: () => 42, playing: () => true, ended: () => false, dispose() {} };
  },
}));
import { createSignalsmithStretcherWith, type SignalsmithFactory } from '@/slices/song/app/song_stretcher_signalsmith';
import { SONG } from '../helpers/extensions';

/** The package, replaced: a node factory that fails like a missing AudioWorklet when asked. */
const load = async (): Promise<SignalsmithFactory> => async () => {
  if (h.fail) throw new Error('no AudioWorklet');
  return h.node as unknown as AudioNode;
};
const createSignalsmithStretcher = (audio: Parameters<typeof createSignalsmithStretcherWith>[0]) => createSignalsmithStretcherWith(audio, load);

function fakes(durationS = 10) {
  const gains: Array<{ gain: Record<string, ReturnType<typeof vi.fn> | number> }> = [];
  /** Each decode's own channel arrays, in order. */
  const decoded: Float32Array[][] = [];
  const ctx = {
    currentTime: 0,
    createGain: () => {
      const gain = { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn() };
      const g = { gain, connect: vi.fn(), disconnect: vi.fn() };
      gains.push(g);
      return g;
    },
    decodeAudioData: async () => {
      decoded.push([new Float32Array(4), new Float32Array(4)]);
      const own = decoded.at(-1)!;
      return { numberOfChannels: 2, length: 4, duration: durationS, getChannelData: (c: number) => own[c] };
    },
  };
  const schedules: Array<Record<string, unknown>> = [];
  let report: ((t: number) => void) | undefined;
  const node = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    schedule: (c: Record<string, unknown>) => schedules.push(c),
    // The worklet's reply: the end of what it holds, in seconds (the arrays' length over the rate).
    addBuffers: vi.fn(async (channels: Float32Array[]) => (channels[0].length / 4) * durationS),
    dropBuffers: vi.fn(async () => ({})),
    setUpdateInterval: async (_s: number, cb: (t: number) => void) => {
      report = cb;
    },
    port: { onmessage: null },
  };
  h.node = node;
  return { ctx, node, gains, schedules, decoded, decodes: () => decoded.length, report: (t: number) => report?.(t) };
}

beforeEach(() => {
  h.fail = false;
  h.element.mockClear();
  globalThis.fetch = (async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
});

describe.runIf(SONG)('the Signalsmith stretcher', () => {
  it('loads the decoded song into the worklet, plays, and extrapolates its position at the rate', async () => {
    const f = fakes();
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    expect(f.node.addBuffers).toHaveBeenCalledTimes(1);
    expect((f.node.addBuffers.mock.calls[0] as unknown[])[0]).toHaveLength(2);
    // Transferred, not cloned (#365): the second argument lists the channels' buffers.
    expect((f.node.addBuffers.mock.calls[0] as unknown[])[1]).toHaveLength(2);
    expect(f.decodes()).toBe(1);
    expect(s.playing()).toBe(false);
    s.setRate(1.25);
    s.play();
    expect(f.schedules.at(-1)).toMatchObject({ active: true, input: 0, rate: 1.25 });
    expect(s.playing()).toBe(true);
    f.ctx.currentTime = 2;
    expect(s.position()).toBeCloseTo(2.5, 9);
    // The worklet's periodic reports run its own latency AHEAD of the audio leaving it:
    // the position is the adapter's own time map and never reads them.
    f.report(2.5 + 0.12);
    expect(s.position()).toBeCloseTo(2.5, 9);
  });

  it('hands the worklet the decoded buffer\'s OWN arrays by transfer: one decode, no copy held (#365)', async () => {
    const f = fakes();
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    const [channels, transfer] = f.node.addBuffers.mock.calls[0] as unknown as [Float32Array[], ArrayBufferLike[]];
    expect(channels[0]).toBe(f.decoded[0][0]);
    expect(channels[1]).toBe(f.decoded[0][1]);
    expect(transfer).toEqual([f.decoded[0][0].buffer, f.decoded[0][1].buffer]);
    expect(f.decodes()).toBe(1);
  });

  it('a browser that will not detach the buffer\'s arrays: copies of the same, still intact buffer, no second decode', async () => {
    const f = fakes();
    f.node.addBuffers.mockImplementationOnce(async () => {
      throw new DOMException('cannot transfer', 'DataCloneError');
    });
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    expect(f.node.addBuffers).toHaveBeenCalledTimes(2);
    expect(f.decodes()).toBe(1);
    const [channels, transfer] = f.node.addBuffers.mock.calls[1] as unknown as [Float32Array[], ArrayBufferLike[]];
    expect(channels[0]).not.toBe(f.decoded[0][0]);
    expect(channels[0]).toEqual(f.decoded[0][0]);
    expect(transfer).toEqual(channels.map((c) => c.buffer));
    s.play();
    expect(s.playing()).toBe(true);
  });

  it('a transfer that arrives short of the song is dropped and replaced by copies; copies refused too fail the load', async () => {
    const f = fakes(10);
    f.node.addBuffers.mockImplementationOnce(async () => 0);
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    expect(f.node.addBuffers).toHaveBeenCalledTimes(2);
    // Dropped before the load, again after the short hand-over.
    expect(f.node.dropBuffers).toHaveBeenCalledTimes(2);
    const g = fakes(10);
    g.node.addBuffers.mockImplementation(async () => 0);
    const t = createSignalsmithStretcher({ audioContext: g.ctx as never, destination: {} as never });
    await expect(t.load('blob:x')).rejects.toThrow(/did not take the song/);
  });

  it('a partly detached buffer arrives short: the file is decoded again for copies', async () => {
    const f = fakes(10);
    f.node.addBuffers.mockImplementationOnce(async () => {
      // Channel 0 detached before the send failed: the buffer is no longer intact.
      f.decoded[0][0] = new Float32Array(0);
      throw new DOMException('cannot transfer', 'DataCloneError');
    });
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    expect(f.decodes()).toBe(2);
    expect((f.node.addBuffers.mock.calls[1] as unknown as [Float32Array[]])[0][0]).toEqual(f.decoded[1][0]);
  });

  it('copies refused too fail the load; a load superseded during the hand-over never drops the newer song', async () => {
    const f = fakes(10);
    f.node.addBuffers.mockImplementation(async () => {
      throw new DOMException('cannot transfer', 'DataCloneError');
    });
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await expect(s.load('blob:x')).rejects.toThrow(/cannot transfer/);
    const g = fakes(10);
    const t = createSignalsmithStretcher({ audioContext: g.ctx as never, destination: {} as never });
    let second: Promise<void> | null = null;
    g.node.addBuffers.mockImplementationOnce(async () => {
      second = t.load('blob:y');
      return 0; // short: the first load would drop and retry
    });
    await expect(t.load('blob:x')).rejects.toThrow(/superseded/);
    await second;
    // Dropped once per load before its hand-over; the superseded one dropped nothing after the newer one's.
    const drops = g.node.dropBuffers.mock.calls.length;
    const lastAdd = g.node.addBuffers.mock.invocationCallOrder.at(-1)!;
    expect(g.node.dropBuffers.mock.invocationCallOrder.every((o) => o < lastAdd)).toBe(true);
    expect(drops).toBeGreaterThanOrEqual(2);
  });

  it('fades through a fader of its own, from where it is, and cuts when the length is 0 (#366)', async () => {
    const f = fakes();
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    // gains[0] is the volume, gains[1] the fader between the worklet and it.
    const fader = f.gains[1].gain as Record<string, ReturnType<typeof vi.fn>>;
    f.ctx.currentTime = 3;
    s.fade!(0, 1.5);
    expect(fader.linearRampToValueAtTime).toHaveBeenCalledWith(0, 4.5);
    s.fade!(1, 0);
    expect(fader.setValueAtTime).toHaveBeenLastCalledWith(1, 3);
    expect((f.gains[0].gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('two loads at once share one worklet', async () => {
    const f = fakes();
    let made = 0;
    const s = createSignalsmithStretcherWith({ audioContext: f.ctx as never, destination: {} as never }, async () => async () => {
      made++;
      return f.node as unknown as AudioNode;
    });
    await Promise.allSettled([s.load('blob:a'), s.load('blob:b')]);
    expect(made).toBe(1);
  });

  it('a song played to its end stops the worklet', async () => {
    const f = fakes(2);
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    s.play();
    f.ctx.currentTime = 3;
    expect(s.playing()).toBe(false);
    expect(f.schedules.at(-1)).toMatchObject({ active: false });
    expect(s.position()).toBe(2);
  });

  it('a rate change re-anchors at the old rate, then schedules the new one', async () => {
    const f = fakes();
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    s.play();
    f.ctx.currentTime = 1;
    s.setRate(2);
    expect(f.schedules.at(-1)).toMatchObject({ rate: 2, output: 1 });
    f.ctx.currentTime = 1.5;
    expect(s.position()).toBeCloseTo(1 + 0.5 * 2, 9);
  });

  it('seeks, pauses where it is, and restarts from the top once it has ended', async () => {
    const f = fakes(4);
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    s.seek?.(3);
    expect(f.schedules.at(-1)).toMatchObject({ input: 3 });
    s.play();
    f.ctx.currentTime = 0.5;
    s.pause();
    expect(f.schedules.at(-1)).toMatchObject({ active: false });
    expect(s.position()).toBeCloseTo(3.5, 9);
    s.play();
    f.ctx.currentTime = 2;
    expect(s.ended()).toBe(true);
    expect(s.playing()).toBe(false);
    s.play();
    expect(f.schedules.at(-1)).toMatchObject({ active: true, input: 0 });
  });

  it('falls back to the media element when the worklet never says it is ready (WebAssembly refused inside it)', async () => {
    vi.useFakeTimers();
    try {
      const f = fakes();
      const s = createSignalsmithStretcherWith({ audioContext: f.ctx as never, destination: {} as never }, async () => () => new Promise<AudioNode>(() => {}));
      const loading = s.load('blob:x');
      await vi.advanceTimersByTimeAsync(9000);
      await loading;
      expect(h.element).toHaveBeenCalledTimes(1);
      expect(s.position()).toBe(42);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the media element where the worklet cannot start', async () => {
    fakes();
    h.fail = true;
    const s = createSignalsmithStretcher({ audioContext: fakes().ctx as never, destination: {} as never });
    await s.load('blob:x');
    expect(h.element).toHaveBeenCalledTimes(1);
    expect(s.position()).toBe(42);
  });
});
