/**
 * `stateGeneratorSource` (#215, design R3) — a source whose output is a function of
 * current DAG state, read through the Applier's `StateReader`.
 *
 * The three requirements the design calls load-bearing, one describe block each:
 *
 * 1. A first-tick `undefined` is tolerated (emit nothing by default, or seed on opt-in).
 * 2. Randomness derives only from `seed + ctx.tick` — reproducible, never `Math.random`.
 * 3. The read snapshot is re-emitted on a second port, so replaying a recorded take
 *    through the generator reproduces its output exactly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  Applier,
  BatchClock,
  Engine,
  createRegistry,
  defineNode,
  parseRecords,
  runHeadless,
  STATE_READER_KEY,
  type GraphSpec,
  type NodeContext,
  type StateReader,
} from '@/dag';
import { CORE_NODES, STATE_GENERATOR_OUTPUTS, stateGeneratorSource, tickRng } from '@/nodes';

/** Sums every value it is fed — the "current DAG state" the generator reads back. */
const accumulator = defineNode({
  type: 'test-accumulator',
  roles: ['mapping'],
  inputs: [{ name: 'in', kind: 'number' }],
  outputs: [{ name: 'total', kind: 'number' }],
  make: () => {
    let total = 0;
    return {
      process: (inputs) => {
        if (typeof inputs.in === 'number') total += inputs.in;
        return { total };
      },
    };
  },
});

/** Reads the running total and adds a seeded random nudge to it. */
const nudge = stateGeneratorSource<number>({
  type: 'test-nudge',
  kind: 'number',
  compute: ({ state, rng }) => (state.total as number) * 0.5 + rng(),
});

/** Same, but seeds its own first value instead of skipping the absent tick. */
const seeding = stateGeneratorSource<number>({
  type: 'test-seeding',
  kind: 'number',
  acceptsAbsent: true,
  compute: ({ state, rng }) => (state.total === undefined ? rng() : (state.total as number) * 0.5 + rng()),
});

const registry = () => createRegistry([...CORE_NODES, accumulator, nudge, seeding]);

/** gen → acc, with gen reading acc.total back: a feedback loop with no cycle. */
function loopSpec(type: string, seed: number): GraphSpec {
  return {
    nodes: [
      { id: 'gen', type, params: { seed, reads: { total: { node: 'acc', port: 'total' } } } },
      { id: 'acc', type: 'test-accumulator' },
    ],
    edges: [{ from: { node: 'gen', port: 'value' }, to: { node: 'acc', port: 'in' } }],
  };
}

async function live(type: string, seed: number, ticks: number) {
  const { recorder } = await runHeadless(loopSpec(type, seed), registry(), { ticks });
  return recorder;
}

const ctxAt = (tick: number, resources: Record<string, unknown> = {}): NodeContext => ({
  tick,
  time: tick / 60,
  dt: tick === 0 ? 0 : 1 / 60,
  resources,
});

describe('1. a first-tick undefined is tolerated', () => {
  it('with no reader at all (a bare node test) it does not throw and emits only the snapshot', () => {
    const h = nudge.make(nudge.params.parse({ reads: { total: { node: 'acc', port: 'total' } } }));
    const out = h.process({}, ctxAt(0));
    expect(out).toEqual({ snapshot: { total: undefined } });
    expect(STATE_GENERATOR_OUTPUTS.value in out).toBe(false);
  });

  it('in a live loop, tick 0 emits nothing on value (the downstream has not run yet); tick 1 onwards it does', async () => {
    const rec = await live('test-nudge', 1, 5);
    const ticks = rec.get('gen.value').map((r) => r.tick);
    expect(ticks).toEqual([1, 2, 3, 4]);
    // ...and the snapshot is there on EVERY tick, including the empty one.
    expect(rec.get('gen.snapshot').map((r) => r.tick)).toEqual([0, 1, 2, 3, 4]);
    expect(rec.get('gen.snapshot')[0].value).toEqual({ total: undefined });
  });

  it('acceptsAbsent lets a generator SEED its first value instead', async () => {
    const rec = await live('test-seeding', 1, 3);
    expect(rec.get('gen.value').map((r) => r.tick)).toEqual([0, 1, 2]);
    expect(rec.get('gen.value')[0].value).toBe(tickRng(1, 0)());
  });

  it('reads tick N-1 of the downstream node — the feedback, with no cycle', async () => {
    const rec = await live('test-nudge', 3, 6);
    const snap = rec.values('gen.snapshot') as { total?: number }[];
    const totals = rec.values('acc.total') as number[];
    for (let k = 1; k < 6; k++) expect(snap[k].total).toBe(totals[k - 1]);
  });
});

