// @vitest-environment jsdom
/**
 * The embed-only rule, end to end: a YouTube link opened in the Song tool plays in YouTube's own
 * player, visible in its window, and while it is the active session nothing listens. The audio
 * hub (the listening games and the analysers) closes its input with the reason, the chord map's
 * microphone never opens and says why, the games' notice says why; closing the player opens the
 * gate again. YouTube's IFrame API is a stand-in (the real one is YouTube's script).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAudioInputHub, type ContextLike, type HubDeps } from '@thoremin/sdk-ui/audio/hub';
import { listeningRefusal } from '@thoremin/sdk-ui/listening';
import { micNotice } from '@thoremin/games/listen';
import { startMicChordIn } from '@thoremin/ext-harmony/app/micChordIn';
import { describeChordMapLive } from '@thoremin/ext-harmony/app/chordMapStatus';
import { activeSession, analysisRefusal, closeMedia, openInput, useActiveSession } from '@/slices/song/app/sources';
import { setSongHandle, songHandle, songPlaying } from '@/slices/song/app/state';
import { SONG } from '../helpers/extensions';
import '@/app/store';
import '@/slices/song/app/host';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function standInYouTube() {
  class Player {
    events: Record<string, (e?: { data: number }) => void>;
    constructor(el: HTMLElement, o: { events: Record<string, (e?: { data: number }) => void> }) {
      this.events = o.events;
      const frame = document.createElement('iframe');
      frame.title = 'YouTube video player';
      el.appendChild(frame);
      queueMicrotask(() => this.events.onReady());
    }
    playVideo() {
      this.events.onStateChange({ data: 1 });
    }
    pauseVideo() {
      this.events.onStateChange({ data: 2 });
    }
    seekTo() {}
    setPlaybackRate() {}
    getAvailablePlaybackRates = () => [0.25, 0.5, 1, 1.5, 2];
    setVolume() {}
    getCurrentTime = () => 0;
    getDuration = () => 180;
    getPlayerState = () => -1;
    destroy() {}
  }
  (window as unknown as { YT: unknown }).YT = { Player };
}

function hubFakes() {
  let opens = 0;
  let closes = 0;
  const ctx: ContextLike = { sampleRate: 48000, currentTime: 1, state: 'running' };
  const deps: HubDeps = {
    audio: () => ctx,
    destination: () => 'master',
    makeNode: async () => ({ port: { postMessage: () => undefined, onmessage: null }, connect: () => undefined, disconnect: () => undefined }),
    open: async () => {
      opens++;
      return { source: { connect: () => undefined, disconnect: () => undefined }, close: () => void closes++ };
    },
  };
  return { deps, opens: () => opens, closes: () => closes };
}

beforeEach(() => {
  setSongHandle(null);
  useActiveSession.setState({ session: null });
  standInYouTube();
});
afterEach(() => {
  closeMedia();
  document.body.innerHTML = '';
});

describe.runIf(SONG)('embed-only: visible, never listened to', () => {
  it('a YouTube link plays in YouTube\'s player, in its own visible window', async () => {
    const session = await openInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const win = document.querySelector('[data-testid="embed-player"]') as HTMLElement;
    expect(win).toBeTruthy();
    expect(win.getAttribute('aria-label')).toBe('YouTube player');
    expect(win.querySelector('iframe')?.title).toBe('YouTube video player');
    expect(win.style.display).not.toBe('none');
    expect(win.style.position).toBe('fixed');
    expect(songHandle()?.player).toBeTruthy();
    expect(songHandle()?.durationS).toBe(180);
    expect(activeSession()).toBe(session);
    expect(session.item.rights).toBe('embed_only');
    // The transport goes through the song's, so the song player drives YouTube's.
    session.play();
    expect(songPlaying()).toBe(true);
    // Its own Close button ends it, window and all.
    (win.querySelector('button') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="embed-player"]')).toBeNull();
    expect(songHandle()).toBeNull();
    expect(activeSession()).toBeNull();
  });

  it('while it plays, the hub, the chord map\'s microphone and the games refuse, saying why; closing opens the gate again', async () => {
    const f = hubFakes();
    const hub = createAudioInputHub(f.deps);
    hub.acquire({ analysers: [{ name: 'pitch' }] });
    await flush();
    expect(hub.status().state).toBe('live');
    expect(f.opens()).toBe(1);

    await openInput('https://youtu.be/dQw4w9WgXcQ');
    await flush();
    const reason = 'Listening is off while YouTube video dQw4w9WgXcQ plays from YouTube';
    expect(analysisRefusal()).toBe(reason);
    expect(listeningRefusal()).toBe(reason);
    expect(hub.status()).toMatchObject({ state: 'refused', error: reason });
    expect(f.closes()).toBe(1);
    // A new lease while it plays opens nothing.
    hub.acquire({ analysers: [{ name: 'onset' }] });
    await flush();
    expect(f.opens()).toBe(1);

    // The chord map following the microphone: never opened, and its readout says why.
    const open = vi.fn(async () => ({ sampleRate: 48000, fftSize: 8192, read: () => new Float32Array(4096), close() {} }));
    const heard: unknown[] = [];
    const stop = startMicChordIn({
      store: { getState: () => ({ chordMap: { enabled: true, follow: 'audio' } }), subscribe: () => () => {} },
      publish: (h) => heard.push(h),
      open,
      every: () => () => {},
    });
    expect(open).not.toHaveBeenCalled();
    expect(heard.at(-1)).toMatchObject({ reason: 'refused' });
    expect(describeChordMapLive({ enabled: true, signs: 'off', midi: 'off', audio: 'refused', chord: null } as never)).toMatch(/^Listening is off while a streaming player plays/);
    // The listening games' notice on the stage.
    expect(micNotice('refused')).toBe('Listening is off while a streaming player plays: close it to play.');

    closeMedia();
    await flush();
    expect(listeningRefusal()).toBeNull();
    expect(hub.status().state).toBe('live');
    expect(f.opens()).toBe(2);
    expect(open).toHaveBeenCalledTimes(1);
    stop();
  });

  it('owned audio never shuts the gate', async () => {
    const clicks = new Float32Array(22050);
    const file = Object.assign(new Blob([new Uint8Array(8)]), { name: 'a.wav', arrayBuffer: async () => new ArrayBuffer(8) });
    await openInput(file, { analyze: { decode: async () => ({ channels: [clicks], durationS: 1 }), makeUrl: () => 'blob:a' } });
    expect(listeningRefusal()).toBeNull();
  });
});
