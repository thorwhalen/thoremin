/**
 * Engine — builds a runnable graph from a {@link GraphSpec} + {@link NodeRegistry}
 * and evaluates it one tick at a time in dependency order.
 *
 * Execution model (v0): a single evaluation rate. On each `tick(time)` every
 * node runs exactly once, in topological order, reading the *current* tick's
 * upstream outputs. Cycles are rejected at build time (feedback will later be
 * expressed with explicit one-tick `delay` nodes that break the cycle). This
 * matches how the existing Thoremin loop works — features and synth params are
 * recomputed every animation frame — while making the data path explicit and
 * tap-able.
 */
import type {
  EdgeSpec,
  GraphSpec,
  NodeContext,
  NodeHandlers,
  PortValues,
  Tap,
} from './types';
import type { NodeRegistry } from './registry';

interface BuiltNode {
  id: string;
  type: string;
  handlers: NodeHandlers;
  /** Declared output port names (for tap emission and validation). */
  outputPorts: string[];
  /** input port name -> default value (from PortSpec.default), if any. */
  inputDefaults: Map<string, unknown>;
  /** incoming edges, grouped by target input port. */
  incoming: Map<string, { node: string; port: string }>;
}

export interface EngineOptions {
  /** Host resources made available to every node via ctx.resources. */
  resources?: Record<string, unknown>;
  /** Nominal seconds-per-tick when `tick()` is called without an explicit time. */
  nominalDt?: number;
  /** Taps notified of every output-port value each tick (e.g. a recorder). */
  taps?: Tap[];
  log?: (msg: string) => void;
}

export class Engine {
  private nodes = new Map<string, BuiltNode>();
  private order: string[] = [];
  /** latest outputs per node: nodeId -> { port -> value }. */
  private outputs = new Map<string, PortValues>();
  private taps: Tap[];
  private resources: Record<string, unknown>;
  private nominalDt: number;
  private log?: (msg: string) => void;

  private tickIndex = -1;
  private lastTime = 0;
  private started = false;

  constructor(spec: GraphSpec, registry: NodeRegistry, opts: EngineOptions = {}) {
    this.taps = opts.taps ?? [];
    this.resources = opts.resources ?? {};
    this.nominalDt = opts.nominalDt ?? 1 / 60;
    this.log = opts.log;
    this.build(spec, registry);
  }

  /**
   * Attach a {@link Tap} after construction and get back a detach function.
   * Constructor `opts.taps` covers the headless record/replay path (a fixed set
   * of taps for the whole run); this is its live counterpart — a running engine
   * (e.g. the browser rAF loop) can start/stop tapping mid-session without a
   * rebuild (which would reload the ML model). Used by recording-v2 (#88) to
   * capture a feature stream to JSONL only while a take is in progress. Idempotent
   * per tap; the returned function removes exactly this registration.
   */
  addTap(tap: Tap): () => void {
    this.taps.push(tap);
    return () => this.removeTap(tap);
  }

  /** Detach a previously {@link addTap}'d tap (no-op if not attached). */
  removeTap(tap: Tap): void {
    const i = this.taps.indexOf(tap);
    if (i >= 0) this.taps.splice(i, 1);
  }

  // ---- build ------------------------------------------------------------

  private build(spec: GraphSpec, registry: NodeRegistry): void {
    const ids = new Set<string>();
    for (const n of spec.nodes) {
      if (ids.has(n.id)) throw new Error(`Engine: duplicate node id "${n.id}"`);
      ids.add(n.id);
    }

    // Instantiate nodes (validate params via Zod).
    for (const n of spec.nodes) {
      const def = registry.get(n.type);
      let params: unknown;
      try {
        params = def.params.parse(n.params ?? {});
      } catch (err) {
        throw new Error(`Engine: invalid params for node "${n.id}" (${n.type}): ${String(err)}`);
      }
      const handlers = def.make(params as never);
      const inputDefaults = new Map<string, unknown>();
      for (const p of def.inputs) {
        if (p.default !== undefined) inputDefaults.set(p.name, p.default);
      }
      this.nodes.set(n.id, {
        id: n.id,
        type: n.type,
        handlers,
        outputPorts: def.outputs.map((p) => p.name),
        inputDefaults,
        incoming: new Map(),
      });
      this.outputs.set(n.id, {});
    }

    // Wire edges (validate endpoints; reject duplicate fan-in to one input port).
    for (const e of spec.edges) {
      this.validateEdge(e, registry);
      const target = this.nodes.get(e.to.node)!;
      if (target.incoming.has(e.to.port)) {
        throw new Error(
          `Engine: input port "${e.to.node}.${e.to.port}" already has an edge; ` +
            `fan-in to one input is not allowed (use a merge node).`,
        );
      }
      target.incoming.set(e.to.port, { node: e.from.node, port: e.from.port });
    }

    this.order = this.topoSort(spec.edges);
  }

