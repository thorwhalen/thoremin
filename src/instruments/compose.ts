/**
 * `composeGraph`: a pure union of branches into one `GraphSpec` the engine already
 * understands (`docs/design/instruments-as-graphs-and-extensions.md` §3.2). Four rules:
 *
 * 1. Shared nodes must be the same node. A node id declared by two branches must resolve to
 *    the same type and structurally equal params; a conflicting duplicate is an error that
 *    names both branches. This is the identity `Engine.applyGraph` reuses a live node on.
 * 2. An edge belongs to the branch that declares it and may reach a node in another branch.
 *    If that node is absent, an `optional` edge is dropped and a required one is an error
 *    (say `requires`, or mark the edge optional). Two edges into one input port are an error
 *    here too, earlier and with branch names, rather than in the engine.
 * 3. Voices are allocated by role. Each declared voice gets the next free input of the merge
 *    pool for its role (`instrument` inputs are hushed, `score` inputs kept), so which input
 *    a stream arrives on is never remembered anywhere.
 * 4. The overlay element set is data: the composer returns the union of the branches'
 *    `overlay` lists; the host delivers it to the overlay through a port, never a param
 *    (a param change would rebuild the overlay node on every switch).
 *
 * Deterministic: the same branch ids in the same order give the same spec, node for node
 * and edge for edge. Pure and Node-safe: no engine, no DOM.
 */
import type { EdgeSpec, GraphSpec, NodeSpec } from '@/dag';
import type { GraphBranch, VoiceRole } from './branch';

export interface MergeTarget {
  /** The merge node's id in the composed graph. */
  node: string;
  /** Input port names per voice role, in allocation order. */
  pools: Readonly<Record<VoiceRole, readonly string[]>>;
}

export interface ComposeOptions {
  /** Resolved slot selection: slot name → node type (`source` → `webcam-hands`). */
  slots?: Readonly<Record<string, string>>;
  /** Where declared voices go. Required when any composed branch declares a voice. */
  merge?: MergeTarget;
}

export interface Composed {
  spec: GraphSpec;
  /** Overlay element ids some branch asked for, in first-seen order, deduplicated. */
  elements: string[];
  /** The branch ids actually composed, requirements included, in composition order. */
  branches: string[];
}

export class ComposeError extends Error {
  constructor(message: string) {
    super(`composeGraph: ${message}`);
    this.name = 'ComposeError';
  }
}

type Library = Readonly<Record<string, GraphBranch>>;

function asLibrary(lib: Library | readonly GraphBranch[]): Library {
  if (!Array.isArray(lib)) return lib as Library;
  const out: Record<string, GraphBranch> = {};
  for (const b of lib as readonly GraphBranch[]) {
    if (out[b.id]) throw new ComposeError(`branch "${b.id}" is defined twice`);
    out[b.id] = b;
  }
  return out;
}

/** Requirements first, then the branch; each id once; order otherwise as given. */
function resolveClosure(ids: readonly string[], lib: Library): GraphBranch[] {
  const seen = new Set<string>();
  const out: GraphBranch[] = [];
  const visit = (id: string, via: string[]): void => {
    if (seen.has(id)) return;
    const b = lib[id];
    if (!b) {
      const path = via.length ? ` (required via ${via.join(' → ')})` : '';
      throw new ComposeError(`unknown branch "${id}"${path}`);
    }
    if (via.includes(id)) throw new ComposeError(`"requires" cycle: ${[...via, id].join(' → ')}`);
    for (const r of b.requires) visit(r, [...via, id]);
    seen.add(id);
    out.push(b);
  };
  for (const id of ids) visit(id, []);
  return out;
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => structurallyEqual(x, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      structurallyEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

const portKey = (p: { node: string; port: string }): string => `${p.node}.${p.port}`;

export function composeGraph(
  branchIds: readonly string[],
  library: Library | readonly GraphBranch[],
  opts: ComposeOptions = {},
): Composed {
  const lib = asLibrary(library);
  const branches = resolveClosure(branchIds, lib);

  // Rule 1: nodes, with shared-node identity.
  const nodes = new Map<string, { spec: NodeSpec; owner: string }>();
  for (const b of branches) {
    for (const n of b.nodes) {
      const type = n.type ?? opts.slots?.[n.slot as string];
      if (!type) {
        throw new ComposeError(`branch "${b.id}": node "${n.id}" fills slot "${n.slot}" but no type was resolved for it`);
      }
      const params = n.paramsByType && type in n.paramsByType ? n.paramsByType[type] : n.params;
      const spec: NodeSpec = params === undefined ? { id: n.id, type } : { id: n.id, type, params };
      const prev = nodes.get(n.id);
      if (prev) {
        const same = prev.spec.type === spec.type && structurallyEqual(prev.spec.params ?? {}, spec.params ?? {});
        if (!same) {
          throw new ComposeError(
            `node "${n.id}" is declared by branches "${prev.owner}" and "${b.id}" with different type or params`,
          );
        }
        continue;
      }
      nodes.set(n.id, { spec, owner: b.id });
    }
  }

  // Rule 2: owned edges; drop optional edges to absent nodes; refuse fan-in.
  const edges: EdgeSpec[] = [];
  const takenInputs = new Map<string, string>(); // "node.port" → declaring branch
  const addEdge = (e: EdgeSpec, owner: string): void => {
    const key = portKey(e.to);
    const prior = takenInputs.get(key);
    if (prior) {
      throw new ComposeError(`input "${key}" is fed twice (branches "${prior}" and "${owner}"); the engine rejects fan-in`);
    }
    takenInputs.set(key, owner);
    edges.push(e);
  };
  for (const b of branches) {
    for (const e of b.edges) {
      const missing = [e.from.node, e.to.node].filter((id) => !nodes.has(id));
      if (missing.length) {
        if (e.optional) continue;
        throw new ComposeError(
          `branch "${b.id}" declares edge ${portKey(e.from)} → ${portKey(e.to)} but node "${missing[0]}" is not in the ` +
            `composed graph (add it to "requires", or mark the edge optional)`,
        );
      }
      const spec: EdgeSpec = { from: e.from, to: e.to };
      if (e.delayed) spec.delayed = true;
      addEdge(spec, b.id);
    }
  }

  // Rule 3: voices, allocated by role.
  const used: Record<VoiceRole, number> = { instrument: 0, score: 0 };
  for (const b of branches) {
    for (const v of b.voices) {
      if (!opts.merge) throw new ComposeError(`branch "${b.id}" declares a voice but no merge target was given`);
      if (!nodes.has(opts.merge.node)) {
        throw new ComposeError(`merge node "${opts.merge.node}" is not in the composed graph (the trunk must declare it)`);
      }
      if (!nodes.has(v.from.node)) {
        throw new ComposeError(`branch "${b.id}" declares voice ${portKey(v.from)} but node "${v.from.node}" is not in it`);
      }
      const pool = opts.merge.pools[v.role];
      const port = pool[used[v.role]];
      if (!port) {
        throw new ComposeError(
          `merge pool "${v.role}" is full (${pool.length} inputs) at branch "${b.id}"; widen the pool on the merge node`,
        );
      }
      used[v.role] += 1;
      addEdge({ from: v.from, to: { node: opts.merge.node, port } }, b.id);
    }
  }

  // Rule 4: the element set is data.
  const elements: string[] = [];
  for (const b of branches) for (const el of b.overlay) if (!elements.includes(el)) elements.push(el);

  return {
    spec: { nodes: [...nodes.values()].map((n) => n.spec), edges },
    elements,
    branches: branches.map((b) => b.id),
  };
}
