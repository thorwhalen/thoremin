/**
 * `composeGraph`: a pure union of branches into one `GraphSpec` the engine already
 * understands (`docs/design/instruments-as-graphs-and-extensions.md` §3.2). Five rules:
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
 *    a stream arrives on is never remembered anywhere. Chord producers (`chords`, #600 S4) are
 *    a second pool: each gets the next free input of the chord selector, highest priority
 *    first, and the selector (with its edge to the overlay) is composed when any is declared.
 *    Category readers (`categories`, #600 S10b) are a third: each gets the next free input of the
 *    overlay's pool for its kind, highest priority first, and a classifier's captions
 *    (`categoryCaptions`) go to the input beside its reader's.
 * 4. The overlay element set is data: the composer returns the union of the branches'
 *    `overlay` lists; the host delivers it to the overlay through a port, never a param
 *    (a param change would rebuild the overlay node on every switch).
 * 5. A branch may REPLACE others (`replaces`): when the replacing branch is in the closure, the
 *    replaced ones are dropped, and the closure is resolved again without them (so what only
 *    they required goes too). A replaced branch that something else still requires is an
 *    error. This is how an extension swaps a part of a core instrument (#330: a personal face
 *    categorizer for the general one) without core naming it.
 *
 * Deterministic and ORDER-INDEPENDENT: the composition order is the library's order (the
 * branch table), whatever order the caller names branches in, so the same SET of branch ids
 * always gives the same spec, node for node, edge for edge and merge input for merge input.
 * That matters because the overlay reads the hand voices by position in the merged stream
 * and a data-dependent caller order (an instrument's set plus a live demand's) would
 * otherwise move them. Pure and Node-safe: no engine, no DOM.
 */
import type { EdgeSpec, GraphSpec, NodeSpec } from '@thoremin/dag';
import type { CategoryKind, GraphBranch, VoiceRole } from '@thoremin/sdk/instruments/branch';

export interface MergeTarget {
  /** The merge node's id in the composed graph. */
  node: string;
  /** Input port names per voice role, in allocation order. */
  pools: Readonly<Record<VoiceRole, readonly string[]>>;
}

/**
 * Where declared chord producers go (#600 S4): the chord selector's node, its type and params
 * (the composer adds it when no branch declares it), its input pool in priority order, and the
 * edges from its output (added when their target is composed).
 */
export interface ChordTarget {
  node: string;
  type: string;
  params?: unknown;
  pool: readonly string[];
  outputs: readonly { port: string; to: { node: string; port: string } }[];
}

/**
 * Where declared category readers go (#600 S10b): the overlay's node, its two input pools in
 * priority order, and the captions input beside a classifier slot.
 */
export interface CategoryTarget {
  node: string;
  pools: Readonly<Record<CategoryKind, readonly string[]>>;
  captions: (slot: string) => string;
}

export interface ComposeOptions {
  /** Resolved slot selection: slot name → node type (`source` → `webcam-hands`). */
  slots?: Readonly<Record<string, string>>;
  /** Where declared voices go. Required when any composed branch declares a voice. */
  merge?: MergeTarget;
  chords?: ChordTarget;
  categories?: CategoryTarget;
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

/** The transitive closure over `requires`, each id once, in the LIBRARY's order. */
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
  const position = new Map(Object.keys(lib).map((id, i) => [id, i] as const));
  return out.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}

/**
 * The closure of `ids` with rule 5 applied: the branches some branch in it replaces are left
 * out, and the closure resolved again without them.
 */
