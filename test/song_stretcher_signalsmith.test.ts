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
vi.mock('@/nodes/output/song_stretcher', () => ({
  createMediaElementStretcher: (...a: unknown[]) => {
    h.element(...a);
    return { load: async () => {}, play() {}, pause() {}, setRate() {}, setVolume() {}, position: () => 42, playing: () => true, ended: () => false, dispose() {} };
  },
}));
import { createSignalsmithStretcherWith, type SignalsmithFactory } from '@/nodes/output/song_stretcher_signalsmith';

/** The package, replaced: a node factory that fails like a missing AudioWorklet when asked. */
const load = async (): Promise<SignalsmithFactory> => async () => {
  if (h.fail) throw new Error('no AudioWorklet');
  return h.node as unknown as AudioNode;
};
const createSignalsmithStretcher = (audio: Parameters<typeof createSignalsmithStretcherWith>[0]) => createSignalsmithStretcherWith(audio, load);

function fakes(durationS = 10) {
  const ctx = {
    currentTime: 0,
    createGain: () => ({ gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }),
    decodeAudioData: async () => ({ numberOfChannels: 2, duration: durationS, getChannelData: () => new Float32Array(4) }),
  };
  const schedules: Array<Record<string, unknown>> = [];
  let report: ((t: number) => void) | undefined;
  const node = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    schedule: (c: Record<string, unknown>) => schedules.push(c),
    addBuffers: vi.fn(async () => durationS),
    dropBuffers: vi.fn(async () => ({})),
    setUpdateInterval: async (_s: number, cb: (t: number) => void) => {
      report = cb;
    },
    port: { onmessage: null },
  };
  h.node = node;
  return { ctx, node, schedules, report: (t: number) => report?.(t) };
}

beforeEach(() => {
  h.fail = false;
  h.element.mockClear();
  globalThis.fetch = (async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
});

describe('the Signalsmith stretcher', () => {
  it('loads the decoded song into the worklet, plays, and extrapolates its position at the rate', async () => {
    const f = fakes();
    const s = createSignalsmithStretcher({ audioContext: f.ctx as never, destination: {} as never });
    await s.load('blob:x');
    expect(f.node.addBuffers).toHaveBeenCalledTimes(1);
    expect((f.node.addBuffers.mock.calls[0] as unknown[])[0]).toHaveLength(2);
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
