/**
 * The song slice's status hook (#983): the host builds its sink once per engine, while the
 * `song-player` node may leave the graph and come back under it. The hook's sink starts afresh
 * after every reset, so a player that returns with the status it left with is shown again rather
 * than staying absent behind a change gate that still remembers it.
 */
import { describe, expect, it } from 'vitest';
import type { LoadStatus } from '@thoremin/lazy';
import { SONG } from '../helpers/extensions';

describe.runIf(SONG)('the song status hook', () => {
  it('reports a player removed and re-added with the same status, after removal and after reset', async () => {
    const { SONG_UI } = await import('@/slices/song/ui');
    const { ABSENT_SONG_STATUS, SONG_NODE_ID, useSongStatus } = await import('@/slices/song/app/songStatus');
    const [hook] = SONG_UI.statusHooks;
    expect(hook.nodeId).toBe(SONG_NODE_ID);
    const ready: LoadStatus = { phase: 'ready', message: 'Ready' };
    let status: LoadStatus | undefined = ready;
    const engine = { getOutput: (node: string, port: string) => (node === SONG_NODE_ID && port === 'status' ? status : undefined) };
    const sink = hook.make(engine, () => ({}));
    sink(0);
    expect(useSongStatus.getState().status).toBe(ready);
    hook.onRemoved();
    status = undefined;
    sink(1);
    expect(useSongStatus.getState().status).toBe(ABSENT_SONG_STATUS);
    status = ready;
    sink(2);
    expect(useSongStatus.getState().status).toBe(ready);
    hook.reset();
    sink(3);
    expect(useSongStatus.getState().status).toBe(ready);
  });
});
