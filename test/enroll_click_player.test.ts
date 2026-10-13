/**
 * The trainer's WebAudio click player (#247, #309) against a fake `AudioContext`
 * (#391 item 4): a click whose time is already past on the context clock is dropped and
 * COUNTED, never silently lost; a context that starts suspended (Safari, the pattern
 * trainer's `unlock()` + `play()` in one gesture) must not have its clicks mapped against
 * its frozen clock (#393 item 5): the player waits for the resume and maps them against
 * the running clock, and a refused resume drops and counts them, never leaving the
 * rejection unhandled; `stop()` silences every voice scheduled and not yet played, and
 * cancels the clicks still waiting on a resume.
 *
 * The player builds its own context from `window.AudioContext`, so the fake is installed
 * as a stubbed `window`, and `performance.now()` (the engine clock) is pinned.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Click } from '@thoremin/sdk/enroll';
import { createWebAudioClickPlayer } from '@thoremin/sdk-ui/enroll/click';
import { OUTPUT_STAGE_PRIOR_S } from '@thoremin/sdk/timing/output_stage';

interface FakeOsc {
  starts: number[];
  /** Each `stop()` call's argument (undefined = stop now). */
  stops: (number | undefined)[];
  onended: (() => void) | null;
  /** Make `stop()` throw, as a real oscillator does after it has ended. */
  throwOnStop: boolean;
}

/** A context whose clock and state the test drives; `resume()` resolves when the test says. */
function fakeContextClass(init: { state: string; currentTime: number }) {
  const oscs: FakeOsc[] = [];
  const instances: FakeCtx[] = [];
  /** Every `resume()` not yet settled, oldest first. */
  const pending: { res: () => void; rej: () => void }[] = [];
  const param = () => ({ value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} });
  class FakeCtx {
    state = init.state;
    currentTime = init.currentTime;
    sampleRate = 48000;
    destination = {};
    resumeCalls = 0;
    constructor() {
      instances.push(this);
    }
    resume(): Promise<void> {
      this.resumeCalls++;
      return new Promise<void>((res, rej) => {
        pending.push({
          res: () => {
            this.state = 'running';
            res();
          },
          rej: () => rej(new Error('NotAllowedError')),
        });
      });
    }
    createOscillator() {
      const o: FakeOsc & Record<string, unknown> = {
        starts: [],
        stops: [],
        onended: null,
        throwOnStop: false,
        frequency: param(),
        connect: (n: unknown) => n,
        start: (t: number) => void o.starts.push(t),
        stop: (t?: number) => {
          if (o.throwOnStop && t === undefined) throw new Error('InvalidStateError');
          o.stops.push(t);
        },
      };
      oscs.push(o);
      return o;
    }
    createGain() {
      const g = { gain: param(), connect: (n: unknown) => n, disconnect: () => {} };
      return g;
    }
  }
  return {
    Ctor: FakeCtx,
    oscs,
    instances,
    /** Resolve the latest pending `resume()` (the context starts running). */
    resumed: async () => {
      pending.pop()?.res();
      await Promise.resolve();
      await Promise.resolve();
    },
    /** Reject every pending `resume()` (the browser refused to start the context). */
    refused: async () => {
      for (const p of pending.splice(0)) p.rej();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

type Fake = ReturnType<typeof fakeContextClass>;

const NOW_MS = 10_000;
const click = (t: number, over: Partial<Click> = {}): Click => ({ t, kind: 'beat', index: 0, accent: false, ...over });

let nowMs = NOW_MS;

function install(init: { state: string; currentTime: number }): Fake {
  const fake = fakeContextClass(init);
  vi.stubGlobal('window', { AudioContext: fake.Ctor });
  return fake;
}

beforeEach(() => {
  nowMs = NOW_MS;
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createWebAudioClickPlayer: a click already past', () => {
  it('is dropped and counted; a future click is scheduled on the context clock, one output stage early', () => {
    const fake = install({ state: 'running', currentTime: 5 });
    const p = createWebAudioClickPlayer();
    expect(p.dropped?.()).toBe(0);
    p.play([click(NOW_MS - 100), click(NOW_MS + 500)]);
    expect(p.dropped?.()).toBe(1);
    expect(fake.oscs).toHaveLength(1);
    // No timing pair and no outputLatency on the fake: the stage is the stated prior.
    expect(fake.oscs[0].starts[0]).toBeCloseTo(5 + 0.5 - OUTPUT_STAGE_PRIOR_S, 9);
  });

  it('counts across calls (the total, not the last call)', () => {
    install({ state: 'running', currentTime: 5 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS - 100)]);
    p.play([click(NOW_MS - 50), click(NOW_MS - 10)]);
    expect(p.dropped?.()).toBe(3);
  });

  it('a click inside the output stage is already past: it would reach the ear late', () => {
    const fake = install({ state: 'running', currentTime: 5 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS + (OUTPUT_STAGE_PRIOR_S * 1000) / 2)]);
    expect(p.dropped?.()).toBe(1);
    expect(fake.oscs).toHaveLength(0);
  });
});

