/**
 * Core type model for the Thoremin dataflow DAG.
 *
 * The DAG is the spine of the whole app: live sensor inputs flow through
 * feature extraction, mapping, music-logic and synthesis nodes to audiovisual
 * outputs. It is a deliberate TypeScript mirror of the Python `meshed` library
 * used in the sibling `theremin` project — a set of typed nodes wired by edges,
 * evaluated in dependency order.
 *
 * Design goals (in priority order):
 *  1. **Testable.** Every edge can be *tapped* (observed), *recorded* to disk,
 *     and *replayed*. That makes downstream nodes testable without re-running
 *     the expensive upstream nodes (camera + ML inference).
 *  2. **Composable.** Nodes are small, parameterizable units with typed ports.
 *  3. **Framework-agnostic.** This module has zero React / DOM / audio deps so
 *     it runs in plain Node for fast unit tests.
 */
import type { ZodType } from 'zod';

/**
 * A Zod schema whose *output* is `P` but whose *input* is unconstrained. Node
 * params schemas use `.default()`, which makes the input type optional (e.g.
 * `{ root?: number }`) while the parsed output is required (`{ root: number }`).
 * `ZodType<P>` would force input === output and reject those schemas, so we
 * relax the input parameter to `any`.
 */
export type ParamsSchema<P> = ZodType<P, any, any>;

/** A frame of values flowing on a node's ports, keyed by port name. */
export type PortValues = Record<string, unknown>;

/** Declares a single input or output port on a node definition. */
export interface PortSpec {
  /** Port name, unique within the node's inputs (or outputs). */
  name: string;
  /**
   * Semantic type tag used for documentation, UI affordances, and (future)
   * connection validation — e.g. 'number', 'landmarks', 'note-event',
   * 'audio-params', 'frame'. Not enforced at runtime in v0.
   */
  kind?: string;
  description?: string;
  /** Optional default value used when no edge feeds this input port. */
  default?: unknown;
}

/**
 * Context passed to every node on each evaluation tick. Carries timing plus a
 * bag of host-injected `resources` (e.g. an AudioContext in the browser). Tests
 * pass an empty resources bag, so pure nodes never touch the host.
 */
export interface NodeContext {
  /** Monotonic tick counter, incremented once per engine evaluation. */
  tick: number;
  /** Wall-clock-ish time in seconds for this tick (monotonic, host-provided). */
  time: number;
  /** Seconds elapsed since the previous tick (0 on the first tick). */
  dt: number;
  /** Host-injected shared resources (AudioContext, canvas, etc.). */
  resources: Record<string, unknown>;
  /** Optional structured logger. */
  log?: (msg: string) => void;
}

/**
 * The per-instance behaviour of a node. Returned by a {@link NodeDef}'s factory
 * once the node's params have been validated. Most nodes only implement
 * `process`; `init`/`dispose` are for nodes that own resources (a synth voice,
 * a websocket session, a recorder).
 */
export interface NodeHandlers {
  /** Called once before the first `process`. May be async (e.g. load a model). */
  init?(ctx: NodeContext): void | Promise<void>;
  /** Called once per tick. Reads input port values, returns output port values. */
  process(inputs: PortValues, ctx: NodeContext): PortValues;
  /** Called when the engine is torn down. Release resources here. */
  dispose?(): void;
}

/**
 * A node *definition* — the reusable "type" of a node (like a class). Holds
 * metadata, port declarations, a Zod params schema, and a factory that builds
 * the per-instance {@link NodeHandlers} from validated params.
 */
export interface NodeDef<P = unknown> {
  /** Unique node type name, e.g. 'hand-features', 'scale-snap'. */
  type: string;
  title?: string;
  description?: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** Zod schema validating (and defaulting) this node's params. */
  params: ParamsSchema<P>;
  /** Build the instance behaviour from validated params. */
  make(params: P): NodeHandlers;
}

/** A node placement in a graph: an id plus the type to instantiate and its params. */
export interface NodeSpec {
  id: string;
  type: string;
  /** Raw params; validated against the NodeDef's Zod schema at build time. */
  params?: unknown;
}

/** A directed edge carrying one node's output port value into another's input port. */
export interface EdgeSpec {
  from: { node: string; port: string };
  to: { node: string; port: string };
}

/** A complete, serializable description of a dataflow graph. */
export interface GraphSpec {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

/**
 * A tap observes every output-port value as it is produced each tick. Used for
 * recording streams to disk, live debugging, and visualisation. The `key` is
 * `"<nodeId>.<port>"`.
 */
export interface Tap {
  onValue(key: string, value: unknown, ctx: NodeContext): void;
}

/** One recorded sample on a stream (a single node-port over one tick). */
export interface StreamRecord {
  /** Tick index. */
  tick: number;
  /** Time in seconds. */
  t: number;
  /** The recorded value (must be JSON-serializable to persist). */
  value: unknown;
}
