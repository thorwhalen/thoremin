/**
 * The Lyria RealTime engine (`LyriaEngine`, `createLyriaEngine`; #141, the generative layer slice):
 * the browser half the `lyria` node's tests replace with a fake engine. Driven here with
 * `@google/genai` mocked (a music session whose handshake the test settles) over the recording
 * fake of the Web Audio graph. What is pinned is the part a player meets when the network is
 * bad: a connect that fails before the socket opens rejects (an error, a close, no answer at
 * all), a stop during the handshake closes the session when it arrives instead of keeping it,
 * concurrent connects share one handshake, and a session that dies later reads as disconnected;
 * then the audio: PCM chunks scheduled back to back after the buffer, nothing while paused, an
 * underrun resynchronised, the fade in to the volume; and the factory's reasons (no key, no audio,
 * cancelled).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideProviderKeys } from '@thoremin/sdk-ui/keys';
import { fakeAudio, param, type FakeAudio } from '../helpers/fakeAudio';
import { GENERATIVE } from '../helpers/extensions';

interface Callbacks {
  onmessage: (e: unknown) => void;
  onerror: (e?: { message?: string }) => void;
  onclose: () => void;
}

const genai = vi.hoisted(() => {
  const state = {
    options: [] as unknown[],
    handshakes: [] as { callbacks: Callbacks; resolve: (s: unknown) => void; reject: (e: unknown) => void; args: unknown }[],
  };
  class GoogleGenAI {
    live = {
      music: {
        connect: (args: { callbacks: Callbacks }) =>
          new Promise((resolve, reject) => state.handshakes.push({ callbacks: args.callbacks, resolve, reject, args })),
      },
    };
    constructor(opts: unknown) {
      state.options.push(opts);
    }
  }
  return { state, GoogleGenAI };
});
vi.mock('@google/genai', () => ({ GoogleGenAI: genai.GoogleGenAI }));

function session() {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    close: vi.fn(),
    resetContext: vi.fn(),
    setWeightedPrompts: vi.fn(async () => undefined),
    setMusicGenerationConfig: vi.fn(async () => undefined),
  };
}

/** A 16-bit stereo PCM chunk of `frames` frames, base64. */
const pcm = (frames: number, value = 16384) => {
  const i16 = new Int16Array(frames * 2).fill(value);
  return btoa(String.fromCharCode(...new Uint8Array(i16.buffer)));
};

const load = () => import('@/slices/generative/app/lyria_engine');

let fa: FakeAudio;
const dest = { kind: 'dest' } as unknown as AudioNode;

beforeEach(() => {
  genai.state.options.length = 0;
  genai.state.handshakes.length = 0;
  fa = fakeAudio({ sampleRate: 48000, currentTime: 10 });
  Object.assign(fa.ac, { state: 'running', resume: vi.fn(async () => undefined) });
});
afterEach(() => {
  vi.useRealTimers();
  provideProviderKeys(null);
});

const engineOf = async (opts: Record<string, unknown> = {}) => {
  const { LyriaEngine } = await load();
  return new LyriaEngine({ apiKey: 'k', audioContext: fa.ac, destination: dest, ...opts });
};

/** Connect and open the socket; returns the engine, its session and its callbacks. */
const opened = async (opts: Record<string, unknown> = {}) => {
  const engine = await engineOf(opts);
  const s = session();
  const p = engine.connect();
  const hs = genai.state.handshakes.at(-1)!;
  hs.resolve(s);
  await p;
  return { engine, s, cb: hs.callbacks };
};

