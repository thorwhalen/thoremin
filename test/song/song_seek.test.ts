/**
 * The song player's `seek` input (a playback session's seek, `src/slices/song/app/sources.ts`):
 * acted on once per id, only once the song is playable (a seek asked for while it loads is kept
 * for then), clamped to the song; the store clears the request with the song it was about.
 */
import { describe, it, expect } from 'vitest';
import type { NodeContext, NodeHandlers, PortValues } from '@thoremin/dag';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { songPlayerNode, type SongHandle, type Stretcher } from '@/slices/song/nodes/song_player';
import { SONG } from '../helpers/extensions';

function seekable() {
  const seeks: number[] = [];
  let pos = 0;
  const s: Stretcher & { seeks: number[] } = {
    seeks,
    load: async () => {
      pos = 0;
    },
    play() {},
    pause() {},
    setRate() {},
    setVolume() {},
    position: () => pos,
    playing: () => false,
    ended: () => false,
    seek: (p) => {
      seeks.push(p);
      pos = p;
    },
    dispose() {},
  };
  return s;
}

const AUDIO = { audioContext: {}, masterGain: {} };
const song = (id: string): SongHandle => ({ id, name: id, url: `blob:${id}`, durationS: 30, grid: EMPTY_SONG_GRID });

async function drive(h: NodeHandlers, frames: PortValues[], st: Stretcher) {
  const out: PortValues[] = [];
  for (let i = 0; i < frames.length; i++) {
    const ctx: NodeContext = { tick: i, time: i / 30, dt: i ? 1 / 30 : 0, resources: { ...AUDIO, createStretcher: () => st } };
    out.push(h.process(frames[i], ctx));
    await Promise.resolve();
    await Promise.resolve();
  }
  return out;
}

describe.runIf(SONG)('song-player seek', () => {
  const make = () => songPlayerNode.make(songPlayerNode.params.parse({}));

  it('moves the song once per request, after it has loaded, clamped to its length', async () => {
    const st = seekable();
    const a = song('a');
    const out = await drive(make(), [
      { song: a, seek: { id: 1, positionS: 12 } }, // still loading: waits
      { song: a, seek: { id: 1, positionS: 12 } },
      { song: a, seek: { id: 1, positionS: 12 } }, // the same request again: nothing
      { song: a, seek: { id: 2, positionS: 99 } },
      { song: a, seek: { id: 3, positionS: -4 } },
    ], st);
    expect(st.seeks).toEqual([12, 30, 0]);
    expect(out[2].position).toBe(12);
  });

  it('a new song acts on the request on its port once it is playable (the store clears an old one)', async () => {
    const st = seekable();
    await drive(make(), [
      { song: song('a'), seek: { id: 1, positionS: 5 } },
      { song: song('a'), seek: { id: 1, positionS: 5 } },
      { song: song('b'), seek: { id: 2, positionS: 7 } },
      { song: song('b'), seek: { id: 2, positionS: 7 } },
    ], st);
    expect(st.seeks).toEqual([5, 7]);
  });

  it('ignores a malformed request', async () => {
    const st = seekable();
    const a = song('a');
    await drive(make(), [{ song: a }, { song: a, seek: { id: 1, positionS: Number.NaN } }, { song: a, seek: { positionS: 3 } }], st);
    expect(st.seeks).toEqual([]);
  });
});
