/**
 * The song player drives a song's own embedded player (`SongHandle.player`) the way it drives the
 * stretcher: load, transport, rate (and reports the rate the provider applied), seek, position into
 * `songTime`; switching to another song pauses it; the node never disposes it (its session does).
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext, NodeHandlers, PortValues } from '@thoremin/dag';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { songPlayerNode, type SongHandle, type Stretcher } from '@/slices/song/nodes/song_player';
import { embedStillSounding, embedStretcher } from '@/slices/song/app/embeds';
import type { EmbedPlayer } from '@thoremin/sources';
import { NO_CONTROL } from '@thoremin/sources';
import { SONG } from '../helpers/extensions';

function fake(name: string, steps?: number[]) {
  const log: string[] = [];
  const volumes: number[] = [];
  let playing = false;
  let applied = 1;
  let pos = 0;
  const s: Stretcher & { log: string[]; volumes: number[]; advance(dt: number): void } = {
    log,
    volumes,
    load: async () => void log.push(`${name}:load`),
    play: () => {
      log.push(`${name}:play`);
      playing = true;
    },
    pause: () => {
      if (playing) log.push(`${name}:pause`);
      playing = false;
    },
    setRate: (r) => {
      applied = steps ? steps.reduce((b, x) => (Math.abs(x - r) < Math.abs(b - r) ? x : b), steps[0]) : r;
    },
    appliedRate: steps ? () => applied : undefined,
    setVolume: (v) => void volumes.push(v),
    position: () => pos,
    seek: (p) => void (pos = p),
    playing: () => playing,
    ended: () => false,
    dispose: () => log.push(`${name}:dispose`),
    advance(dt) {
      if (playing) pos += dt * applied;
    },
  };
  return s;
}

const AUDIO = { audioContext: {}, masterGain: {} };

async function drive(h: NodeHandlers, frames: PortValues[], shared: Stretcher, onTick: () => void = () => {}) {
  const out: PortValues[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (i) onTick();
    const ctx: NodeContext = { tick: i, time: i / 30, dt: i ? 1 / 30 : 0, resources: { ...AUDIO, createStretcher: () => shared } };
    out.push(h.process(frames[i], ctx));
    await Promise.resolve();
    await Promise.resolve();
  }
  return out;
}

describe.runIf(SONG)('song-player and an embedded player', () => {
  const make = () => songPlayerNode.make(songPlayerNode.params.parse({}));

  it('drives the song\'s own player, reports its applied rate, and publishes songTime from its position', async () => {
    const shared = fake('stretcher');
    const yt = fake('yt', [0.5, 1, 1.5, 2]);
    const song: SongHandle = { id: 'e1', name: 'A video', url: 'https://www.youtube.com/embed/x', durationS: 200, grid: EMPTY_SONG_GRID, player: yt };
    const frames: PortValues[] = [{ song }, { song, playing: true, rate: 1.3 }, ...Array.from({ length: 30 }, () => ({ song, playing: true, rate: 1.3 }))];
    const out = await drive(make(), frames, shared, () => yt.advance(1 / 30));
    expect(yt.log.slice(0, 2)).toEqual(['yt:load', 'yt:play']);
    expect(shared.log).toEqual([]);
    expect(out.at(-1)!.rate).toBe(1.5);
    expect(out.at(-1)!.position as number).toBeGreaterThan(1);
    expect((out.at(-1)!.songTime as { t: number }).t).toBeCloseTo(31 / 30, 6);
  });

  it('pauses the embedded player when another song loads, and never disposes it', async () => {
    const shared = fake('stretcher');
    const yt = fake('yt');
    const embed: SongHandle = { id: 'e1', name: 'v', url: 'u', durationS: 200, grid: EMPTY_SONG_GRID, player: yt };
    const file: SongHandle = { id: 'f1', name: 'f', url: 'blob:f', durationS: 10, grid: EMPTY_SONG_GRID };
    const h = make();
    await drive(h, [{ song: embed }, { song: embed, playing: true }, { song: file }, { song: file }], shared);
    expect(yt.log).toEqual(['yt:load', 'yt:play', 'yt:pause']);
    expect(shared.log).toContain('stretcher:load');
    h.dispose?.();
    expect(yt.log).not.toContain('yt:dispose');
  });
});

describe.runIf(SONG)('song-player and an embed whose length arrives late', () => {
  it('a seek is bounded by the player\'s length when the handle had none, and runs with no audio context', async () => {
    const yt = Object.assign(fake('yt'), { durationS: () => 120 });
    const song: SongHandle = { id: 'e2', name: 'v', url: 'u', durationS: 0, grid: EMPTY_SONG_GRID, player: yt };
    const h = songPlayerNode.make(songPlayerNode.params.parse({}));
    const out: PortValues[] = [];
    const frames: PortValues[] = [{ song }, { song, seek: { id: 1, positionS: 75 } }, { song, seek: { id: 2, positionS: 500 } }];
    for (let i = 0; i < frames.length; i++) {
      out.push(h.process(frames[i], { tick: i, time: i / 30, dt: i ? 1 / 30 : 0, resources: {} }));
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(out[1].position).toBe(75);
    expect(out[2].position).toBe(120);
  });
});

describe.runIf(SONG)("the player's mute reaches an embedded player (#939)", () => {
  it('silences the song at its own volume while muted, and gives it back after', async () => {
    const yt = fake('yt');
    const song: SongHandle = { id: 'e3', name: 'v', url: 'u', durationS: 200, grid: EMPTY_SONG_GRID, player: yt };
    const at = { song, playing: true, volume: 0.6 };
    await drive(songPlayerNode.make(songPlayerNode.params.parse({})), [at, { ...at, mute: true }, { ...at, mute: false }], fake('stretcher'));
    expect(yt.volumes).toEqual([0.6, 0, 0.6]);
    // Muting never touches the transport: the song plays on, silent.
    expect(yt.log.filter((l) => l === 'yt:pause')).toEqual([]);
  });

  const player = (volume: boolean, playing = true): EmbedPlayer =>
    ({
      ready: Promise.resolve(),
      capabilities: { ...NO_CONTROL, play: true, volume },
      play() {},
      pause() {},
      position: () => 0,
      durationS: () => 0,
      playing: () => playing,
      ended: () => false,
      on: () => () => {},
      dispose() {},
      ...(volume ? { setVolume() {} } : {}),
    }) as unknown as EmbedPlayer;
  const handle = (p: EmbedPlayer): SongHandle => ({ id: 'e', name: 'v', url: 'u', durationS: 0, grid: EMPTY_SONG_GRID, player: embedStretcher(p) });

  it('an embed with no volume is named by the muted badge while it plays, and only then', () => {
    expect(embedStillSounding({ songHandle: handle(player(false)) })).toBe('embedded player still on');
    expect(embedStillSounding({ songHandle: handle(player(false, false)) })).toBeNull();
    expect(embedStillSounding({ songHandle: handle(player(true)) })).toBeNull();
    // A file plays through the master gain the mute closes: nothing to say.
    expect(embedStillSounding({ songHandle: { id: 'f', name: 'f', url: 'blob:f', durationS: 1, grid: EMPTY_SONG_GRID } })).toBeNull();
    expect(embedStillSounding({ songHandle: null })).toBeNull();
  });
});