  private validateEdge(e: EdgeSpec, registry: NodeRegistry): void {
    const from = this.nodes.get(e.from.node);
    const to = this.nodes.get(e.to.node);
    if (!from) throw new Error(`Engine: edge from unknown node "${e.from.node}"`);
    if (!to) throw new Error(`Engine: edge to unknown node "${e.to.node}"`);
    const fromDef = registry.get(from.type);
    const toDef = registry.get(to.type);
    if (!fromDef.outputs.some((p) => p.name === e.from.port)) {
      throw new Error(`Engine: node "${from.id}" (${from.type}) has no output port "${e.from.port}"`);
    }
    if (!toDef.inputs.some((p) => p.name === e.to.port)) {
      throw new Error(`Engine: node "${to.id}" (${to.type}) has no input port "${e.to.port}"`);
    }
  }

  /** Kahn's algorithm; throws on cycles. */
  private topoSort(edges: EdgeSpec[]): string[] {
    const indeg = new Map<string, number>();
    const adj = new Map<string, Set<string>>();
    for (const id of this.nodes.keys()) {
      indeg.set(id, 0);
      adj.set(id, new Set());
    }
    for (const e of edges) {
      if (e.from.node === e.to.node) {
        throw new Error(`Engine: self-loop on node "${e.from.node}" not allowed in v0`);
      }
      // Count a dependency once even if multiple ports connect the same pair.
      if (!adj.get(e.from.node)!.has(e.to.node)) {
        adj.get(e.from.node)!.add(e.to.node);
        indeg.set(e.to.node, (indeg.get(e.to.node) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [id, d] of indeg) if (d === 0) queue.push(id);
    queue.sort(); // deterministic ordering among independents
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      const next: string[] = [];
      for (const m of adj.get(id)!) {
        indeg.set(m, indeg.get(m)! - 1);
        if (indeg.get(m) === 0) next.push(m);
      }
      next.sort();
      queue.push(...next);
    }
    if (order.length !== this.nodes.size) {
      throw new Error('Engine: graph has a cycle (not allowed in v0; use explicit delay nodes for feedback)');
    }
    return order;
  }

  // ---- run --------------------------------------------------------------

  /** Call each node's async `init` once, in dependency order. */
  async init(): Promise<void> {
    if (this.started) return;
    const ctx = this.makeContext(this.lastTime, 0);
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      if (node.handlers.init) await node.handlers.init(ctx);
    }
    this.started = true;
  }

  private makeContext(time: number, dt: number): NodeContext {
    return { tick: Math.max(0, this.tickIndex), time, dt, resources: this.resources, log: this.log };
  }

  /**
   * Evaluate the whole graph once. `time` is seconds (monotonic); if omitted it
   * advances by `nominalDt` for deterministic headless runs.
   */
  tick(time?: number): void {
    this.tickIndex += 1;
    const t = time ?? (this.tickIndex * this.nominalDt);
    const dt = this.tickIndex === 0 ? 0 : Math.max(0, t - this.lastTime);
    this.lastTime = t;
    const ctx = this.makeContext(t, dt);

    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      const inputs = this.gatherInputs(node);
      const out = node.handlers.process(inputs, ctx) ?? {};
      this.outputs.set(id, out);
      if (this.taps.length) this.emitTaps(node, out, ctx);
    }
  }

  private gatherInputs(node: BuiltNode): PortValues {
    const inputs: PortValues = {};
    // Start from declared defaults so unconnected inputs are well-defined.
    for (const [port, def] of node.inputDefaults) inputs[port] = def;
    for (const [port, src] of node.incoming) {
      const upstream = this.outputs.get(src.node);
      const v = upstream ? upstream[src.port] : undefined;
      if (v !== undefined) inputs[port] = v;
    }
    return inputs;
  }

  private emitTaps(node: BuiltNode, out: PortValues, ctx: NodeContext): void {
    for (const port of node.outputPorts) {
      const v = out[port];
      if (v === undefined) continue;
      const key = `${node.id}.${port}`;
      for (const tap of this.taps) tap.onValue(key, v, ctx);
    }
  }

  /** Read the latest value produced on a node's output port (for overlays/UI). */
  getOutput(nodeId: string, port: string): unknown {
    return this.outputs.get(nodeId)?.[port];
  }

  /** The computed topological evaluation order (node ids). */
  evaluationOrder(): readonly string[] {
    return this.order;
  }

  dispose(): void {
    for (const id of this.order) {
      const node = this.nodes.get(id);
      node?.handlers.dispose?.();
    }
  }
}
