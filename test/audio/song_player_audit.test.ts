/**
 * Adversarial audit of the song slice (2026-10-20 review lane). The song player: real-time
 * output at any clock speed but 1 must go silent (Boundary B, like the synth), and the
 * stretcher must be paused, not left playing at wall-clock rate while the node reports
 * nothing. The Signalsmith stretcher: a worklet whose processor dies mid-song must hand the
 * song to the media element at the position it reached, not play silence as "Playing".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NodeContext, NodeHandlers, PortValues } from '@thoremin/dag';
import { trackSongGrid, type SongGrid } from '@thoremin/ictus';
import { songPlayerNode, type SongHandle, type Stretcher } from '@/slices/song/nodes/song_player';
import { renderClickTrack, SR } from '../helpers/clicks';
import { SONG } from '../helpers/extensions';

const h = vi.hoisted(() => ({ element: vi.fn(), elementLog: [] as string[] }));
vi.mock('@/slices/song/app/song_stretcher', () => ({
  createMediaElementStretcher: (...a: unknown[]) => {
    h.element(...a);
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

function fakeStretcher() {
  const log: string[] = [];
  let playing = false;
  const s: Stretcher & { log: string[] } = {
    log,
    load: async (url) => void log.push(`load:${url}`),
    play: () => {
      log.push('play');
      playing = true;
    },
    pause: () => {
      if (playing) log.push('pause');
      playing = false;
    },
    setRate: () => {},
    setVolume: () => {},
    position: () => 0,
    playing: () => playing,
    ended: () => false,
    dispose: () => log.push('dispose'),
  };
  return s;
}

async function drive(node: NodeHandlers, frames: { ports: PortValues; timeScale: number }[], st: Stretcher) {
  const out: PortValues[] = [];
  for (let i = 0; i < frames.length; i++) {
    const ctx: NodeContext = { tick: i, time: i / 30, dt: i === 0 ? 0 : 1 / 30, resources: { audioContext: {}, masterGain: {}, createStretcher: () => st, timeScale: frames[i]!.timeScale } };
    out.push(node.process(frames[i]!.ports, ctx));
    await Promise.resolve();
    await Promise.resolve();
  }
  return out;
}

const grid: SongGrid = trackSongGrid(renderClickTrack({ bpm: 120, seconds: 4 }).samples, { sampleRate: SR });
const song: SongHandle = { id: 's1', name: 's1.mp3', url: 'blob:s1', durationS: 4, grid };

describe.runIf(SONG)('song-player at a clock speed other than real time', () => {
  it('pauses the stretcher it was playing, like every other real-time output goes silent', async () => {
    const st = fakeStretcher();
    const node = songPlayerNode.make(songPlayerNode.params.parse({}));
    const out = await drive(
      node,
      [
        { ports: { song }, timeScale: 1 },
        { ports: { song, playing: true }, timeScale: 1 },
        { ports: { song, playing: true }, timeScale: 1 },
        { ports: { song, playing: true }, timeScale: 2 },
      ],
      st,
    );
    expect(st.log).toEqual(['load:blob:s1', 'play', 'pause']);
    expect(st.playing()).toBe(false);
    expect((out[3]!.status as { phase: string }).phase).toBe('unavailable');
  });
});

describe.runIf(SONG)('the Signalsmith stretcher when its processor dies mid-song', () => {
  beforeEach(() => {
    h.element.mockClear();
    h.elementLog.length = 0;
    globalThis.fetch = (async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })) as unknown as typeof fetch;
  });

  it('hands the song to the media element at the position it reached and keeps playing', async () => {
    const ctx = {
      currentTime: 0,
      createGain: () => ({ gain: { value: 1, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }),
      decodeAudioData: async () => ({ numberOfChannels: 1, length: 4, duration: 10, getChannelData: () => new Float32Array(4) }),
    };
    const node: Record<string, unknown> = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      schedule: vi.fn(),
      addBuffers: vi.fn(async () => 10),
      dropBuffers: vi.fn(async () => ({})),
      onprocessorerror: null,
    };
    const load = async (): Promise<SignalsmithFactory> => async () => node as unknown as AudioNode;
    const s = createSignalsmithStretcherWith({ audioContext: ctx as never, destination: {} as never }, load);
    await s.load('blob:song');
    s.play();
    ctx.currentTime = 3;
    expect(s.position()).toBeCloseTo(3, 6);
    // The processor throws: Web Audio renders silence from here on and tells the node once.
    expect(typeof node.onprocessorerror).toBe('function');
    (node.onprocessorerror as (ev: Event) => void)(new Event('processorerror'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.element).toHaveBeenCalledTimes(1);
    expect(h.elementLog).toEqual(['load:blob:song', 'seek:3', 'play']);
    expect(s.playing()).toBe(true);
    expect(s.position()).toBe(3);
  });
});
