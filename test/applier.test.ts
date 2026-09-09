/**
 * The Applier and the Source contract (#101 M-D).
 *
 * These pin the two things the design makes load-bearing and that are easy to get
 * subtly wrong: how a `signal` source differs from an `event` source between ticks, and
 * when a run stops. Everything here is plain Node — no DOM, no camera, no audio.
 */
import { describe, it, expect, vi } from 'vitest';
import { Applier, BatchClock, RealtimeClock, Engine, createRegistry, defineNode, STATE_READER_KEY, type Clock, type Source, type StateReader, type GraphSpec } from '@/dag';
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
  return { engine, seen };
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
    const { engine } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a']);
    await expect(new Applier({ engine, sources: [src], clock: new BatchClock(10) }).run()).rejects.toThrow(
      /unpaced clock/,
    );
  });

  it('names the offending clock in a way minification cannot erase', async () => {
    // The message's whole purpose is traceability, and esbuild renames class bindings by
    // default — so `clock.constructor.name` would read "(l)" in exactly the production
    // build where the source is not at hand. `paced` is data on the object and survives.
    const { engine } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a']);
    await expect(new Applier({ engine, sources: [src], clock: new BatchClock(10) }).run()).rejects.toThrow(
      /paced=false/,
    );
  });

  it('publishes into the ENGINE\'s own resources — the two cannot be different objects', async () => {
    // This replaced a guard. `resources` used to be a separate constructor option, so the
    // Applier could publish into an object no node read — a graph ticking on a resource
    // nothing ever wrote, with no symptom. Taking it from the engine makes that
    // unrepresentable rather than merely detected, which is why the guard is gone.
    const { engine, seen } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['latched']);
    await new Applier({ engine, sources: [src], clock: pacedClock(6) }).run();
    // The probe node reads ctx.resources.hands, so seeing the frame proves the pump
    // wrote where the engine reads.
    expect(seen).toContain('latched');
  });

  it('refuses two sources sharing an id — ids key the frame buffers', async () => {
    const { engine } = probeRig('hands');
    await engine.init();
    await expect(
      new Applier({
        engine, clock: pacedClock(4),
        sources: [listSource('hands', 'signal', 'a', []), listSource('hands', 'signal', 'b', [])],
      }).run(),
    ).rejects.toThrow(/duplicate Source id "hands"/);
  });

  it('refuses a second run() — two iterators on one camera, two clocks on one engine', async () => {
    const { engine } = probeRig('x');
    await engine.init();
    const applier = new Applier({ engine, clock: new BatchClock(1) });
    await applier.run();
    await expect(applier.run()).rejects.toThrow(/called twice/);
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
    const { engine, seen } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a', 'b', 'c']);
    await new Applier({ engine, sources: [src], clock: pacedClock(6) }).run();
    // Newest wins: a stale pose is worse than the current one. The three frames all
    // land between the first scheduled frame and the tick that follows them.
    expect(seen).toContain('c');
    expect(seen).not.toContain('a');
  });

  it('an EVENT source accumulates every frame since the last tick', async () => {
    const { engine, seen } = probeRig('keys');
    await engine.init();
    const src = listSource('s', 'event', 'keys', ['x', 'y', 'z']);
    await new Applier({ engine, sources: [src], clock: pacedClock(6) }).run();
    // Nothing dropped: a lost keypress is information no later frame can recover.
    const batches = (seen as unknown[][]).filter((b) => Array.isArray(b) && b.length > 0);
    expect(batches.flat()).toEqual(['x', 'y', 'z']);
  });

  it('a SIGNAL source with no new frame holds its last value; an EVENT source publishes empty', async () => {
    const sig = probeRig('hands');
    await sig.engine.init();
    // The source yields ONE frame and then stays open, so every tick after the first is a
    // tick with nothing new — which is the only situation where "hold" means anything.
    // Asserting the last value alone would pass even if the value were re-published every
    // tick, or if only the tick that received the frame were observed.
    const held: Source = {
      id: 's', kind: 'signal', outputResource: 'hands',
      async *frames() { yield 'only'; await new Promise((r) => setTimeout(r, 60)); },
      exhausted: () => false,
      dispose: () => {},
    };
    let n = 0;
    await new Applier({ engine: sig.engine, sources: [held], clock: pacedClock(12), shouldStop: () => n++ >= 5 }).run();
    const afterFirstFrame = sig.seen.slice(sig.seen.indexOf('only'));
    // Several ticks, and the value survives on ALL of them — not just the one that got it.
    expect(afterFirstFrame.length).toBeGreaterThan(1);
    expect(afterFirstFrame.every((v) => v === 'only')).toBe(true);

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
    let evTicks = 0;
    await new Applier({ engine: ev.engine, sources: [idle], clock: pacedClock(10), shouldStop: () => evTicks++ >= 3 }).run();
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
    const { engine, seen } = probeRig('hands');
    await engine.init();
    const src = listSource('s', 'signal', 'hands', ['a']);
    await new Applier({ engine, sources: [src], clock: pacedClock(1000) }).run();
    expect(seen.length).toBeLessThan(1000);
  });

  it('keeps running while ONE source is still open — exhaustion is every(), not some()', async () => {
    // Asserting a flag the source's own generator sets proves nothing about the Applier:
    // it would hold even if the run stopped immediately. What has to be observed is the
    // ENGINE still ticking while one source reports exhausted and another does not.
    const { engine, seen } = probeRig('hands');
    await engine.init();
    const drained: Source = {
      id: 'a', kind: 'signal', outputResource: 'hands',
      async *frames() { /* nothing, immediately done */ },
      exhausted: () => true,
      dispose: () => {},
    };
    const stillOpen: Source = {
      id: 'b', kind: 'signal', outputResource: 'other',
      async *frames() { await new Promise((r) => setTimeout(r, 60)); },
      exhausted: () => false,
      dispose: () => {},
    };
    let n = 0;
    await new Applier({ engine, sources: [drained, stillOpen], clock: pacedClock(20), shouldStop: () => n++ >= 4 }).run();
    // With `some()` semantics the exhausted source would have ended the run at tick zero.
    expect(seen.length).toBeGreaterThan(1);
  });

  it('honours an extra shouldStop', async () => {
    const { engine, seen } = probeRig('x');
    await engine.init();
    let n = 0;
    await new Applier({ engine, clock: new BatchClock(100), shouldStop: () => ++n > 3 }).run();
    expect(seen.length).toBeLessThanOrEqual(3);
  });
});

