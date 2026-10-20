/**
 * Adversarial audit of the Signalsmith stretcher's hand-over (2026-10-20 review, after #762): a
 * processor that dies WHILE the song is still loading. The hand-over to the media element ran,
 * but the load went on waiting for the dead worklet's reply (`dropBuffers`, `addBuffers`), which
 * never comes, so the song player's status stayed "Loading..." for good and the song the media
 * element now held was never played. A load waiting on the worklet gives up the moment the
 * processor dies and settles with the media element's hand-over instead.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SONG } from '../helpers/extensions';

const h = vi.hoisted(() => ({ elementLog: [] as string[] }));
vi.mock('@/slices/song/app/song_stretcher', () => ({
  createMediaElementStretcher: () => {
    let pos = 0;
    let playing = false;
    return {
      load: async (url: string) => void h.elementLog.push(`load:${url}`),
      play() {
        playing = true;
        h.elementLog.push('play');
      },
      pause() {
        playing = false;
      },
      setRate() {},
      setVolume() {},
      seek(p: number) {
        pos = p;
        h.elementLog.push(`seek:${p}`);
      },
      position: () => pos,
      playing: () => playing,
      ended: () => false,
      dispose() {},
    };
  },
}));
import { createSignalsmithStretcherWith, type SignalsmithFactory } from '@/slices/song/app/song_stretcher_signalsmith';

const gainNode = () => ({ gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });
const decoded = () => ({ numberOfChannels: 1, length: 4, duration: 10, getChannelData: () => new Float32Array(4) });

/** A worklet whose replies stop coming once `dead` (a processor that threw answers nothing). */
function deadlyWorklet() {
  const state = { dead: false };
  const node: Record<string, unknown> = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    schedule: vi.fn(),
    addBuffers: vi.fn(() => (state.dead ? new Promise<number>(() => {}) : Promise.resolve(10))),
    dropBuffers: vi.fn(() => (state.dead ? new Promise<unknown>(() => {}) : Promise.resolve({}))),
    onprocessorerror: null,
  };
  const die = () => {
    state.dead = true;
    (node.onprocessorerror as (ev: Event) => void)(new Event('processorerror'));
  };
  const load = async (): Promise<SignalsmithFactory> => async () => node as unknown as AudioNode;
  return { node, die, load };
}

const settle = <T,>(p: Promise<T>, ms = 300): Promise<string> => Promise.race([p.then(() => 'ok', (e) => `rejected: ${String(e)}`), new Promise<string>((r) => setTimeout(() => r('hung'), ms))]);

describe.runIf(SONG)('the Signalsmith stretcher when its processor dies while the song is loading', () => {
  beforeEach(() => {
    h.elementLog.length = 0;
    globalThis.fetch = (async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
  });

  it('while decoding: the load settles once the media element has the song, and plays it on play()', async () => {
    let finishDecode: () => void = () => {};
    let decoding = false;
    const ctx = {
      currentTime: 0,
      createGain: gainNode,
      decodeAudioData: () => {
        decoding = true;
        return new Promise<unknown>((r) => {
          finishDecode = () => r(decoded());
        });
      },
    };
    const w = deadlyWorklet();
    const s = createSignalsmithStretcherWith({ audioContext: ctx as never, destination: {} as never }, w.load);
    const loading = s.load('blob:song');
    for (let i = 0; i < 20 && !decoding; i++) await Promise.resolve();
    expect(decoding).toBe(true);
    w.die();
    finishDecode();
    expect(await settle(loading)).toBe('ok');
    expect(h.elementLog).toEqual(['load:blob:song', 'seek:0']);
    s.play();
    expect(h.elementLog.at(-1)).toBe('play');
    expect(s.playing()).toBe(true);
  });

  it('while the song is being handed to the worklet: the same', async () => {
    const ctx = { currentTime: 0, createGain: gainNode, decodeAudioData: async () => decoded() };
    const w = deadlyWorklet();
    let handingOver: () => void = () => {};
    const addBuffers = w.node.addBuffers as ReturnType<typeof vi.fn>;
    addBuffers.mockImplementationOnce(() => new Promise<number>(() => handingOver()));
    const s = createSignalsmithStretcherWith({ audioContext: ctx as never, destination: {} as never }, w.load);
    const reached = new Promise<void>((r) => {
      handingOver = r;
    });
    const loading = s.load('blob:song');
    await reached;
    w.die();
    expect(await settle(loading)).toBe('ok');
    expect(h.elementLog).toEqual(['load:blob:song', 'seek:0']);
  });

  it('a load superseded before the processor died does not resolve as the new song', async () => {
    const ctx = { currentTime: 0, createGain: gainNode, decodeAudioData: async () => decoded() };
    const w = deadlyWorklet();
    let handingOver: () => void = () => {};
    (w.node.addBuffers as ReturnType<typeof vi.fn>).mockImplementationOnce(() => new Promise<number>(() => handingOver()));
    const s = createSignalsmithStretcherWith({ audioContext: ctx as never, destination: {} as never }, w.load);
    const reached = new Promise<void>((r) => {
      handingOver = r;
    });
    const first = s.load('blob:one');
    await reached;
    const second = s.load('blob:two'); // supersedes the first; the worklet is still up, so it waits on it
    w.die();
    expect(await settle(first)).toMatch(/superseded/);
    expect(await settle(second)).toBe('ok');
    // The media element holds the second song and never saw the first (loading the same url
    // twice, once by the hand-over and once by the superseding load, is harmless).
    expect(h.elementLog).not.toContain('load:blob:one');
    expect(h.elementLog.filter((e) => e === 'load:blob:two').length).toBeGreaterThan(0);
    expect(h.elementLog.at(-1)).toBe('seek:0');
  });
});