describe('2. randomness derives only from seed + ctx.tick', () => {
  it('the same seed reproduces the same take, byte for byte', async () => {
    const a = (await live('test-nudge', 42, 30)).toFiles();
    const b = (await live('test-nudge', 42, 30)).toFiles();
    expect(a).toEqual(b);
  });

  it('a different seed gives a different take', async () => {
    const a = (await live('test-nudge', 1, 10)).values('gen.value');
    const b = (await live('test-nudge', 2, 10)).values('gen.value');
    expect(a).not.toEqual(b);
  });

  it('a draw at tick N does not depend on how many draws earlier ticks made', () => {
    // A single stream advanced across ticks would fail this: the random value at tick 5
    // would depend on the draw count at ticks 0..4, so a change in one branch of compute
    // would shift every later value in the take.
    const greedy = stateGeneratorSource<number>({
      type: 'g',
      acceptsAbsent: true,
      compute: ({ rng, ctx }) => {
        let v = 0;
        for (let i = 0; i <= (ctx.tick === 2 ? 50 : 0); i++) v = rng();
        return ctx.tick === 2 ? 0 : v;
      },
    });
    const h = greedy.make(greedy.params.parse({ seed: 9 }));
    const out = [0, 1, 2, 3, 4].map((t) => h.process({}, ctxAt(t)).value);
    expect(out[3]).toBe(tickRng(9, 3)());
    expect(out[4]).toBe(tickRng(9, 4)());
  });

  it('tickRng is pure, in [0, 1), and distinct across neighbouring ticks and seeds', () => {
    const draw = (s: number, t: number) => Array.from({ length: 4 }, tickRng(s, t));
    expect(draw(5, 7)).toEqual(draw(5, 7));
    const firsts = new Set<number>();
    for (let s = 0; s < 8; s++) for (let t = 0; t < 8; t++) firsts.add(tickRng(s, t)());
    expect(firsts.size).toBe(64);
    for (const v of firsts) expect(v >= 0 && v < 1).toBe(true);
  });

  it('BEHAVIOURAL: the node ignores wall time — same ticks under different times give the same output', () => {
    const h1 = nudge.make(nudge.params.parse({ seed: 4, reads: { total: { node: 'n', port: 'p' } } }));
    const h2 = nudge.make(nudge.params.parse({ seed: 4, reads: { total: { node: 'n', port: 'p' } } }));
    const reader: StateReader = { get: () => 10 };
    const run = (h: typeof h1, offset: number) =>
      [0, 1, 2, 3].map((t) => h.process({}, { ...ctxAt(t, { [STATE_READER_KEY]: reader }), time: offset + t }));
    expect(run(h1, 0)).toEqual(run(h2, 12345));
  });

  it('the module never reaches for an ambient source of randomness or time', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/nodes/sources/state_generator.ts'), 'utf8');
    for (const p of [/Math\.random\(/, /Date\.now/, /new Date\(/, /performance\.now/, /crypto\./]) {
      expect(src, `must not use ${p}`).not.toMatch(p);
    }
  });
});

describe('3. the snapshot port makes a take replayable', () => {
  it('replaying the RECORDED snapshots (NDJSON round-trip) with the same seed reproduces value exactly', async () => {
    const files = (await live('test-nudge', 11, 40)).toFiles();
    const snapshots = parseRecords(files['gen.snapshot.ndjson']);
    const liveValues = parseRecords(files['gen.value.ndjson']);

    // Replay the generator ALONE: no accumulator, no feedback loop — just a reader that
    // serves, at each tick, what the live generator recorded having read.
    const reads = { total: { node: 'acc', port: 'total' } };
    const h = nudge.make(nudge.params.parse({ seed: 11, reads }));
    const replayed: { tick: number; value: unknown }[] = [];
    for (const rec of snapshots) {
      const snap = rec.value as Record<string, unknown>;
      const reader: StateReader = {
        get: (node, port) => {
          const name = Object.entries(reads).find(([, r]) => r.node === node && r.port === port)?.[0];
          return name === undefined ? undefined : snap[name];
        },
      };
      const out = h.process({}, ctxAt(rec.tick, { [STATE_READER_KEY]: reader }));
      if (out.value !== undefined) replayed.push({ tick: rec.tick, value: out.value });
    }
    expect(replayed).toEqual(liveValues.map((r) => ({ tick: r.tick, value: r.value })));
  });

  it('without the snapshot the replay diverges — which is why the port exists', async () => {
    const liveValues = (await live('test-nudge', 11, 10)).values('gen.value');
    // Replaying the generator alone with no record of what it read: it sees `undefined`
    // on every tick, so the feedback-driven take is simply not reproducible.
    const blind = nudge.make(nudge.params.parse({ seed: 11, reads: { total: { node: 'acc', port: 'total' } } }));
    const replayed = Array.from({ length: 10 }, (_, t) => blind.process({}, ctxAt(t)).value).filter((v) => v !== undefined);
    expect(liveValues.length).toBe(9);
    expect(replayed).not.toEqual(liveValues);
  });

  it('works under the Applier on a caller-owned engine, reading through the published reader', async () => {
    const engine = new Engine(loopSpec('test-nudge', 5), registry());
    await engine.init();
    await new Applier({ engine, clock: new BatchClock(4) }).run();
    expect(engine.getOutput('gen', 'snapshot')).toEqual({ total: expect.any(Number) });
    expect(typeof engine.getOutput('gen', 'value')).toBe('number');
  });

  it('params are serializable and validated: reads must name a node and a port', () => {
    expect(() => nudge.params.parse({ reads: { x: { node: '', port: 'p' } } })).toThrow();
    expect(() => nudge.params.parse({ seed: 1.5 })).toThrow();
    const ok = nudge.params.parse({ seed: 3, reads: { x: { node: 'a', port: 'b' } } });
    expect(JSON.parse(JSON.stringify(ok))).toEqual(ok);
  });
});
