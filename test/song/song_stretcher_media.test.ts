/**
 * The media-element stretcher (`createMediaElementStretcher`, #186 PR G): the song player's
 * fallback when Signalsmith Stretch cannot start, and before #187 PR 7 its only one. The node's
 * tests inject their own stretcher, so the browser half was untested. Driven here over a fake
 * `<audio>` element (a stubbed `document`) and the recording fake of the Web Audio graph: pitch
 * preserved, the routing (element -> fader -> volume -> destination), a load that settles on
 * `canplay` or `loadedmetadata` and fails on `error` or when superseded, play refused by the
 * autoplay policy reported as blocked, the unlock in a click, rate and seek guarded against
 * nonsense, the hold fade and the volume, and dispose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaElementStretcher } from '@/slices/song/app/song_stretcher';
import type { Stretcher } from '@/slices/song/nodes/song_player.schema';
import { fakeAudio, param, type FakeNode } from '../helpers/fakeAudio';
import { SONG } from '../helpers/extensions';

type Listener = () => void;

class FakeAudioElement {
  preload = '';
  preservesPitch = false;
  muted = false;
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  playbackRate = 1;
  listeners = new Map<string, Set<Listener>>();
  playResult: () => Promise<void> = () => Promise.resolve();
  load = vi.fn();
  pause = vi.fn(() => {
    this.paused = true;
  });
  play = vi.fn(() => {
    this.paused = false;
    return this.playResult();
  });
  removeAttribute = vi.fn((name: string) => {
    if (name === 'src') this.src = '';
  });
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  fire(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}

function setup() {
  const el = new FakeAudioElement();
  vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'audio' ? el : null) });
  const fa = fakeAudio({ currentTime: 2 });
  const destination = { kind: 'destination' } as unknown as AudioNode;
  const s = createMediaElementStretcher({ audioContext: fa.ac, destination } as never) as Required<Stretcher>;
  const [gain, fader] = fa.of('Gain');
  const [source] = fa.of('MediaElementSource');
  return { el, fa, s, gain, fader, source, destination };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.runIf(SONG)('the media-element stretcher', () => {
  it('preserves pitch and routes the element through the fader and the volume into the destination', () => {
    const { el, gain, fader, source, destination } = setup();
    expect(el.preservesPitch).toBe(true);
    expect(el.preload).toBe('auto');
    expect((source as FakeNode & { mediaElement: unknown }).mediaElement).toBe(el);
    expect(source.connections).toEqual([fader]);
    expect(fader.connections).toEqual([gain]);
    expect(gain.connections).toEqual([destination]);
  });

  it.each(['canplay', 'loadedmetadata'])('a load resolves on %s and leaves no listener behind', async (event) => {
    const { el, s } = setup();
    const p = s.load('song.mp3');
    expect(el.src).toBe('song.mp3');
    expect(el.pause).toHaveBeenCalled();
    expect(el.load).toHaveBeenCalledOnce();
    el.fire(event);
    await expect(p).resolves.toBeUndefined();
    expect(el.count()).toBe(0);
  });

  it('a load that cannot be decoded rejects', async () => {
    const { el, s } = setup();
    const p = s.load('bad.mp3');
    el.fire('error');
    await expect(p).rejects.toThrow('the song could not be decoded');
    expect(el.count()).toBe(0);
  });

  it('a newer load settles the older one as a failure', async () => {
    const { el, s } = setup();
    const first = s.load('a.mp3');
    const second = s.load('b.mp3');
    await expect(first).rejects.toThrow();
    el.fire('canplay');
    await expect(second).resolves.toBeUndefined();
    expect(el.count()).toBe(0);
  });

  it('plays and pauses; playing is neither paused nor ended', () => {
    const { el, s } = setup();
    s.play();
    expect(s.playing()).toBe(true);
    el.ended = true;
    expect(s.playing()).toBe(false);
    expect(s.ended()).toBe(true);
    s.pause();
    expect(el.paused).toBe(true);
    expect(s.playing()).toBe(false);
  });

  it('a play the autoplay policy refuses is reported as blocked; any other failure is not', async () => {
    const { el, s } = setup();
    el.playResult = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    s.play();
    await flush();
    expect(s.blocked()).toBe(true);
    // A new play clears it until the browser says otherwise.
    el.playResult = () => Promise.reject(new DOMException('aborted', 'AbortError'));
    s.play();
    expect(s.blocked()).toBe(false);
    await flush();
    expect(s.blocked()).toBe(false);
  });

  it('a refusal that lands after a pause is not reported', async () => {
    const { el, s } = setup();
    let refuse: (e: unknown) => void = () => {};
    el.playResult = () => new Promise((_ok, no) => (refuse = no));
    s.play();
    s.pause();
    refuse(new DOMException('no gesture', 'NotAllowedError'));
    await flush();
    expect(s.blocked()).toBe(false);
  });

  it('unlock (in a click) plays muted, then pauses again unless playback was asked for meanwhile', async () => {
    const { el, s } = setup();
    s.unlock();
    expect(el.play).not.toHaveBeenCalled(); // nothing loaded yet
    el.src = 'song.mp3';
    s.unlock();
    expect(el.muted).toBe(true);
    await flush();
    expect(el.muted).toBe(false);
    expect(el.paused).toBe(true);

    const other = setup();
    other.el.src = 'song.mp3';
    other.s.unlock();
    other.s.play();
    await flush();
    expect(other.el.paused).toBe(false);
    expect(other.el.muted).toBe(false);

    const refused = setup();
    refused.el.src = 'song.mp3';
    refused.el.playResult = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    refused.s.unlock();
    await flush();
    expect(refused.el.muted).toBe(false);

    const playing = setup();
    playing.el.src = 'song.mp3';
    playing.el.paused = false;
    playing.s.unlock();
    expect(playing.el.play).not.toHaveBeenCalled();
  });

  it('sets a sensible rate only, and only when it changes', () => {
    const { el, s } = setup();
    s.setRate(1.25);
    expect(el.playbackRate).toBe(1.25);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) s.setRate(bad);
    expect(el.playbackRate).toBe(1.25);
  });

  it('seeks to a sensible position only, and reports where it is', () => {
    const { el, s } = setup();
    s.seek(12.5);
    expect(s.position()).toBe(12.5);
    for (const bad of [-1, Number.NaN]) s.seek(bad);
    expect(el.currentTime).toBe(12.5);
  });

  it('fades the fader from where it is and sets the volume only on a change', () => {
    const { s, fader, gain } = setup();
    s.fade(0, 0.5);
    expect(param(fader, 'gain').calls).toEqual([
      ['cancel', 2],
      ['set', 0, 2],
      ['linear', 0, 2.5],
    ]);
    s.setVolume(1);
    expect(param(gain, 'gain').calls).toEqual([]);
    s.setVolume(0.4);
    s.setVolume(0.4);
    expect(param(gain, 'gain').calls).toEqual([['target', 0.4, 2, 0.03]]);
  });

  it('dispose abandons a load, empties the element and disconnects its nodes', async () => {
    const { el, s, source, fader, gain } = setup();
    const p = s.load('a.mp3');
    s.dispose();
    await expect(p).rejects.toThrow();
    expect(el.removeAttribute).toHaveBeenCalledWith('src');
    expect(el.load).toHaveBeenCalledTimes(2);
    for (const n of [source, fader, gain]) expect(n.disconnected).toBe(1);
  });
});
