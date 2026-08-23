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
 *
 * **Graph lifecycle.** The graph a running engine evaluates is not frozen at
 * construction: {@link Engine.applyGraph} reconciles the live engine onto a new
 * {@link GraphSpec} *in place*, keeping every node whose type and params are
 * unchanged. That is the load-bearing half of node-swap slots (#51's "engine
 * lifecycle on swap" bullet) — without it, changing one node type means a new
 * `Engine`, which means re-running every `init()`, which means reloading the
 * MediaPipe model and rebuilding the audio voices for a swap that touched one
 * node. See {@link Engine.applyGraph} for the prepare-then-commit protocol that
 * makes the swap glitch-free.
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
import type { ZodType } from 'zod';

interface BuiltNode {
  id: string;
  type: string;
  /**
   * The node's *validated* params (Zod output, so defaults are filled in). Kept
   * on the instance so {@link Engine.applyGraph} can tell "the same node, respecified"
   * from "a genuinely different node" — comparing raw specs would treat `{}` and
   * `undefined` as different when both parse to the same defaults.
   */
  params: unknown;
  handlers: NodeHandlers;
  /** Declared output port names (for tap emission and validation). */
  outputPorts: string[];
  /** output port name -> declared schema, for ports that declare one. Usually empty. */
  outputSchemas: Map<string, ZodType>;
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
  /**
   * Check every emitted value against its {@link PortSpec.schema}, throwing at
   * the offending node and tick. Off by default: this is a batch/dev gate, and
   * running Zod over every port of every node at 60fps is not something the live
   * instrument should pay for. `runHeadless` turns it ON, so the fixture and
   * end-to-end runs get the check for free.
   */
  validatePorts?: boolean;
  log?: (msg: string) => void;
}

/**
 * What one {@link Engine.applyGraph} reconcile actually did. Every node id in the
 * new graph appears in exactly one of `added` / `replaced` / `kept`; `removed`
 * lists ids that were in the old graph and are not in the new one.
 *
 * The distinction that matters to a caller is **`kept` vs the rest**: a kept node
 * is the *same live instance* — its `init()` was not re-run, its internal state
 * (loaded model, smoothing history, sounding voices) is intact, and its last
 * outputs still stand. Anything else was torn down and rebuilt.
 */
export interface GraphChange {
  /** Node ids in the new graph that had no counterpart in the old one. */
  added: string[];
  /** Node ids that were in the old graph and are not in the new one (disposed). */
  removed: string[];
  /** Node ids present in both, but whose type or params differ (rebuilt + re-init'd). */
  replaced: string[];
  /** Node ids carried over as live instances — same type, same validated params. */
  kept: string[];
  /** True when the edge set differs from the previous spec's. */
  rewired: boolean;
}

/**
 * Structural equality for validated node params. Params are plain data by
 * construction (a {@link GraphSpec} is "a complete, serializable description"),
 * so this walks arrays and plain objects and falls back to `Object.is` — which
 * makes any exotic value (a function, a class instance from a `.transform()`)
 * compare by identity. Erring toward "not equal" is the safe direction: the
 * worst case is rebuilding a node that could have been kept.
 */
function paramsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => paramsEqual(x, b[i]));
  }
  // Plain-object walk. A non-plain object (Date, Map, class instance) has already
  // failed Object.is above and its prototype differs from Object.prototype, so
  // treating it as unequal here is the intended conservative answer.
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) {
    return false;
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  return ak.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      paramsEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Order-insensitive edge-set comparison, for the `rewired` flag. */
function sameEdges(a: readonly EdgeSpec[], b: readonly EdgeSpec[]): boolean {
  if (a.length !== b.length) return false;
  const key = (e: EdgeSpec) => `${e.from.node}.${e.from.port}>${e.to.node}.${e.to.port}`;
  const as = a.map(key).sort();
  const bs = b.map(key).sort();
  return as.every((k, i) => k === bs[i]);
}

export class Engine {
  private nodes = new Map<string, BuiltNode>();
  private order: string[] = [];
  /** latest outputs per node: nodeId -> { port -> value }. */
  private outputs = new Map<string, PortValues>();
  private taps: Tap[];
  private resources: Record<string, unknown>;
  private nominalDt: number;
  private validatePorts: boolean;
  private log?: (msg: string) => void;

  /** Kept so {@link applyGraph} can re-resolve node types without the caller re-supplying it. */
  private registry: NodeRegistry;
  /** The spec currently being evaluated (for {@link currentGraph} and edge diffing). */
  private spec: GraphSpec;
  /** Bumped on every committed {@link applyGraph} — a cheap identity for "the wiring changed". */
  private version = 0;
  /**
   * Serializes overlapping {@link applyGraph} calls. Two applies interleaving
   * would each plan against the same old graph and the second commit would
   * dispose instances the first had just adopted.
   */
  private applyQueue: Promise<unknown> = Promise.resolve();
  /** In-flight {@link init}, so an apply cannot swap `order` out from under it. */
  private initPromise: Promise<void> | null = null;

  private tickIndex = -1;
  private lastTime = 0;
  private started = false;
  private disposed = false;

  constructor(spec: GraphSpec, registry: NodeRegistry, opts: EngineOptions = {}) {
    this.taps = opts.taps ?? [];
    this.resources = opts.resources ?? {};
    this.nominalDt = opts.nominalDt ?? 1 / 60;
    this.validatePorts = opts.validatePorts ?? false;
    this.log = opts.log;
    this.registry = registry;
    this.spec = spec;
    const { nodes, order } = compile(spec, registry, new Map());
    this.nodes = nodes;
    this.order = order;
    for (const id of nodes.keys()) this.outputs.set(id, {});
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

  // ---- graph lifecycle ---------------------------------------------------

  /**
   * Reconcile this **running** engine onto `next`, keeping every node the new
   * spec leaves unchanged. Returns a {@link GraphChange} describing what moved.
   *
   * A node is **kept** — the same live instance, `init()` not re-run, state and
   * last outputs intact — when its id, type and *validated* params all match.
   * Otherwise it is disposed and rebuilt. Edges are always re-wired from `next`,
   * which is free (they are just a map on each node).
   *
   * Three phases, in this order, because the middle one is async:
   *
   *  1. **Plan** (sync) — compile the whole next graph: resolve types, validate
   *     params, validate every edge, topo-sort. Anything invalid throws *here*,
   *     before a single live instance has been touched, so a bad spec leaves the
   *     running graph exactly as it was.
   *  2. **Prepare** (async) — `init()` only the new instances, in the new
   *     topological order. The **old graph keeps ticking throughout**: this is
   *     the whole point of splitting prepare from commit, and it is what #51 means
   *     by "handle async `init()` without freezing the tick loop". If any `init`
   *     rejects, the half-built graph is torn down and the running one is kept.
   *  3. **Commit** (sync) — swap the node map, order, outputs and spec in one
   *     synchronous block, then dispose whatever the new graph no longer runs.
   *     `tick()` is synchronous and JS is single-threaded, so no tick can observe
   *     a half-swapped graph.
   *
   * Calling this before {@link init} is fine: the new nodes are not init'd here
   * (there is nothing running to keep alive), and the later `init()` covers the
   * whole graph as usual.
   *
   * @param next the graph to run from now on.
   * @param registry the registry to resolve `next`'s node types against; defaults
   *   to the one this engine was built with.
   */
  async applyGraph(next: GraphSpec, registry: NodeRegistry = this.registry): Promise<GraphChange> {
    const run = this.applyQueue.then(
      () => this.applyGraphNow(next, registry),
      () => this.applyGraphNow(next, registry),
    );
    // A rejected apply must not poison the queue for the next caller.
    this.applyQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async applyGraphNow(next: GraphSpec, registry: NodeRegistry): Promise<GraphChange> {
    if (this.disposed) throw new Error('Engine: applyGraph called on a disposed engine');
    // An init() in flight is iterating the CURRENT order; let it finish before
    // swapping the graph out from under it.
    if (this.initPromise) await this.initPromise.then(undefined, () => undefined);
    if (this.disposed) throw new Error('Engine: applyGraph called on a disposed engine');

    const previous = this.nodes;
    const previousSpec = this.spec;

    // 1. PLAN — throws before anything is mutated.
    const { nodes, order, fresh, kept } = compile(next, registry, previous);

    // 2. PREPARE — init the new instances while the old graph keeps ticking.
    if (this.started) {
      const freshSet = new Set(fresh);
      const ctx = this.makeContext(this.lastTime, 0);
      try {
        for (const id of order) {
          if (!freshSet.has(id)) continue;
          await nodes.get(id)!.handlers.init?.(ctx);
        }
      } catch (err) {
        // Tear down only what we just built; the running graph is untouched.
        for (const id of fresh) disposeQuietly(nodes.get(id)!, this.log);
        throw err;
      }
    }

    // The engine may have been disposed while PREPARE was awaiting an `init()`
    // — in the browser that is a React unmount landing on top of a swap that is
    // still loading a model. Committing anyway would adopt the instances we just
    // built into a dead engine, where nothing can ever reach them again (every
    // later applyGraph throws), and would re-dispose the old ones that `dispose()`
    // has already torn down. Treat it exactly like a rejected `init`: release
    // what PREPARE built, change nothing, and say why.
    if (this.disposed) {
      for (const id of fresh) disposeQuietly(nodes.get(id)!, this.log);
      throw new Error('Engine: disposed while applyGraph was preparing');
    }

    // 3. COMMIT — one synchronous block, so no tick sees a half-swapped graph.
    const keptSet = new Set(kept);
    const outputs = new Map<string, PortValues>();
    for (const id of nodes.keys()) {
      // A kept node's last outputs stand, so downstream readers see no one-tick hole.
      outputs.set(id, (keptSet.has(id) ? this.outputs.get(id) : undefined) ?? {});
    }
    this.nodes = nodes;
    this.order = order;
    this.outputs = outputs;
    this.spec = next;
    this.registry = registry;
    this.version += 1;

    // Dispose whatever the new graph no longer runs. Identity on `handlers` is
    // the exact test: it covers removed nodes AND the old instances of replaced
    // ones, and can never catch a kept node (whose handlers are in `nodes`).
    const surviving = new Set<NodeHandlers>();
    for (const n of nodes.values()) surviving.add(n.handlers);
    for (const n of previous.values()) {
      if (!surviving.has(n.handlers)) disposeQuietly(n, this.log);
    }

    const previousIds = new Set(previous.keys());
    return {
      added: fresh.filter((id) => !previousIds.has(id)),
      removed: [...previousIds].filter((id) => !nodes.has(id)),
      replaced: fresh.filter((id) => previousIds.has(id)),
      kept,
      rewired: !sameEdges(previousSpec.edges, next.edges),
    };
  }

  /**
   * The spec this engine is currently evaluating. A fresh container holding the
   * *same* node/edge objects — safe to read and to spread into a modified spec
   * for {@link applyGraph}, not a deep clone.
   */
  currentGraph(): GraphSpec {
    return { nodes: [...this.spec.nodes], edges: [...this.spec.edges] };
  }

  /** How many times {@link applyGraph} has committed — 0 for a never-rewired engine. */
  graphVersion(): number {
    return this.version;
  }

  // ---- run --------------------------------------------------------------

  /** Call each node's async `init` once, in dependency order. */
  async init(): Promise<void> {
    if (this.started) return;
    if (!this.initPromise) {
      this.initPromise = this.initAll().finally(() => {
        this.initPromise = null;
      });
    }
    await this.initPromise;
  }

  private async initAll(): Promise<void> {
    const ctx = this.makeContext(this.lastTime, 0);
    // Snapshot the order: an applyGraph awaits `initPromise` before committing,
    // but iterating a snapshot means a future change to that ordering cannot
    // turn into a mid-loop `undefined` node.
    for (const id of [...this.order]) {
      // `dispose()` tears down every node in the map, including ones this loop
      // has not reached yet. Continuing would init a node that has already been
      // disposed, and nothing would ever dispose it again.
      if (this.disposed) return;
      const node = this.nodes.get(id);
      if (node?.handlers.init) await node.handlers.init(ctx);
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
    // A frame already scheduled when the host tore the engine down would
    // otherwise run `process()` against released handles (a closed MediaPipe
    // landmarker, disconnected audio nodes). Ticking a disposed engine is a
    // caller bug; doing nothing is the safe reading of it.
    if (this.disposed) return;
    this.tickIndex += 1;
    const t = time ?? (this.tickIndex * this.nominalDt);
    const dt = this.tickIndex === 0 ? 0 : Math.max(0, t - this.lastTime);
    this.lastTime = t;
    const ctx = this.makeContext(t, dt);

    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      const inputs = this.gatherInputs(node);
      const out = node.handlers.process(inputs, ctx) ?? {};
      if (this.validatePorts && node.outputSchemas.size) this.checkOutputPorts(node, out);
      this.outputs.set(id, out);
      if (this.taps.length) this.emitTaps(node, out, ctx);
    }
  }

  /**
   * Port conformance (batch/dev only — see {@link EngineOptions.validatePorts}).
   * Runs in `tick`'s output path rather than `emitTaps` on purpose: taps skip
   * `undefined`, and "the node emitted nothing" is exactly the failure this is
   * here to catch. Throwing names the node, the port and the tick, because a
   * malformed frame surfaces far downstream as a wrong note, not as an error.
   */
  private checkOutputPorts(node: BuiltNode, out: PortValues): void {
    for (const [port, schema] of node.outputSchemas) {
      const result = schema.safeParse(out[port]);
      if (result.success) continue;
      const detail =
        out[port] === undefined
          ? 'it emitted nothing (undefined) on a port whose schema is not optional'
          : String(result.error.message);
      throw new Error(
        `Engine: node "${node.id}" (${node.type}) violated the schema of output port ` +
          `"${port}" at tick ${this.tickIndex}: ${detail}`,
      );
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

  /**
   * Tear the whole graph down. Idempotent, and **best-effort per node**: one
   * node's `dispose` throwing must not strand the ones after it. The sinks sort
   * last in topological order, so an abort here is the worst case there is — the
   * synth's oscillators keep sounding, `midi-out` never fires its all-notes-off
   * and holds the port, and a camera node keeps its inference loop running. It
   * also runs inside the host's own cleanup (`useEngine`), where an escaping
   * throw would skip stopping the camera tracks.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of this.order) {
      const node = this.nodes.get(id);
      if (node) disposeQuietly(node, this.log);
    }
  }
}

// ---- compilation (shared by the constructor and applyGraph) ---------------

/** Dispose a node without letting its teardown abort the caller's own cleanup. */
function disposeQuietly(node: BuiltNode, log?: (msg: string) => void): void {
  try {
    node.handlers.dispose?.();
  } catch (err) {
    log?.(`Engine: dispose of node "${node.id}" (${node.type}) threw: ${String(err)}`);
  }
}

/**
 * Turn a {@link GraphSpec} into an executable node map + evaluation order,
 * **reusing** any instance in `reusable` whose id, type and validated params all
 * match. Pure with respect to engine state: it never touches the live graph, so
 * a throw here leaves a running engine exactly as it was.
 *
 * `fresh` lists the ids this call instantiated (the ones that still need
 * `init()`); `kept` lists the ids carried over from `reusable`. Together they
 * cover every node in `spec`.
 */
function compile(
  spec: GraphSpec,
  registry: NodeRegistry,
  reusable: ReadonlyMap<string, BuiltNode>,
): { nodes: Map<string, BuiltNode>; order: string[]; fresh: string[]; kept: string[] } {
  const nodes = new Map<string, BuiltNode>();
  const fresh: string[] = [];
  const kept: string[] = [];

  try {
    for (const n of spec.nodes) {
      if (nodes.has(n.id)) throw new Error(`Engine: duplicate node id "${n.id}"`);
      const def = registry.get(n.type);
      let params: unknown;
      try {
        params = def.params.parse(n.params ?? {});
      } catch (err) {
        throw new Error(`Engine: invalid params for node "${n.id}" (${n.type}): ${String(err)}`);
      }

      const prev = reusable.get(n.id);
      if (prev && prev.type === n.type && paramsEqual(prev.params, params)) {
        // Carry the LIVE instance over — same type, same params means same
        // behaviour, and (the point of all this) the same already-init'd state:
        // the loaded ML model, the smoothing history, the sounding voices.
        // `incoming` is rebuilt from the new edges below.
        nodes.set(n.id, { ...prev, incoming: new Map() });
        kept.push(n.id);
        continue;
      }

      const inputDefaults = new Map<string, unknown>();
      for (const p of def.inputs) {
        if (p.default !== undefined) inputDefaults.set(p.name, p.default);
      }
      const outputSchemas = new Map<string, ZodType>();
      for (const p of def.outputs) {
        if (p.schema) outputSchemas.set(p.name, p.schema);
      }
      nodes.set(n.id, {
        id: n.id,
        type: n.type,
        params,
        handlers: def.make(params as never),
        outputPorts: def.outputs.map((p) => p.name),
        outputSchemas,
        inputDefaults,
        incoming: new Map(),
      });
      fresh.push(n.id);
    }

    // Wire edges (validate endpoints; reject duplicate fan-in to one input port).
    for (const e of spec.edges) {
      validateEdge(e, nodes, registry);
      const target = nodes.get(e.to.node)!;
      if (target.incoming.has(e.to.port)) {
        throw new Error(
          `Engine: input port "${e.to.node}.${e.to.port}" already has an edge; ` +
            `fan-in to one input is not allowed (use a merge node).`,
        );
      }
      target.incoming.set(e.to.port, { node: e.from.node, port: e.from.port });
    }

    return { nodes, order: topoSort(nodes, spec.edges), fresh, kept };
  } catch (err) {
    // Release anything this failed compile constructed. Reused instances belong
    // to the live graph and are deliberately left alone.
    for (const id of fresh) disposeQuietly(nodes.get(id)!);
    throw err;
  }
}

function validateEdge(e: EdgeSpec, nodes: ReadonlyMap<string, BuiltNode>, registry: NodeRegistry): void {
  const from = nodes.get(e.from.node);
  const to = nodes.get(e.to.node);
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
function topoSort(nodes: ReadonlyMap<string, BuiltNode>, edges: readonly EdgeSpec[]): string[] {
  const indeg = new Map<string, number>();
  const adj = new Map<string, Set<string>>();
  for (const id of nodes.keys()) {
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
  if (order.length !== nodes.size) {
    throw new Error('Engine: graph has a cycle (not allowed in v0; use explicit delay nodes for feedback)');
  }
  return order;
}
