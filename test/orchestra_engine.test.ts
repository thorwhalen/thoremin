/**
 * `createOrchestraEngine` (`src/nodes/output/orchestra_engine.ts`, #391 item 5): the
 * browser-only `spessasynth_lib` adapter, run in Node with a fake `WorkletSynthesizer`,
 * a fake `AudioContext` and a stubbed `fetch`. It covers each exit of the load: no audio graph,
 * no AudioWorklet, an abort at each stage, a soundfont that does not load, a bank the
 * synth rejects, and success (the facade forwards every event with its `{ time }`, and
 * `close` stops, disconnects and destroys). The worklet module is added once per
 * context, and a failed add is retried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Op = { op: string; args: unknown[] };

/** The fakes the mocked module hands out; reset before each test. */
const state = vi.hoisted(() => ({
  synths: [] as {
    ops: { op: string; args: unknown[] }[];
    ac: unknown;
    connectedTo: unknown;
    disconnected: boolean;
    destroyed: boolean;
  }[],
  addSoundBank: null as null | ((bank: ArrayBuffer, id: string) => Promise<void>),
  isReady: null as null | (() => Promise<void>),
}));

vi.mock('spessasynth_lib', () => {
  class WorkletSynthesizer {
    rec: (typeof state.synths)[number];
    soundBankManager: { addSoundBank: (bank: ArrayBuffer, id: string) => Promise<void> };
    isReady: Promise<void>;
    constructor(ac: unknown) {
      this.rec = { ops: [], ac, connectedTo: null, disconnected: false, destroyed: false };
      state.synths.push(this.rec);
      this.soundBankManager = {
        addSoundBank: (bank, id) => {
          this.rec.ops.push({ op: 'addSoundBank', args: [bank.byteLength, id] });
          return state.addSoundBank ? state.addSoundBank(bank, id) : Promise.resolve();
        },
      };
      this.isReady = state.isReady ? state.isReady() : Promise.resolve();
    }
    connect(node: unknown) {
      this.rec.connectedTo = node;
    }
    disconnect() {
      this.rec.disconnected = true;
    }
    destroy() {
      this.rec.destroyed = true;
    }
    noteOn(...args: unknown[]) {
      this.rec.ops.push({ op: 'noteOn', args });
    }
    noteOff(...args: unknown[]) {
      this.rec.ops.push({ op: 'noteOff', args });
    }
    controllerChange(...args: unknown[]) {
      this.rec.ops.push({ op: 'controllerChange', args });
    }
    programChange(...args: unknown[]) {
      this.rec.ops.push({ op: 'programChange', args });
    }
    stopAll(...args: unknown[]) {
      this.rec.ops.push({ op: 'stopAll', args });
    }
  }
  return { WorkletSynthesizer };
});
vi.mock('spessasynth_lib/dist/spessasynth_processor.min.js?url', () => ({ default: '/processor.js' }));

import { createOrchestraEngine, SOUNDFONT_PATH } from '@/nodes/output/orchestra_engine';
import type { OrchestraEngineOpts } from '@/nodes/output/orchestra';

/** A fake context whose worklet records `addModule` calls; `fail` rejects the next one. */
function fakeAc() {
  const added: string[] = [];
  let fail = false;
  const ac = {
    audioWorklet: {
      addModule: (url: string) => {
        added.push(url);
        if (fail) {
          fail = false;
          return Promise.reject(new Error('worklet refused'));
        }
        return Promise.resolve();
      },
    },
  };
  return { ac: ac as unknown as AudioContext, added, failNext: () => (fail = true) };
}

const BANK = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
/** A soundfont response in two chunks with a Content-Length, so progress is reported. */
const okResponse = () =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(BANK.slice(0, 4));
        c.enqueue(BANK.slice(4));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-length': String(BANK.byteLength) } },
  );

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
const destination = { node: 'masterGain' } as unknown as AudioNode;

function opts(over: Partial<OrchestraEngineOpts> = {}) {
  const progress: number[] = [];
  const controller = new AbortController();
  const o: OrchestraEngineOpts = {
    audioContext: fakeAc().ac,
    destination,
    signal: controller.signal,
    progress: (f) => progress.push(f),
    ...over,
  };
  return { o, progress, controller };
}

