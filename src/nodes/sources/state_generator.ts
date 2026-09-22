/**
 * `stateGeneratorSource` — a source whose emitted events are a function of current DAG
 * state (design R3; #215, the second half of #101 M-F).
 *
 * The channel already exists: the `Applier` publishes a `StateReader` on
 * `ctx.resources` under `STATE_READER_KEY`, backed by `engine.getOutput`. A zero-input
 * node runs topo-first, so reading a DOWNSTREAM node's port yields that node's value from
 * tick N-1 — a one-tick feedback with no cycle. This module is the node that consumes it.
 *
 * ## A factory, like `defineMergeNode`
 *
 * What a state generator *computes* is a function (#87 command-dispatch will map the
 * instrument's state to commands), and a function cannot be a Zod param: params must stay
 * serializable so a `GraphSpec` can be saved, diffed and swapped by `applyGraph`. So the
 * computation is fixed per node TYPE by the factory, and what varies per graph — which
 * node ports to read, and the seed — is params:
 *
 * ```ts
 * const nudge = stateGeneratorSource<number>({
 *   type: 'nudge',
 *   compute: ({ state, rng }) => (state.level as number) + rng() * 0.1,
 * });
 * // graph: { id: 'gen', type: 'nudge', params: { seed: 7, reads: { level: { node: 'map', port: 'gain' } } } }
 * ```
 *
 * ## The three load-bearing requirements (design R3), and how each is met
 *
 * 1. **A first-tick `undefined` is tolerated.** The reader is total — an absent node or a
 *    node that has not emitted yet reads `undefined` — and so is this node: with no reader
 *    on `ctx.resources` at all (a `replayNode` test, a bare `Engine`) every read is
 *    `undefined`. By default `compute` is **not called** on a tick where any read is
 *    `undefined`, and the node emits nothing on `value` (the "emit nothing" reading). A
 *    generator that would rather *seed* sets `acceptsAbsent: true` and handles the
 *    `undefined` itself (typically from `rng`).
 * 2. **Randomness derives only from `seed + ctx.tick`.** `compute` is handed an `rng`
 *    freshly seeded from the pair on every tick, so a draw at tick N is the same however
 *    many draws earlier ticks made, and a take reproduces exactly under the same seed.
 *    Never `Math.random` or a clock: a recording that cannot be reproduced is not a
 *    recording. `test/state_generator.test.ts` checks this behaviourally and by source.
 * 3. **The read snapshot is re-emitted on a second port** (`snapshot`), every tick,
 *    including ticks where `value` is empty. That is what makes the feedback visible to
 *    the recorder: replaying a take through this node with a reader that serves the
 *    recorded snapshots (and the same seed) reproduces `value` exactly, and a downstream
 *    tap can see what the generator saw. Without it a replayed take silently diverges
 *    from the live one.
 *
 * `ctx.tick` is the engine's tick, deliberately — it is what the design fixes, and it is
 * what a recorded take carries. The one-tick feedback delay is a *tick*, not a duration,
 * so under accelerated play it is not time-invariant (documented on `StateReader`).
 */
import { z } from 'zod';
import { defineNode, STATE_READER_KEY, type NodeContext, type NodeDef, type Role, type StateReader } from '@/dag';

/** The two output ports every state generator declares. */
export const STATE_GENERATOR_OUTPUTS = { value: 'value', snapshot: 'snapshot' } as const;

/**
 * A deterministic PRNG for one `(seed, tick)` pair: an integer hash of the pair seeds a
 * mulberry32 stream. Pure — the same pair always yields the same sequence — which is the
 * whole point: randomness is a function of where the take is, never of when it ran.
 */
export function tickRng(seed: number, tick: number): () => number {
  // Mix seed and tick so neighbouring ticks (and neighbouring seeds) start far apart.
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(tick | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  let a = (h ^ (h >>> 16)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where one named read comes from: a node's output port. */
const ReadRef = z.object({ node: z.string().min(1), port: z.string().min(1) });

export const stateGeneratorParams = z.object({
  /** Seeds `rng` together with `ctx.tick`. Same seed, same take. */
  seed: z.number().int().default(0),
  /** Named reads: `{ name: { node, port } }`. `compute` sees `state[name]`. */
  reads: z.record(z.string(), ReadRef).default({}),
});
export type StateGeneratorParams = z.infer<typeof stateGeneratorParams>;

/** What `compute` is handed each tick. */
export interface StateGeneratorInput {
  /** This tick's reads, by name. A value is `undefined` when the node has not emitted
   *  yet (the first tick, typically) or no reader is published. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Seeded from `seed + ctx.tick`; the only randomness a generator may use. */
  readonly rng: () => number;
  readonly seed: number;
  readonly ctx: NodeContext;
}

export interface StateGeneratorSpec<T> {
  /** Node type id, e.g. `'command-generator'`. */
  type: string;
  title?: string;
  description?: string;
  /** Default `['source']`. (`generate` is the generative-engine modifier, not this.) */
  roles?: Role[];
  /** Port kind of `value`. */
  kind?: string;
  /**
   * Call `compute` even when some read is `undefined` (default false: such a tick emits
   * nothing on `value`). Set it for a generator that seeds its own first value.
   */
  acceptsAbsent?: boolean;
  /** The generator. Returning `undefined` emits nothing on `value` for that tick. */
  compute(input: StateGeneratorInput): T | undefined;
}

/**
 * Build a state-generator source node type. Zero inputs; outputs `value` (what `compute`
 * returned) and `snapshot` (what it read).
 */
export function stateGeneratorSource<T = unknown>(spec: StateGeneratorSpec<T>): NodeDef<StateGeneratorParams> {
  return defineNode<StateGeneratorParams>({
    type: spec.type,
    title: spec.title,
    description: spec.description ?? 'Emits values computed from current DAG state (one-tick feedback via the StateReader).',
    roles: spec.roles ?? ['source'],
    inputs: [],
    outputs: [
      { name: STATE_GENERATOR_OUTPUTS.value, kind: spec.kind },
      {
        name: STATE_GENERATOR_OUTPUTS.snapshot,
        kind: 'state-snapshot',
        description: 'The state read this tick, by read name — re-emitted so a replay reproduces the feedback.',
      },
    ],
    params: stateGeneratorParams,
    process: (_inputs, { seed, reads }, ctx) => {
      const reader = (ctx.resources as Record<string, unknown> | undefined)?.[STATE_READER_KEY] as
        | StateReader
        | undefined;
      const state: Record<string, unknown> = {};
      let complete = true;
      for (const [name, ref] of Object.entries(reads)) {
        const v = reader?.get(ref.node, ref.port);
        state[name] = v;
        if (v === undefined) complete = false;
      }
      const out: Record<string, unknown> = { [STATE_GENERATOR_OUTPUTS.snapshot]: state };
      if (!complete && !spec.acceptsAbsent) return out;
      const value = spec.compute({ state, rng: tickRng(seed, ctx.tick), seed, ctx });
      if (value !== undefined) out[STATE_GENERATOR_OUTPUTS.value] = value;
      return out;
    },
  });
}
