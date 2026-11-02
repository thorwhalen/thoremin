// @vitest-environment jsdom
/**
 * The embedded players' edges (the adversarial review of the embeds PR): windows never cover one
 * another, closing a window while it loads cancels the open, a provider's own buttons move the
 * song's transport, a player's failure is said, a seek is not undone by a stale report, nothing
 * paces an embed, and an embed's length learned after it starts bounds a seek.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EMPTY_SONG_GRID } from '@thoremin/ictus';
import { createPositionClock, type EmbedEvent, type EmbedPlayer, type MediaItem } from '@thoremin/sources';
import '@/app/store';
import '@/slices/song/app/host';
import { createEmbedMount, embedSession, embedSong, useEmbedNotice, EMBED_BOTTOM_PX } from '@/slices/song/app/embeds';
import { closeMedia, songSourceHost, useActiveSession } from '@/slices/song/app/sources';
import { setSongHandle, songHandle, songPlaying, setSongPlaying } from '@/slices/song/app/state';
import { songFollows, songConducted } from '@/slices/song/derive';
import { SONG } from '../helpers/extensions';

const item = (id: string): MediaItem => ({ source: 'youtube', id, title: `video ${id}`, rights: 'embed_only', media: { kind: 'embed', embedUrl: `https://www.youtube.com/embed/${id}` } });

function fakePlayer(opts: { ready?: Promise<void> } = {}) {
  const ls: Record<EmbedEvent, Set<() => void>> = { state: new Set(), ended: new Set(), buffering: new Set(), error: new Set() };
  let playing = false;
  let failure: string | null = null;
  let disposed = false;
  const p: EmbedPlayer & { press(on: boolean): void; fail(why: string): void; disposed(): boolean } = {
    capabilities: { play: true, position: true, seek: true, rate: null, volume: true, pauseLead: null, seekGranularity: null, positionLag: null },
    ready: opts.ready ?? Promise.resolve(),
    play: () => {
      playing = true;
      ls.state.forEach((l) => l());
    },
    pause: () => {
      playing = false;
      ls.state.forEach((l) => l());
    },
    position: () => 0,
    durationS: () => 0,
    playing: () => playing,
    ended: () => false,
    error: () => failure,
    on: (e, l) => {
      ls[e].add(l);
      return () => ls[e].delete(l);
    },
    dispose: () => void (disposed = true),
    press(on) {
      playing = on;
      ls.state.forEach((l) => l());
    },
    fail(why) {
      failure = why;
      ls.error.forEach((l) => l());
    },
    disposed: () => disposed,
  };
  return p;
}

const slots = () => [...document.querySelectorAll<HTMLElement>('[data-testid="embed-player"]')].map((el) => el.style.bottom);

beforeEach(() => {
  setSongHandle(null);
  useActiveSession.setState({ session: null });
  useEmbedNotice.setState({ notice: null });
});
afterEach(() => {
  closeMedia();
  document.body.innerHTML = '';
});

describe.runIf(SONG)('embedded players: the review\'s edges', () => {
  it('a window takes the lowest free slot, above the Tools bar, so none covers another', () => {
    const a = createEmbedMount(item('a'), 'YouTube', () => {});
    const b = createEmbedMount(item('b'), 'YouTube', () => {});
    a.remove();
    const c = createEmbedMount(item('c'), 'YouTube', () => {});
    expect(slots()).toEqual([`${EMBED_BOTTOM_PX + 241}px`, `${EMBED_BOTTOM_PX}px`]);
    b.remove();
    c.remove();
  });

  it('closing a window while its player loads cancels the open and removes it', async () => {
    const player = fakePlayer({ ready: new Promise(() => {}) });
    const opening = songSourceHost().openEmbed!(item('x'), () => player);
    (document.querySelector('[data-testid="embed-player"] button') as HTMLButtonElement).click();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(player.disposed()).toBe(true);
    expect(document.querySelector('[data-testid="embed-player"]')).toBeNull();
    expect(songHandle()).toBeNull();
  });

  it('the provider\'s own Play and Pause move the song\'s transport; its failure is said', async () => {
    const player = fakePlayer();
    const session = await songSourceHost().openEmbed!(item('y'), () => player);
    useActiveSession.setState({ session });
    expect(songPlaying()).toBe(false);
    player.press(true);
    expect(songPlaying()).toBe(true);
    player.press(false);
    expect(songPlaying()).toBe(false);
    setSongPlaying(true);
    player.fail('video y cannot be played here: its owner does not allow it to be played on other sites');
    expect(useEmbedNotice.getState().notice).toMatch(/owner does not allow/);
    closeMedia();
    expect(useEmbedNotice.getState().notice).toBeNull();
  });

  it('nothing paces or conducts an embed (it has no beat)', () => {
    const embed = embedSong(item('z'), fakePlayer());
    const file = { id: 'f', name: 'f', url: 'blob:f', durationS: 1, grid: EMPTY_SONG_GRID };
    expect(songFollows({ songPrefs: { follow: true }, songHandle: embed } as never)).toBe(false);
    expect(songFollows({ songPrefs: { follow: true }, songHandle: file } as never)).toBe(true);
    expect(songConducted({ conductor: { enabled: true, conducts: 'recording', source: 'hands' }, songHandle: embed } as never)).toBe(false);
    // Its length, unknown at open, comes from the player once known.
    expect(embed.durationS).toBe(0);
    expect(embed.player!.durationS?.()).toBe(0);
  });

  it('a seek is not undone by the provider\'s stale report', () => {
    let t = 10;
    const c = createPositionClock(() => t);
    c.setPlaying(true);
    c.report(42);
    c.seek(90, 42);
    c.report(42); // the provider has not caught up: still the old value
    t += 0.5;
    expect(c.read()).toBeCloseTo(90.5, 9);
    c.report(90.6);
    expect(c.read()).toBeCloseTo(90.6, 9);
  });

  it('a session over an embed is closed with its window', async () => {
    const player = fakePlayer();
    const mount = createEmbedMount(item('w'), 'YouTube', () => {});
    const song = embedSong(item('w'), player);
    setSongHandle(song);
    const s = embedSession(item('w'), song, player, mount);
    s.close();
    expect(player.disposed()).toBe(true);
    expect(document.querySelector('[data-testid="embed-player"]')).toBeNull();
    expect(songHandle()).toBeNull();
  });
});
