/**
 * The Applier and the Source contract (#101 M-D).
 *
 * These pin the two things the design makes load-bearing and that are easy to get
 * subtly wrong: how a `signal` source differs from an `event` source between ticks, and
 * when a run stops. Everything here is plain Node — no DOM, no camera, no audio.
 */
import { describe, it, expect, vi } from 'vitest';
import { Applier, BatchClock, RealtimeClock, Engine, createRegistry, defineNode, type Clock, type Source, type GraphSpec } from '@/dag';
import { z } from 'zod';

/** A node that copies a named resource onto its output port, so a test can see what the
 *  pump published on each tick. */
const probeNode = defineNode({
  type: 'probe',
  roles: ['source'],
  params: z.object({ key: z.string() }),
  inputs: [],
  outputs: [{ name: 'seen', kind: 'any' }],
  make: (params) => ({
    process: (_inputs, ctx) => ({ seen: (ctx.resources as Record<string, unknown>)[params.key] ?? null }),
  }),
});

function probeRig(key: string) {
  const registry = createRegistry([probeNode]);
  const spec: GraphSpec = { nodes: [{ id: 'p', type: 'probe', params: { key } }], edges: [] };
  const seen: unknown[] = [];
  const resources: Record<string, unknown> = {};
  const engine = new Engine(spec, registry, { resources, taps: [{ onValue: (k, v) => { if (k === 'p.seen') seen.push(v); } }] });
  return { engine, resources, seen };
}

/** A source that yields the given frames, one per microtask, then reports exhausted. */
function listSource(id: string, kind: 'signal' | 'event', outputResource: string, frames: unknown[]): Source {
  let done = false;
  return {
    id,
    kind,
    outputResource,
    async *frames() {
      for (const f of frames) yield f;
      done = true;
    },
    exhausted: () => done,
    dispose: () => {},
  };
}

/**
 * A `RealtimeClock` driven by an injected macrotask scheduler — paced (so the pump gets
 * a turn) but with no wall-clock dependence, so the test is deterministic and fast.
 * This is the shape a source-consuming Applier actually runs under.
 */
function pacedClock(maxFrames: number): Clock {
  let n = 0;
  let t = 0;
  return new RealtimeClock({
    now: () => (t += 1 / 30),
    schedule: (cb) => {
      if (n++ < maxFrames) setTimeout(cb, 0);
    },
  });
}

describe('an async source needs a clock that yields', () => {
  it('REFUSES an unpaced clock rather than ticking forever on a resource nothing wrote', async () => {
    const { engine, resources } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a']);
    await expect(new Applier({ engine, resources, sources: [src], clock: new BatchClock(10) }).run()).rejects.toThrow(
      /unpaced clock.*BatchClock/s,
    );
  });

  it('declares pacing on the clocks themselves, so the check needs no instanceof', () => {
    expect(new BatchClock(1).paced).toBe(false);
    expect(new RealtimeClock({ now: () => 0, schedule: () => {} }).paced).toBe(true);
  });

  it('a source-less Applier runs happily under the unpaced batch clock', async () => {
    const { engine, seen } = probeRig('x');
    await engine.init();
    await expect(new Applier({ engine, clock: new BatchClock(3) }).run()).resolves.toBeUndefined();
    expect(seen).toHaveLength(3);
  });
});

describe('the pump: how frames between ticks reach a node', () => {
  it('a SIGNAL source latches the newest frame and drops the intermediates', async () => {
    const { engine, resources, seen } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a', 'b', 'c']);
    await new Applier({ engine, resources, sources: [src], clock: pacedClock(6) }).run();
    // Newest wins: a stale pose is worse than the current one. The three frames all
    // land between the first scheduled frame and the tick that follows them.
    expect(seen).toContain('c');
    expect(seen).not.toContain('a');
  });

  it('an EVENT source accumulates every frame since the last tick', async () => {
    const { engine, resources, seen } = probeRig('keys');
    await engine.init();
    const src = listSource('s', 'event', 'keys', ['x', 'y', 'z']);
    await new Applier({ engine, resources, sources: [src], clock: pacedClock(6) }).run();
    // Nothing dropped: a lost keypress is information no later frame can recover.
    const batches = (seen as unknown[][]).filter((b) => Array.isArray(b) && b.length > 0);
    expect(batches.flat()).toEqual(['x', 'y', 'z']);
  });

  it('a SIGNAL source with no new frame holds its last value; an EVENT source publishes empty', async () => {
    const sig = probeRig('hands');
    await sig.engine.init();
    await new Applier({ engine: sig.engine, resources: sig.resources, sources: [listSource('s', 'signal', 'hands', ['only'])], clock: pacedClock(6) }).run();
    // Once latched the value is HELD across later ticks rather than reverting to null —
    // "the camera produced no new frame" is not "there is no hand".
    expect(sig.seen[sig.seen.length - 1]).toBe('only');

    // For the event side the source must stay OPEN with nothing pending — an already
    // exhausted, empty source correctly ends the run before any tick. A live keyboard
    // that nobody is typing on is the real case.
    const ev = probeRig('keys');
    await ev.engine.init();
    const idle: Source = {
      id: 's', kind: 'event', outputResource: 'keys',
      async *frames() { await new Promise((r) => setTimeout(r, 50)); },
      exhausted: () => false,
      dispose: () => {},
    };
    let n = 0;
    await new Applier({ engine: ev.engine, resources: ev.resources, sources: [idle], clock: pacedClock(10), shouldStop: () => n++ >= 3 }).run();
    // "No keys were pressed" is information, so it publishes an empty list rather than
    // holding the last one — the opposite of the signal rule above.
    expect(ev.seen.length).toBeGreaterThan(0);
    expect(ev.seen[ev.seen.length - 1]).toEqual([]);
  });
});