function resolveComposed(ids: readonly string[], lib: Library): GraphBranch[] {
  const first = resolveClosure(ids, lib);
  const replacedBy = new Map<string, string>();
  for (const b of first) for (const r of b.replaces ?? []) if (r !== b.id && !replacedBy.has(r)) replacedBy.set(r, b.id);
  if (replacedBy.size === 0) return first;
  const kept = resolveClosure(ids.filter((id) => !replacedBy.has(id)), lib);
  for (const b of kept) {
    const by = replacedBy.get(b.id);
    if (by) throw new ComposeError(`branch "${b.id}" is replaced by "${by}" but another composed branch requires it`);
  }
  return kept;
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

/**
 * The branch ids `ids` compose to, requirements included, in library order; unknown ids are
 * dropped (this is the facet and validation helper, and a stale id in a saved record must not
 * throw). `composeGraph` itself still refuses an unknown id.
 */
export function branchClosureIds(ids: readonly string[], library: Library | readonly GraphBranch[]): string[] {
  const lib = asLibrary(library);
  const known = ids.filter((id) => id in lib);
  return resolveComposed(known, lib).map((b) => b.id);
}

export function composeGraph(
  branchIds: readonly string[],
  library: Library | readonly GraphBranch[],
  opts: ComposeOptions = {},
): Composed {
  const lib = asLibrary(library);
  // Rule 5 first: what the composed set replaces is not composed at all.
  const branches = resolveComposed(branchIds, lib);

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
  const takenInputs = new Map<string, { owner: string; from: string }>(); // "node.port" → who feeds it
  const addEdge = (e: EdgeSpec, owner: string): void => {
    const key = portKey(e.to);
    const prior = takenInputs.get(key);
    if (prior) {
      // The same edge declared by two branches is one edge (rule 1's tolerance, for edges).
      if (prior.from === portKey(e.from)) return;
      throw new ComposeError(
        `input "${key}" is fed twice (branches "${prior.owner}" and "${owner}"); the engine rejects fan-in`,
      );
    }
    takenInputs.set(key, { owner, from: portKey(e.from) });
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
  const declaredVoices = new Map<string, string>(); // "node.port" → declaring branch
  for (const b of branches) {
    for (const v of b.voices) {
      const prior = declaredVoices.get(portKey(v.from));
      if (prior) {
        throw new ComposeError(`voice ${portKey(v.from)} is declared by branches "${prior}" and "${b.id}"; a voice has one owner`);
      }
      declaredVoices.set(portKey(v.from), b.id);
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

  // Rule 3b: chord producers, allocated by priority into the chord selector's free inputs (an
  // explicit edge into the pool, such as an extension that predates the pool, keeps its input).
  const chordDecls = branches.flatMap((b, bi) => b.chords.map((c, ci) => ({ ...c, owner: b.id, order: bi * 1000 + ci })));
  if (chordDecls.length) {
    const target = opts.chords;
    if (!target) throw new ComposeError(`branch "${chordDecls[0].owner}" declares a chord producer but no chord target was given`);
    const existing = nodes.get(target.node);
    if (!existing) nodes.set(target.node, { spec: target.params === undefined ? { id: target.node, type: target.type } : { id: target.node, type: target.type, params: target.params }, owner: 'chords' });
    else if (existing.spec.type !== target.type) throw new ComposeError(`node "${target.node}" is the chord target but branch "${existing.owner}" declares it as "${existing.spec.type}"`);
    for (const out of target.outputs) if (nodes.has(out.to.node)) addEdge({ from: { node: target.node, port: out.port }, to: out.to }, 'chords');
    const declaredChords = new Map<string, string>();
    for (const c of [...chordDecls].sort((x, y) => y.priority - x.priority || x.order - y.order)) {
      const prior = declaredChords.get(portKey(c.from));
      if (prior) throw new ComposeError(`chord ${portKey(c.from)} is declared by branches "${prior}" and "${c.owner}"; a chord has one owner`);
      declaredChords.set(portKey(c.from), c.owner);
      if (!nodes.has(c.from.node)) throw new ComposeError(`branch "${c.owner}" declares chord ${portKey(c.from)} but node "${c.from.node}" is not in it`);
      const port = target.pool.find((p) => !takenInputs.has(portKey({ node: target.node, port: p })));
      if (!port) throw new ComposeError(`chord pool is full (${target.pool.length} inputs) at branch "${c.owner}"; widen the pool on the chord selector`);
      addEdge({ from: c.from, to: { node: target.node, port } }, c.owner);
    }
  }

  // Rule 3c: category readers, allocated by priority into the overlay's pool for their kind, then
  // each classifier's captions into the input beside the slot its reader got.
  const categoryDecls = branches.flatMap((b, bi) => b.categories.map((c, ci) => ({ ...c, owner: b.id, order: bi * 1000 + ci })));
  const captionDecls = branches.flatMap((b) => b.categoryCaptions.map((c) => ({ ...c, owner: b.id })));
  if (categoryDecls.length || captionDecls.length) {
    const target = opts.categories;
    const first = categoryDecls[0]?.owner ?? captionDecls[0].owner;
    if (!target) throw new ComposeError(`branch "${first}" declares a category reader but no category target was given`);
    // The declarations are checked with or without the overlay; without it there are no cues to
    // draw, so nothing is wired.
    const wired = nodes.has(target.node);
    const slotOf = new Map<string, { slot: string; kind: CategoryKind; owner: string }>();
    const allocated = new Set<string>();
    for (const c of [...categoryDecls].sort((x, y) => y.priority - x.priority || x.order - y.order)) {
      const prior = slotOf.get(portKey(c.from));
      if (prior) throw new ComposeError(`category reader ${portKey(c.from)} is declared by branches "${prior.owner}" and "${c.owner}"; a reader has one owner`);
      if (!nodes.has(c.from.node)) throw new ComposeError(`branch "${c.owner}" declares category reader ${portKey(c.from)} but node "${c.from.node}" is not in it`);
      const pool = target.pools[c.kind];
      const slot = pool.find((p) => !allocated.has(p) && !takenInputs.has(portKey({ node: target.node, port: p })));
      if (!slot) throw new ComposeError(`category pool "${c.kind}" is full (${pool.length} inputs) at branch "${c.owner}"; widen the pool on the overlay`);
      slotOf.set(portKey(c.from), { slot, kind: c.kind, owner: c.owner });
      allocated.add(slot);
      if (wired) addEdge({ from: c.from, to: { node: target.node, port: slot } }, c.owner);
    }
    for (const c of captionDecls) {
      const reader = slotOf.get(portKey(c.for));
      if (!reader) throw new ComposeError(`branch "${c.owner}" declares captions for ${portKey(c.for)}, which no composed branch declares as a category reader`);
      if (reader.kind !== 'classifier') throw new ComposeError(`branch "${c.owner}" declares captions for ${portKey(c.for)}, a ${reader.kind}; only a classifier's classes carry captions`);
      if (!nodes.has(c.from.node)) throw new ComposeError(`branch "${c.owner}" declares captions ${portKey(c.from)} but node "${c.from.node}" is not in it`);
      if (wired) addEdge({ from: c.from, to: { node: target.node, port: target.captions(reader.slot) } }, c.owner);
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
