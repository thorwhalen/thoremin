// @vitest-environment jsdom
/**
 * `installLatencyProbe`'s strike test (`src/app/latencyProbe.ts`, #391 item 4): the
 * microphone it opens must never outlive the probe. A start is refused while the
 * instrument's own audio is not running (the answer tone plays through it); a second
 * start while one is in flight is the same start (one microphone, not two); and an
 * `uninstall()` (an engine rebuild) during the permission prompt or the worklet load, or a
 * second `AudioContext` that cannot be made, must still stop the stream and close the
 * context (#393 lower, #328: the latency probe can leave the microphone on).
 *
 * Fakes: `getUserMedia`, `AudioContext`, `AudioWorkletNode` and `URL.createObjectURL`,
 * each resolvable by hand so the test decides when the async start moves on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installLatencyProbe, LATENCY_HANDLE_KEY, type InstalledLatencyProbe } from '@/app/latencyProbe';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A microphone stream whose track records whether it was stopped. */
function micStream() {
  const track = { stop: vi.fn(), getSettings: () => ({ sampleRate: 48000, deviceId: 'mic' }) };
  return { stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream, track };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface Harness {
  installed: InstalledLatencyProbe;
  getUserMedia: ReturnType<typeof vi.fn>;
  gum: Deferred<MediaStream>;
  addModule: Deferred<void>;
  contexts: { close: ReturnType<typeof vi.fn> }[];
}

/** Install the probe on a fake engine with the app's audio in `appState`. `ctorThrows`
 *  makes the strike test's own `new AudioContext` throw. */
function setup(options: { appState?: string | null; ctorThrows?: boolean } = {}): Harness {
  const gum = deferred<MediaStream>();
  const addModule = deferred<void>();
  const getUserMedia = vi.fn(() => gum.promise);
  const contexts: { close: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  class FakeAudioContext {
    sampleRate = 48000;
    currentTime = 0;
    destination = {};
    audioWorklet = { addModule: () => addModule.promise };
    close = vi.fn(() => Promise.resolve());
    constructor() {
      if (options.ctorThrows) throw new Error('too many AudioContexts');
      contexts.push(this);
    }
    createMediaStreamSource() {
      return { connect: (n: unknown) => n };
    }
    createGain() {
      return { gain: { value: 1 }, connect: (n: unknown) => n };
    }
  }
  class FakeWorkletNode {
    port: { onmessage: unknown } = { onmessage: null };
    connect(n: unknown) {
      return n;
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
  vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => 'blob:worklet', revokeObjectURL: () => {} }));
  const appState = options.appState === undefined ? 'running' : options.appState;
  const resources: Record<string, unknown> = appState === null ? {} : { audioContext: { state: appState, currentTime: 0, sampleRate: 48000 } };
  const engine = { addTap: () => () => {} };
  const installed = installLatencyProbe(engine, resources);
  return { installed, getUserMedia, gum, addModule, contexts };
}

const handle = () => window[LATENCY_HANDLE_KEY]!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installLatencyProbe: the strike test start', () => {
  it('publishes the handle and the panel, and uninstall removes both', () => {
    const h = setup();
    expect(window[LATENCY_HANDLE_KEY]).toBeDefined();
    expect(document.querySelector('[data-testid="latency-probe"]')).not.toBeNull();
    h.installed.uninstall();
    expect(window[LATENCY_HANDLE_KEY]).toBeUndefined();
    expect(document.querySelector('[data-testid="latency-probe"]')).toBeNull();
  });

  it('rejects when the app audio is not running, or absent, and opens no microphone', async () => {
    for (const appState of ['suspended', null] as const) {
      const h = setup({ appState });
      await expect(handle().strikeStart()).rejects.toThrow(/Tap to play first/);
      expect(h.getUserMedia).not.toHaveBeenCalled();
      h.installed.uninstall();
    }
  });

  it('a second start while one is in flight returns the same promise and opens one microphone', async () => {
    const h = setup();
    const a = handle().strikeStart();
    const b = handle().strikeStart();
    expect(b).toBe(a);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    const { stream } = micStream();
    h.gum.resolve(stream);
    h.addModule.resolve();
    await a;
    expect(h.contexts.length).toBe(1);
    // Running: a further start is a no-op, not a second microphone.
    await handle().strikeStart();
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    h.installed.uninstall();
  });

  it('uninstall after the start completed stops the stream and closes the context', async () => {
    const h = setup();
    const p = handle().strikeStart();
    const { stream, track } = micStream();
    h.gum.resolve(stream);
    h.addModule.resolve();
    await p;
    h.installed.uninstall();
    expect(track.stop).toHaveBeenCalled();
    expect(h.contexts[0].close).toHaveBeenCalled();
  });

  it.fails('uninstall while the permission prompt is open releases the microphone once it is granted (#393 lower: #328 probe mic)', async () => {
    const h = setup();
    const p = handle().strikeStart();
    p.catch(() => {});
    h.installed.uninstall();
    const { stream, track } = micStream();
    h.gum.resolve(stream);
    h.addModule.resolve();
    await flush();
    await p.catch(() => {});
    expect(track.stop).toHaveBeenCalled();
    for (const ac of h.contexts) expect(ac.close).toHaveBeenCalled();
  });

  it.fails('uninstall while the worklet loads releases the microphone and the context (#393 lower: #328 probe mic)', async () => {
    const h = setup();
    const p = handle().strikeStart();
    p.catch(() => {});
    const { stream, track } = micStream();
    h.gum.resolve(stream);
    await flush();
    expect(h.contexts.length).toBe(1); // the context exists, the worklet is loading
    h.installed.uninstall();
    h.addModule.resolve();
    await flush();
    await p.catch(() => {});
    expect(track.stop).toHaveBeenCalled();
    expect(h.contexts[0].close).toHaveBeenCalled();
  });

  it.fails('a strike-test AudioContext that cannot be made still stops the stream, and the start rejects (#393 lower: #328 probe mic)', async () => {
    const h = setup({ ctorThrows: true });
    const p = handle().strikeStart();
    const { stream, track } = micStream();
    h.gum.resolve(stream);
    await expect(p).rejects.toThrow(/too many AudioContexts/);
    expect(track.stop).toHaveBeenCalled();
    h.installed.uninstall();
  });

  it('a worklet that fails to load stops the stream, closes the context, and the start rejects', async () => {
    const h = setup();
    const p = handle().strikeStart();
    const { stream, track } = micStream();
    h.gum.resolve(stream);
    h.addModule.reject(new Error('worklet refused'));
    await expect(p).rejects.toThrow(/worklet refused/);
    expect(track.stop).toHaveBeenCalled();
    expect(h.contexts[0].close).toHaveBeenCalled();
    h.installed.uninstall();
  });
});