beforeEach(() => {
  state.synths.length = 0;
  state.addSoundBank = null;
  state.isReady = null;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createOrchestraEngine: what it needs', () => {
  it('no audio graph yet is a retrying no-audio, and fetches nothing', async () => {
    const { o } = opts({ audioContext: undefined });
    expect(await createOrchestraEngine(o)).toMatchObject({ resource: null, reason: 'no-audio', retry: true });
    const { o: o2 } = opts({ destination: undefined });
    expect(await createOrchestraEngine(o2)).toMatchObject({ resource: null, reason: 'no-audio', retry: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no AudioWorklet is an unsupported browser, not retried', async () => {
    const { o } = opts({ audioContext: {} as AudioContext });
    const res = await createOrchestraEngine(o);
    expect(res).toMatchObject({ resource: null, reason: 'unsupported' });
    expect((res as { retry?: boolean }).retry).toBeUndefined();
    expect(state.synths).toHaveLength(0);
  });
});

describe('createOrchestraEngine: the abort paths', () => {
  it('aborted while the worklet loads: returns aborted before fetching', async () => {
    const { o, controller } = opts();
    const p = createOrchestraEngine(o);
    controller.abort();
    expect(await p).toMatchObject({ resource: null, reason: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.synths).toHaveLength(0);
  });

  it('aborted while the soundfont downloads: the fetch is given the signal, no synth is built', async () => {
    const { o, controller } = opts();
    fetchMock.mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(o.signal);
      controller.abort();
      return okResponse();
    });
    // The streaming reader stops at the abort with an AbortError (the lazy resource has
    // already moved on to a new generation, so it is not shown as an error).
    await expect(createOrchestraEngine(o)).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.synths).toHaveLength(0);
  });

  it('aborted while the bank loads into the synth: the synth is disconnected and destroyed', async () => {
    const { o, controller } = opts();
    state.addSoundBank = async () => {
      controller.abort();
    };
    expect(await createOrchestraEngine(o)).toMatchObject({ resource: null, reason: 'aborted' });
    expect(state.synths).toHaveLength(1);
    expect(state.synths[0]).toMatchObject({ disconnected: true, destroyed: true });
  });
});

describe('createOrchestraEngine: the error paths', () => {
  it('a soundfont that does not load throws with the status, before any synth exists', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 404, statusText: 'Not Found' }));
    const { o } = opts();
    await expect(createOrchestraEngine(o)).rejects.toThrow(/404/);
    expect(state.synths).toHaveLength(0);
  });

  it('a bank the synth rejects: the synth is disconnected, destroyed, and the error rethrown', async () => {
    state.addSoundBank = async () => {
      throw new Error('bad sf3');
    };
    const { o } = opts();
    await expect(createOrchestraEngine(o)).rejects.toThrow('bad sf3');
    expect(state.synths[0]).toMatchObject({ disconnected: true, destroyed: true });
  });

  it('a synth that never becomes ready (isReady rejects) is torn down the same way', async () => {
    state.isReady = () => Promise.reject(new Error('worklet crashed'));
    const { o } = opts();
    await expect(createOrchestraEngine(o)).rejects.toThrow('worklet crashed');
    expect(state.synths[0]).toMatchObject({ disconnected: true, destroyed: true });
  });

  it('a failed worklet add is not remembered: the next load on the same context adds it again', async () => {
    const f = fakeAc();
    f.failNext();
    await expect(createOrchestraEngine(opts({ audioContext: f.ac }).o)).rejects.toThrow('worklet refused');
    const res = await createOrchestraEngine(opts({ audioContext: f.ac }).o);
    expect(res.resource).not.toBeNull();
    expect(f.added).toEqual(['/processor.js', '/processor.js']);
  });
});

describe('createOrchestraEngine: success', () => {
  it('loads the soundfont with progress, connects to the destination and reports ready', async () => {
    const f = fakeAc();
    const { o, progress } = opts({ audioContext: f.ac });
    const res = await createOrchestraEngine(o);
    expect(res.resource).not.toBeNull();
    expect(res.message).toBe('Orchestra ready');
    // Under the app's base path (the build's `base`, as the browser serves it).
    expect(fetchMock.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}${SOUNDFONT_PATH}`);
    expect(String(fetchMock.mock.calls[0][0]).endsWith(`/${SOUNDFONT_PATH}`)).toBe(true);
    expect(progress).toEqual([0.5, 1]);
    const rec = state.synths[0];
    expect(rec.ac).toBe(f.ac);
    expect(rec.connectedTo).toBe(destination);
    expect(rec.ops[0]).toEqual({ op: 'addSoundBank', args: [BANK.byteLength, 'orchestra'] });
    expect(rec.disconnected).toBe(false);
  });

  it('adds the worklet module once per context', async () => {
    const f = fakeAc();
    await createOrchestraEngine(opts({ audioContext: f.ac }).o);
    await createOrchestraEngine(opts({ audioContext: f.ac }).o);
    expect(f.added).toEqual(['/processor.js']);
    const g = fakeAc();
    await createOrchestraEngine(opts({ audioContext: g.ac }).o);
    expect(g.added).toEqual(['/processor.js']);
  });

  it('the facade forwards every event with its context time, and close stops, disconnects and destroys', async () => {
    const res = await createOrchestraEngine(opts().o);
    const s = res.resource!;
    const rec = state.synths[0];
    rec.ops.length = 0;
    s.noteOn(1, 60, 100, 2.5);
    s.noteOff(1, 60, 3);
    s.controllerChange(2, 11, 90, 3.25);
    s.programChange(3, 40);
    s.allNotesOff();
    expect(rec.ops).toEqual<Op[]>([
      { op: 'noteOn', args: [1, 60, 100, { time: 2.5 }] },
      { op: 'noteOff', args: [1, 60, { time: 3 }] },
      { op: 'controllerChange', args: [2, 11, 90, { time: 3.25 }] },
      { op: 'programChange', args: [3, 40] },
      { op: 'stopAll', args: [] },
    ]);
    s.close();
    expect(rec.ops.at(-1)).toEqual({ op: 'stopAll', args: [true] });
    expect(rec).toMatchObject({ disconnected: true, destroyed: true });
  });
});