describe('when a run stops', () => {
  it('an empty source set never ends the run early — `ticks: N` still means N ticks', async () => {
    // The vacuous-truth trap: `[].every(...)` is true, so a naive exhaustion check would
    // stop every source-less batch run at tick zero. Every existing fixture depends on
    // this not happening.
    const { engine, seen } = probeRig('nothing');
    await engine.init();
    await new Applier({ engine, clock: new BatchClock(5) }).run();
    expect(seen).toHaveLength(5);
  });

  it('stops once every source is exhausted, without needing the clock to run out', async () => {
    const { engine, resources, seen } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a']);
    await new Applier({ engine, resources, sources: [src], clock: pacedClock(1000) }).run();
    expect(seen.length).toBeLessThan(1000);
  });

  it('keeps running while ONE source still has frames', async () => {
    const { engine, resources } = probeRig('hands');
    await engine.init();
    const drained = listSource('a', 'signal', 'hands', []);
    let openDone = false;
    const open: Source = {
      id: 'b', kind: 'signal', outputResource: 'other',
      async *frames() { for (let i = 0; i < 3; i++) yield i; openDone = true; },
      exhausted: () => openDone,
      dispose: () => {},
    };
    await new Applier({ engine, resources, sources: [drained, open], clock: pacedClock(50) }).run();
    expect(openDone).toBe(true);
  });

  it('honours an extra shouldStop', async () => {
    const { engine, seen } = probeRig('x');
    await engine.init();
    let n = 0;
    await new Applier({ engine, clock: new BatchClock(100), shouldStop: () => ++n > 3 }).run();
    expect(seen.length).toBeLessThanOrEqual(3);
  });
});

describe('dispose and failure', () => {
  it('dispose() releases every source even if one throws on the way out', () => {
    const bad: Source = { id: 'bad', kind: 'signal', outputResource: 'a', async *frames() {}, exhausted: () => true, dispose: () => { throw new Error('boom'); } };
    const good = { ...listSource('good', 'signal', 'b', []), dispose: vi.fn() };
    const { engine } = probeRig('x');
    const applier = new Applier({ engine, sources: [bad, good], clock: new BatchClock(1) });
    expect(() => applier.dispose()).not.toThrow();
    expect(good.dispose).toHaveBeenCalled();
  });

  it('dispose() is idempotent', () => {
    const good = { ...listSource('good', 'signal', 'b', []), dispose: vi.fn() };
    const { engine } = probeRig('x');
    const applier = new Applier({ engine, sources: [good], clock: new BatchClock(1) });
    applier.dispose();
    applier.dispose();
    expect(good.dispose).toHaveBeenCalledTimes(1);
  });

  it('a source that throws stops the run rather than starving it on a frozen frame', async () => {
    const { engine, resources, seen } = probeRig('hands');
    await engine.init();
    const errs: unknown[] = [];
    const boom: Source = {
      id: 'boom', kind: 'signal', outputResource: 'hands',
      async *frames() { yield 'one'; throw new Error('source died'); },
      exhausted: () => false,
      dispose: () => {},
    };
    await new Applier({ engine, resources, sources: [boom], clock: pacedClock(1000), onError: (e) => errs.push(e) }).run();
    expect(errs).toHaveLength(1);
    expect(seen.length).toBeLessThan(1000);
  });

  it('a source error with NO onError surfaces from run(), not as an unhandled rejection', async () => {
    // The pump promises are never awaited, so a `throw` inside one would be an unhandled
    // rejection — in Node a process-level crash, which would take down a whole test run
    // rather than failing this one. It has to come back through the await the caller
    // already has.
    const { engine, resources } = probeRig('hands');
    await engine.init();
    const boom: Source = {
      id: 'boom', kind: 'signal', outputResource: 'hands',
      async *frames() { yield 'one'; throw new Error('source died'); },
      exhausted: () => false,
      dispose: () => {},
    };
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(
        new Applier({ engine, resources, sources: [boom], clock: pacedClock(1000) }).run(),
      ).rejects.toThrow('source died');
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toBeNull();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a tick error rethrows by default — batch must fail loudly', async () => {
    const registry = createRegistry([
      defineNode({
        type: 'explode', roles: ['source'], params: z.object({}), inputs: [], outputs: [{ name: 'x', kind: 'any' }],
        make: () => ({ process: () => { throw new Error('node blew up'); } }),
      }),
    ]);
    const engine = new Engine({ nodes: [{ id: 'e', type: 'explode', params: {} }], edges: [] }, registry, {});
    await engine.init();
    await expect(new Applier({ engine, clock: new BatchClock(1) }).run()).rejects.toThrow('node blew up');
  });
});

describe('sinks', () => {
  it('fan out after each successful tick, with the clock time', async () => {
    const { engine } = probeRig('x');
    await engine.init();
    const times: (number | undefined)[] = [];
    await new Applier({ engine, clock: new BatchClock(3), sinks: [(t) => times.push(t)] }).run();
    // BatchClock passes no time — the sink sees undefined, exactly as the engine does.
    expect(times).toEqual([undefined, undefined, undefined]);
  });

  it('do not run when the tick threw', async () => {
    const registry = createRegistry([
      defineNode({
        type: 'explode', roles: ['source'], params: z.object({}), inputs: [], outputs: [{ name: 'x', kind: 'any' }],
        make: () => ({ process: () => { throw new Error('nope'); } }),
      }),
    ]);
    const engine = new Engine({ nodes: [{ id: 'e', type: 'explode', params: {} }], edges: [] }, registry, {});
    await engine.init();
    const hits: number[] = [];
    await new Applier({ engine, clock: new BatchClock(2), sinks: [() => hits.push(1)], onError: () => {} }).run();
    expect(hits).toHaveLength(0);
  });
});
