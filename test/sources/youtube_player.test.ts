// @vitest-environment jsdom
/**
 * The YouTube player behind the embed shape, against a stand-in for YouTube's IFrame API (the real
 * one is a script from YouTube): ready, the rates rounded to the video's own, the volume and rate
 * sent only when they change, the pause lead and seek granularity measured, and YouTube's refusal
 * in words.
 */
import { describe, it, expect, vi } from 'vitest';
import { createYouTubePlayer } from '@thoremin/sources/embeds/youtube_player';
import type { MediaItem } from '@thoremin/sources';

const item: MediaItem = { source: 'youtube', id: 'dQw4w9WgXcQ', title: 'A video', rights: 'embed_only', media: { kind: 'embed', embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ' } };

function fakeYT(opts: { error?: number } = {}) {
  const calls: string[] = [];
  let events: Record<string, (e: { data: number }) => void> = {};
  let time = 0;
  class Player {
    constructor(_el: HTMLElement, o: { events: typeof events }) {
      events = o.events;
      queueMicrotask(() => (opts.error ? events.onError({ data: opts.error }) : (events as unknown as { onReady: () => void }).onReady()));
    }
    playVideo() {
      calls.push('play');
      events.onStateChange({ data: 1 });
    }
    pauseVideo() {
      calls.push('pause');
      queueMicrotask(() => events.onStateChange({ data: 2 }));
    }
    seekTo(s: number) {
      calls.push(`seek:${s}`);
      time = Math.floor(s);
      events.onStateChange({ data: 1 });
    }
    setPlaybackRate(r: number) {
      calls.push(`rate:${r}`);
      events.onPlaybackRateChange({ data: r });
    }
    getAvailablePlaybackRates = () => [0.5, 1, 1.5, 2];
    setVolume(v: number) {
      calls.push(`volume:${v}`);
    }
    getCurrentTime = () => time;
    getDuration = () => 212;
    getPlayerState = () => 1;
    destroy() {
      calls.push('destroy');
    }
  }
  const win = Object.assign(window, { YT: { Player } }) as never;
  return { win, calls, setTime: (t: number) => (time = t) };
}

describe('the YouTube player', () => {
  it('drives YouTube\'s player and measures what it cannot know in advance', async () => {
    const { win, calls } = fakeYT();
    const p = createYouTubePlayer(document.createElement('div'), item, win);
    await p.ready;
    expect(p.durationS()).toBe(212);
    expect(p.capabilities.rate).toEqual({ min: 0.5, max: 2, steps: [0.5, 1, 1.5, 2] });
    expect(p.setRate!(1.2)).toBe(1);
    expect(p.setRate!(1.3)).toBe(1.5);
    expect(p.setRate!(1.4)).toBe(1.5);
    p.setVolume!(0.5);
    p.setVolume!(0.5);
    p.play();
    expect(p.playing()).toBe(true);
    p.seek!(30.4);
    expect(p.capabilities.seekGranularity).toEqual({ s: expect.closeTo(0.4, 6), source: 'measured' });
    p.pause();
    await Promise.resolve();
    expect(p.playing()).toBe(false);
    expect(p.capabilities.pauseLead?.source).toBe('measured');
    expect(calls).toEqual(['rate:1.5', 'volume:50', 'play', 'seek:30.4', 'pause']);
    p.dispose();
    expect(calls.at(-1)).toBe('destroy');
  });

  it('says in words why a video cannot be embedded', async () => {
    const { win } = fakeYT({ error: 150 });
    const p = createYouTubePlayer(document.createElement('div'), item, win);
    await expect(p.ready).rejects.toThrow('A video cannot be played here: its owner does not allow it to be played on other sites');
  });

  it('reads the position from YouTube and extrapolates between its reports', async () => {
    const { win, setTime } = fakeYT();
    const p = createYouTubePlayer(document.createElement('div'), item, win);
    await p.ready;
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1000);
    p.play();
    setTime(10);
    expect(p.position()).toBe(10);
    now.mockReturnValue(1100);
    expect(p.position()).toBeCloseTo(10.1, 6);
    now.mockRestore();
  });
});