describe('the state reader — R3 one-tick feedback (#101 M-F)', () => {
  it('publishes a stateReader on the engine\'s resources', async () => {
    const { engine } = probeRig('x');
    await engine.init();
    await new Applier({ engine, clock: new BatchClock(1) }).run();
    const sr = engine.resources[STATE_READER_KEY] as StateReader | undefined;
    expect(typeof sr?.get).toBe('function');
  });

  it('reads the latest value a node emitted', async () => {
    const registry = createRegistry([
      defineNode({
        type: 'counter', roles: ['source'], params: z.object({}), inputs: [], outputs: [{ name: 'n', kind: 'any' }],
        make: () => { let n = 0; return { process: () => ({ n: n++ }) }; },
      }),
    ]);
    const engine = new Engine({ nodes: [{ id: 'c', type: 'counter', params: {} }], edges: [] }, registry, {});
    await engine.init();
    await new Applier({ engine, clock: new BatchClock(3) }).run();
    const sr = engine.resources[STATE_READER_KEY] as StateReader;
    expect(sr.get('c', 'n')).toBe(2);
    // A port or node that never emitted reads undefined rather than throwing — a source
    // must tolerate a first-tick absence, which is only possible if this is total.
    expect(sr.get('c', 'nope')).toBeUndefined();
    expect(sr.get('nope', 'n')).toBeUndefined();
  });

  it('a zero-input source reading a DOWNSTREAM node gets tick N-1 — the feedback, with no cycle', async () => {
    // The whole basis of R3: the engine evaluates topo-first, so when a source reads a
    // node that runs after it, it necessarily sees the previous tick's value. If this
    // ever returned the CURRENT tick, the graph would contain a cycle the engine rejects.
    const observed: unknown[] = [];
    const registry = createRegistry([
      defineNode({
        type: 'feedback-src', roles: ['source'], params: z.object({}), inputs: [], outputs: [{ name: 'out', kind: 'any' }],
        make: () => ({
          process: (_i, ctx) => {
            const sr = (ctx.resources as Record<string, unknown>)[STATE_READER_KEY] as StateReader | undefined;
            observed.push(sr?.get('sink', 'echo'));
            return { out: ctx.tick };
          },
        }),
      }),
      defineNode({
        type: 'echo-sink', roles: ['mapping'], params: z.object({}),
        inputs: [{ name: 'in', kind: 'any' }], outputs: [{ name: 'echo', kind: 'any' }],
        process: (inputs) => ({ echo: inputs.in }),
      }),
    ]);
    const engine = new Engine({
      nodes: [{ id: 'src', type: 'feedback-src', params: {} }, { id: 'sink', type: 'echo-sink', params: {} }],
      edges: [{ from: { node: 'src', port: 'out' }, to: { node: 'sink', port: 'in' } }],
    }, registry, {});
    await engine.init();
    await new Applier({ engine, clock: new BatchClock(4) }).run();
    // Tick 0 sees nothing (the sink has not run); thereafter it sees the PREVIOUS tick.
    expect(observed).toEqual([undefined, 0, 1, 2]);
  });

  it('is stable across ticks, so a node may hold onto it', async () => {
    const { engine } = probeRig('x');
    await engine.init();
    const applier = new Applier({ engine, clock: new BatchClock(2) });
    await applier.run();
    const first = engine.resources[STATE_READER_KEY];
    await new Applier({ engine, clock: new BatchClock(1) }).run();
    // A second Applier over the same engine republishes an equivalent reader; what must
    // not happen is the key vanishing between runs.
    expect(engine.resources[STATE_READER_KEY]).toBeDefined();
    expect(typeof (first as StateReader).get).toBe('function');
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

  it('dispose() detaches every tap it attached — the engine outlives the Applier', async () => {
    // The Applier takes a live, caller-owned engine that survives applyGraph swaps and
    // StrictMode remounts. A tap attached for "the lifetime of this run" and never
    // detached would keep receiving values from every later run on that engine.
    const { engine } = probeRig('x');
    await engine.init();
    const seen: string[] = [];
    const applier = new Applier({ engine, clock: new BatchClock(2) });
    applier.addTap({ onValue: (k) => seen.push(k) });
    await applier.run();
    const during = seen.length;
    expect(during).toBeGreaterThan(0);
    applier.dispose();
    engine.tick();
    expect(seen).toHaveLength(during);
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
    const { engine, seen } = probeRig('hands');
    await engine.init();
    const errs: unknown[] = [];
    const boom: Source = {
      id: 'boom', kind: 'signal', outputResource: 'hands',
      async *frames() { yield 'one'; throw new Error('source died'); },
      exhausted: () => false,
      dispose: () => {},
    };
    await new Applier({ engine, sources: [boom], clock: pacedClock(1000), onError: (e) => errs.push(e) }).run();
    expect(errs).toHaveLength(1);
    expect(seen.length).toBeLessThan(1000);
  });

  it('a source error with NO onError surfaces from run(), not as an unhandled rejection', async () => {
    // The pump promises are never awaited, so a `throw` inside one would be an unhandled
    // rejection — in Node a process-level crash, which would take down a whole test run
    // rather than failing this one. It has to come back through the await the caller
    // already has.
    const { engine } = probeRig('hands');
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
        new Applier({ engine, sources: [boom], clock: pacedClock(1000) }).run(),
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

  it('a THROWING sink is caught, reported, and does not kill the loop', async () => {
    // A sink is host code — canvas, audio, a React bridge — and is the most likely thing
    // in the tick path to throw. Outside the guard it would escape the paced clock's
    // frame callback, skipping `schedule()`: the instrument freezes and run() never
    // settles. A lost 2D context on a GPU reset is enough to reach it.
    const { engine } = probeRig('x');
    await engine.init();
    const errs: unknown[] = [];
    let good = 0;
    await new Applier({
      engine,
      clock: new BatchClock(3),
      sinks: [() => { throw new Error('canvas gone'); }, () => { good++; }],
      onError: (e) => errs.push(e),
    }).run();
    expect(errs.length).toBeGreaterThan(0);
    expect((errs[0] as Error).message).toBe('canvas gone');
    // The run completed, and the OTHER sink still ran.
    expect(good).toBe(3);
  });

  it('a throwing sink with no onError surfaces from run(), never as a hang', async () => {
    const { engine } = probeRig('x');
    await engine.init();
    await expect(
      new Applier({ engine, clock: new BatchClock(3), sinks: [() => { throw new Error('sink died'); }] }).run(),
    ).rejects.toThrow('sink died');
  });

  it('EVENT frames survive a tick that threw — they are put back, not dropped', async () => {
    // publish() drains the buffer BEFORE the tick. If the tick fails and onError swallows
    // it, those frames were never consumed by the engine and are gone from the buffer —
    // for an event source that is the only record of a keypress.
    const registry = createRegistry([
      defineNode({
        type: 'flaky', roles: ['source'], params: z.object({}), inputs: [], outputs: [{ name: 'seen', kind: 'any' }],
        make: () => {
          let n = 0;
          return {
            process: (_i, ctx) => {
              n++;
              if (n === 1) throw new Error('first tick fails');
              return { seen: (ctx.resources as Record<string, unknown>).keys };
            },
          };
        },
      }),
    ]);
    const seen: unknown[] = [];
    const resources: Record<string, unknown> = {};
    const engine = new Engine({ nodes: [{ id: 'f', type: 'flaky', params: {} }], edges: [] }, registry, {
      resources,
      taps: [{ onValue: (k, v) => { if (k === 'f.seen') seen.push(v); } }],
    });
    await engine.init();
    const src: Source = {
      id: 'k', kind: 'event', outputResource: 'keys',
      async *frames() { yield 'noteOn'; yield 'noteOff'; await new Promise((r) => setTimeout(r, 50)); },
      exhausted: () => false,
      dispose: () => {},
    };
    let n = 0;
    await new Applier({ engine, sources: [src], clock: pacedClock(10), shouldStop: () => n++ >= 4, onError: () => {} }).run();
    // The first tick threw; the two frames must appear on a LATER tick rather than vanish.
    expect(seen.flatMap((v) => (Array.isArray(v) ? v : []))).toEqual(['noteOn', 'noteOff']);
  });

  it('runs every sink, in order, once per tick', async () => {
    // A sink dropped from the list stops updating its panel at frame rate while nothing
    // fails. Order matters too: these are the React bridges, and one that throws must not
    // reorder the rest (the guard is per-sink).
    const { engine } = probeRig('x');
    await engine.init();
    const calls: string[] = [];
    await new Applier({
      engine,
      clock: new BatchClock(3),
      sinks: [() => calls.push('a'), () => calls.push('b'), () => calls.push('c')],
    }).run();
    expect(calls).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a', 'b', 'c']);
  });

  it('never ticks if it is already stopped when it starts', async () => {
    // The teardown race: a React effect can dispose before the first frame runs, and a
    // tick against released handles (a closed MediaPipe landmarker, disconnected audio)
    // is the failure this prevents.
    const { engine, seen } = probeRig('x');
    await engine.init();
    const calls: number[] = [];
    await new Applier({ engine, clock: new BatchClock(5), shouldStop: () => true, sinks: [() => calls.push(1)] }).run();
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
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
