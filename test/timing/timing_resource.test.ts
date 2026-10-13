/**
 * The app's timing resource (`src/app/timing/resource.ts`, #391 item 4): the browser glue
 * around the tracker. The audio epoch moves on a `devicechange` (an AirPods connect) and
 * on the bound context's `statechange`; a second context (a rebuilt engine) is bound in
 * the first one's place, so the old context's events no longer count; `dispose()` lets go
 * of both listeners. `cameraSettingsOf` reads nothing from a missing stream or a track
 * without `getSettings`. Fakes: an `EventTarget` for the device list and for the context.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NodeContext } from '@thoremin/dag';
import { createTimingResource, cameraSettingsOf, type TimingResource } from '@/app/timing/resource';

const RUNTIME = { crossOriginIsolated: false, timerResolution: 0.001 };

/** An `AudioContext`-shaped event target: enough for the binding and the tracker. */
class FakeAudioContext extends EventTarget {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
}

/** A device list that counts its own listeners, so a leak is visible. */
class FakeDevices extends EventTarget {
  readonly listeners = new Map<string, number>();
  override addEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: AddEventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, cb, opts);
  }
  override removeEventListener(type: string, cb: EventListenerOrEventListenerObject | null, opts?: EventListenerOptions | boolean) {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, cb, opts);
  }
}

let tickNo = 0;
/** One engine tick through the tap: binds the current context, samples it. */
function tick(res: TimingResource): void {
  const ctx: NodeContext = { tick: tickNo, time: tickNo / 60, dt: 1 / 60, resources: { timeScale: 1 } };
  tickNo++;
  res.tap.onValue?.('merge.params', 1, ctx);
}

const epoch = (res: TimingResource) => res.reading().audioEpoch;

function setup() {
  const devices = new FakeDevices();
  vi.stubGlobal('navigator', { mediaDevices: devices });
  let ac: FakeAudioContext | undefined;
  const res = createTimingResource({ audio: () => ac as never, now: () => tickNo * 16, runtime: RUNTIME });
  return {
    devices,
    res,
    setAudio(next: FakeAudioContext | undefined) {
      ac = next;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createTimingResource: the audio epoch triggers', () => {
  it('binds to the context when it first appears (one bump), then bumps on its statechange', () => {
    const { res, setAudio } = setup();
    tick(res);
    expect(epoch(res)).toBe(0); // no context yet: nothing bound
    const ac = new FakeAudioContext();
    setAudio(ac);
    tick(res);
    expect(epoch(res)).toBe(1); // the binding itself is a route
    tick(res);
    expect(epoch(res)).toBe(1); // the same context is not bound twice
    ac.dispatchEvent(new Event('statechange'));
    expect(epoch(res)).toBe(2);
    ac.dispatchEvent(new Event('statechange'));
    expect(epoch(res)).toBe(3);
  });

  it('bumps on a devicechange, with or without a context', () => {
    const { res, devices, setAudio } = setup();
    expect(devices.listeners.get('devicechange')).toBe(1);
    devices.dispatchEvent(new Event('devicechange'));
    expect(epoch(res)).toBe(1);
    setAudio(new FakeAudioContext());
    tick(res);
    devices.dispatchEvent(new Event('devicechange'));
    expect(epoch(res)).toBe(3);
  });

  it('a second context rebinds: it bumps once, and the old context no longer moves the epoch', () => {
    const { res, setAudio } = setup();
    const first = new FakeAudioContext();
    setAudio(first);
    tick(res);
    expect(epoch(res)).toBe(1);
    const second = new FakeAudioContext();
    setAudio(second);
    tick(res);
    expect(epoch(res)).toBe(2);
    first.dispatchEvent(new Event('statechange'));
    expect(epoch(res)).toBe(2);
    second.dispatchEvent(new Event('statechange'));
    expect(epoch(res)).toBe(3);
  });

  it('dispose() removes both listeners: neither the device list nor the context moves the epoch after it', () => {
    const { res, devices, setAudio } = setup();
    const ac = new FakeAudioContext();
    setAudio(ac);
    tick(res);
    const before = epoch(res);
    res.dispose();
    expect(devices.listeners.get('devicechange')).toBe(0);
    devices.dispatchEvent(new Event('devicechange'));
    ac.dispatchEvent(new Event('statechange'));
    expect(epoch(res)).toBe(before);
  });

  it('works where the browser has no device list (no listener, no throw)', () => {
    vi.stubGlobal('navigator', {});
    const res = createTimingResource({ audio: () => undefined, runtime: RUNTIME });
    tick(res);
    expect(epoch(res)).toBe(0);
    expect(() => res.dispose()).not.toThrow();
  });
});

describe('cameraSettingsOf', () => {
  it('is null for no stream, a stream with no video track, and a track without getSettings', () => {
    expect(cameraSettingsOf(null)).toBeNull();
    expect(cameraSettingsOf({ getVideoTracks: () => [] } as unknown as MediaStream)).toBeNull();
    expect(cameraSettingsOf({ getVideoTracks: () => [{}] } as unknown as MediaStream)).toBeNull();
  });

  it('keeps the rate and size and drops the device ids; a missing number reads as null', () => {
    const track = { getSettings: () => ({ frameRate: 30, width: 1280, height: 720, deviceId: 'abc', groupId: 'def' }) };
    expect(cameraSettingsOf({ getVideoTracks: () => [track] } as unknown as MediaStream)).toEqual({ frameRate: 30, width: 1280, height: 720 });
    const partial = { getSettings: () => ({ width: 640 }) };
    expect(cameraSettingsOf({ getVideoTracks: () => [partial] } as unknown as MediaStream)).toEqual({ frameRate: null, width: 640, height: null });
  });

  it('noteCamera hands the settings to the reading, and null clears them', () => {
    vi.stubGlobal('navigator', {});
    const res = createTimingResource({ audio: () => undefined, runtime: RUNTIME });
    const track = { getSettings: () => ({ frameRate: 60, width: 640, height: 480 }) };
    res.noteCamera({ getVideoTracks: () => [track] } as unknown as MediaStream);
    expect(res.reading().camera).toEqual({ frameRate: 60, width: 640, height: 480 });
    res.noteCamera(null);
    expect(res.reading().camera).toBeNull();
  });
});