describe.runIf(GENERATIVE)('the Lyria engine', () => {
  it('asks for the music model on the default API version with the key', async () => {
    const engine = await engineOf();
    void engine.connect().catch(() => {});
    expect(genai.state.options[0]).toEqual({ apiKey: 'k', apiVersion: 'v1alpha' });
    expect(genai.state.handshakes[0].args).toMatchObject({ model: 'lyria-realtime-exp' });
  });

  it('is connected once the socket opens, and concurrent connects share one handshake', async () => {
    const engine = await engineOf();
    expect(engine.connected()).toBe(false);
    const a = engine.connect();
    const b = engine.connect();
    expect(genai.state.handshakes).toHaveLength(1);
    genai.state.handshakes[0].resolve(session());
    await Promise.all([a, b]);
    expect(engine.connected()).toBe(true);
    await engine.connect();
    expect(genai.state.handshakes).toHaveLength(1);
  });

  it('a connection error before the socket opens rejects, naming it', async () => {
    const engine = await engineOf();
    const p = engine.connect();
    genai.state.handshakes[0].callbacks.onerror({ message: 'bad key' });
    await expect(p).rejects.toThrow('Lyria connection error: bad key');
    expect(engine.connected()).toBe(false);
    // Not remembered: the next connect tries again.
    const again = engine.connect();
    expect(genai.state.handshakes).toHaveLength(2);
    genai.state.handshakes[1].callbacks.onerror();
    await expect(again).rejects.toThrow(/^Lyria connection error$/);
  });

  it('a close before the socket opens rejects with what to check', async () => {
    const engine = await engineOf();
    const p = engine.connect();
    genai.state.handshakes[0].callbacks.onclose();
    await expect(p).rejects.toThrow(/check the API key and the API version/);
  });

  it('a handshake that never answers times out', async () => {
    vi.useFakeTimers();
    const engine = await engineOf({ connectTimeoutMs: 2000 });
    const p = engine.connect();
    const assertion = expect(p).rejects.toThrow('Lyria did not answer within 2s');
    await vi.advanceTimersByTimeAsync(2000);
    await assertion;
  });

  it('a stop during the handshake closes the session when it arrives, and keeps nothing', async () => {
    const engine = await engineOf();
    const p = engine.connect();
    await engine.stop();
    const s = session();
    s.close.mockImplementation(() => {
      throw new Error('already closing');
    });
    genai.state.handshakes[0].resolve(s);
    await expect(p).rejects.toThrow('Stopped while connecting');
    expect(s.close).toHaveBeenCalledOnce();
    expect(engine.connected()).toBe(false);
  });

  it('a session that dies after opening reads as disconnected', async () => {
    const { engine, cb } = await opened();
    cb.onclose();
    expect(engine.connected()).toBe(false);
    const other = await opened();
    other.cb.onerror({ message: 'reset' });
    expect(other.engine.connected()).toBe(false);
  });

  it('play connects if needed, resumes a suspended context and fades in to the volume', async () => {
    const engine = await engineOf();
    (fa.ac as unknown as { state: string }).state = 'suspended';
    engine.setVolume(0.6);
    const p = engine.play();
    const s = session();
    genai.state.handshakes[0].resolve(s);
    await p;
    expect(fa.ac.resume).toHaveBeenCalledOnce();
    expect(s.play).toHaveBeenCalledOnce();
    const [out] = fa.of('Gain');
    expect(out.connections).toEqual([dest]);
    expect(param(out, 'gain').calls).toEqual([
      ['set', 0, 10],
      ['linear', 0.6, 10.1],
    ]);
  });

  it('schedules the chunks back to back after the buffer while playing; nothing while paused', async () => {
    const { engine, s, cb } = await opened({ bufferSeconds: 1 });
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(480) }] } });
    expect(fa.of('BufferSource')).toHaveLength(0); // not playing yet
    await engine.play();
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(4800) }] } });
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(4800) }] } });
    cb.onmessage({ serverContent: { audioChunks: [{}] } });
    cb.onmessage({ serverContent: {} });
    const sources = fa.of('BufferSource');
    expect(sources.map((n) => n.started)).toEqual([[11], [11.1]]);
    const buf = sources[0].buffer as { numberOfChannels: number; getChannelData(c: number): Float32Array };
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.getChannelData(1)[0]).toBe(0.5);
    await engine.pause();
    expect(s.pause).toHaveBeenCalledOnce();
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(480) }] } });
    expect(fa.of('BufferSource')).toHaveLength(2);
  });

  it('an underrun drops the late chunk and resynchronises on the next one', async () => {
    const { engine, cb } = await opened({ bufferSeconds: 0.5 });
    await engine.play();
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(4800) }] } }); // at 10.5
    fa.setTime(20); // the stream stalled
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(4800) }] } });
    cb.onmessage({ serverContent: { audioChunks: [{ data: pcm(4800) }] } });
    expect(fa.of('BufferSource').map((n) => n.started)).toEqual([[10.5], [], [20.5]]);
  });

  it('forwards the prompts with a weight, the config and a context reset; nothing without a session', async () => {
    const lone = await engineOf();
    expect(() => {
      lone.setWeightedPrompts([{ text: 'calm', weight: 1 }]);
      lone.setConfig({ bpm: 90 } as never);
      lone.resetContext();
    }).not.toThrow();
    const { engine, s } = await opened();
    engine.setWeightedPrompts([
      { text: 'calm', weight: 1 },
      { text: 'off', weight: 0 },
    ]);
    expect(s.setWeightedPrompts).toHaveBeenCalledWith({ weightedPrompts: [{ text: 'calm', weight: 1 }] });
    engine.setWeightedPrompts([{ text: 'off', weight: 0 }]);
    expect(s.setWeightedPrompts).toHaveBeenCalledOnce();
    engine.setConfig({ bpm: 90, density: 0.5, brightness: 0.4, guidance: 3, temperature: 1.1 } as never);
    expect(s.setMusicGenerationConfig).toHaveBeenCalledWith({ musicGenerationConfig: { bpm: 90, density: 0.5, brightness: 0.4, guidance: 3, temperature: 1.1 } });
    engine.resetContext();
    expect(s.resetContext).toHaveBeenCalledOnce();
  });

  it('the volume is clamped and applied at once only while playing', async () => {
    const { engine } = await opened();
    engine.setVolume(3);
    const [out] = fa.of('Gain');
    expect(param(out, 'gain').calls).toEqual([]);
    await engine.play();
    engine.setVolume(-1);
    expect(param(out, 'gain').calls.at(-1)).toEqual(['target', 0, 10, 0.05]);
    expect(param(out, 'gain').calls[1]).toEqual(['linear', 1, 10.1]);
  });

  it('stop ends and closes the session, survives one that throws, and starts a fresh bus', async () => {
    const { engine, s } = await opened();
    s.stop.mockImplementation(() => {
      throw new Error('gone');
    });
    s.close.mockImplementation(() => {
      throw new Error('gone');
    });
    await engine.stop();
    expect(engine.connected()).toBe(false);
    const gains = fa.of('Gain');
    expect(gains).toHaveLength(2);
    expect(gains[0].disconnected).toBe(1);
  });
});

