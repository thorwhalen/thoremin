/**
 * The song player drives a song's own embedded player (`SongHandle.player`) the way it drives the
 * stretcher: load, transport, rate (and reports the rate the provider applied), seek, position into
 * `songTime`; switching to another song pauses it; the node never disposes it (its session does).
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext, NodeHandlers, PortValues } from '@thoremin/dag';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { songPlayerNode, type SongHandle, type Stretcher } from '@/slices/song/nodes/song_player';
import { SONG } from '../helpers/extensions';

function fake(name: string, steps?: number[]) {
  const log: string[] = [];
  let playing = false;
  let applied = 1;
  let pos = 0;
  const s: Stretcher & { log: string[]; advance(dt: number): void } = {
    log,
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
    setVolume() {},
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