describe('createWebAudioClickPlayer: a context that starts suspended', () => {
  it('unlock() asks a suspended context to resume', () => {
    const fake = install({ state: 'suspended', currentTime: 0 });
    const p = createWebAudioClickPlayer();
    p.unlock?.();
    expect(fake.instances).toHaveLength(1);
    expect(fake.instances[0].resumeCalls).toBe(1);
  });

  // #393 item 5: `play()` fires `resume()` and maps the click times at once, against the
  // frozen `currentTime`, so every click sounds late by the resume delay and none is
  // counted. Either intended fix passes this: wait for `resume()` before mapping, or drop
  // and count while the state is not 'running' (as drum-out does).
  it('never maps a click against the frozen clock: it waits for resume, or drops and counts it (#393 item 5)', async () => {
    const fake = install({ state: 'suspended', currentTime: 0 });
    const p = createWebAudioClickPlayer();
    p.unlock?.();
    p.play([click(NOW_MS + 300)]);
    // While suspended nothing is scheduled.
    expect(fake.oscs).toHaveLength(0);
    // The context starts 120 ms later; its clock has moved on.
    nowMs = NOW_MS + 120;
    fake.instances[0].currentTime = 0.12;
    await fake.resumed();
    if (p.dropped?.() === 1) {
      expect(fake.oscs).toHaveLength(0);
    } else {
      // Mapped against the RUNNING clock: 180 ms ahead of now, one output stage early.
      expect(p.dropped?.()).toBe(0);
      expect(fake.oscs).toHaveLength(1);
      expect(fake.oscs[0].starts[0]).toBeCloseTo(0.12 + 0.18 - OUTPUT_STAGE_PRIOR_S, 9);
    }
  });
  it('waits for the resume: a click that passed meanwhile is dropped and counted, the rest sound on time', async () => {
    const fake = install({ state: 'suspended', currentTime: 0 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS + 100), click(NOW_MS + 600)]);
    nowMs = NOW_MS + 250;
    fake.instances[0].currentTime = 0.25;
    await fake.resumed();
    expect(p.dropped?.()).toBe(1);
    expect(fake.oscs).toHaveLength(1);
    expect(fake.oscs[0].starts[0]).toBeCloseTo(0.25 + 0.35 - OUTPUT_STAGE_PRIOR_S, 9);
    // One resume for the unlock-free play: no second request while one is in flight.
    expect(fake.instances[0].resumeCalls).toBe(1);
  });

  it('a resume asked for outside a gesture stays pending: unlock() asks again, and the waiting clicks map once it runs', async () => {
    const fake = install({ state: 'suspended', currentTime: 0 });
    const p = createWebAudioClickPlayer();
    // play() outside a gesture: Chrome leaves this resume pending, never settling.
    p.play([click(NOW_MS + 400)]);
    expect(fake.instances[0].resumeCalls).toBe(1);
    // The Start click: a fresh resume inside the gesture, not the stuck one reused.
    p.unlock?.();
    expect(fake.instances[0].resumeCalls).toBe(2);
    nowMs = NOW_MS + 100;
    fake.instances[0].currentTime = 0.1;
    await fake.resumed(); // the gesture's resume succeeds; the first stays pending
    expect(p.dropped?.()).toBe(0);
    expect(fake.oscs).toHaveLength(1);
    expect(fake.oscs[0].starts[0]).toBeCloseTo(0.1 + 0.3 - OUTPUT_STAGE_PRIOR_S, 9);
  });

  it('a refused resume drops and counts every waiting click, and the rejection is handled', async () => {
    const fake = install({ state: 'suspended', currentTime: 0 });
    const p = createWebAudioClickPlayer();
    p.unlock?.();
    p.play([click(NOW_MS + 300), click(NOW_MS + 800)]);
    // An unhandled rejection would fail this run; the passing run is the evidence.
    await fake.refused();
    expect(p.dropped?.()).toBe(2);
    expect(fake.oscs).toHaveLength(0);
  });

  it('stop() while waiting on the resume cancels those clicks: nothing sounds, nothing is counted', async () => {
    const fake = install({ state: 'suspended', currentTime: 0 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS + 300)]);
    p.stop();
    await fake.resumed();
    expect(fake.oscs).toHaveLength(0);
    expect(p.dropped?.()).toBe(0);
  });
});

describe('createWebAudioClickPlayer: stop()', () => {
  it('stops every pending voice at once, and forgets them', () => {
    const fake = install({ state: 'running', currentTime: 5 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS + 500, { kind: 'count' }), click(NOW_MS + 1000, { accent: true }), click(NOW_MS + 1500)]);
    expect(fake.oscs).toHaveLength(3);
    // Each was given its own scheduled stop when it was started.
    for (const o of fake.oscs) expect(o.stops).toHaveLength(1);
    p.stop();
    for (const o of fake.oscs) expect(o.stops).toEqual([expect.any(Number), undefined]);
    // A second stop has nothing left to stop.
    p.stop();
    for (const o of fake.oscs) expect(o.stops).toHaveLength(2);
  });

  it('a voice whose stop() throws (already ended) does not keep the others sounding', () => {
    const fake = install({ state: 'running', currentTime: 5 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS + 500), click(NOW_MS + 1000)]);
    fake.oscs[0].throwOnStop = true;
    expect(() => p.stop()).not.toThrow();
    expect(fake.oscs[1].stops.at(-1)).toBeUndefined();
    expect(fake.oscs[1].stops).toHaveLength(2);
  });

  it('a voice that has ended on its own is no longer stopped', () => {
    const fake = install({ state: 'running', currentTime: 5 });
    const p = createWebAudioClickPlayer();
    p.play([click(NOW_MS + 500), click(NOW_MS + 1000)]);
    fake.oscs[0].onended?.();
    p.stop();
    expect(fake.oscs[0].stops).toHaveLength(1);
    expect(fake.oscs[1].stops).toHaveLength(2);
  });
});