describe.runIf(GENERATIVE)('createLyriaEngine', () => {
  const signal = new AbortController().signal;

  it('asks for a key when none is stored', async () => {
    const { createLyriaEngine } = await load();
    expect(await createLyriaEngine({ audioContext: fa.ac, destination: dest, signal })).toMatchObject({ resource: null, reason: 'no-key', retry: true });
  });

  it('asks for a tap when there is no audio graph yet', async () => {
    provideProviderKeys({ get: () => 'key' });
    const { createLyriaEngine } = await load();
    expect(await createLyriaEngine({ signal })).toMatchObject({ resource: null, reason: 'no-audio', retry: true });
  });

  it('a cancelled request builds nothing', async () => {
    provideProviderKeys({ get: () => 'key' });
    const { createLyriaEngine } = await load();
    const c = new AbortController();
    c.abort();
    expect(await createLyriaEngine({ audioContext: fa.ac, destination: dest, signal: c.signal })).toMatchObject({ resource: null, reason: 'aborted' });
  });

  it('builds the engine with the stored key', async () => {
    const { createLyriaEngine, LyriaEngine, LYRIA_KEY_PROVIDER } = await load();
    provideProviderKeys({ get: (p) => (p === LYRIA_KEY_PROVIDER ? 'stored' : null) });
    const r = await createLyriaEngine({ audioContext: fa.ac, destination: dest, signal });
    expect(r.resource).toBeInstanceOf(LyriaEngine);
    expect(genai.state.options.at(-1)).toMatchObject({ apiKey: 'stored' });
  });
});
