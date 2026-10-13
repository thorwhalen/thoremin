/**
 * NodeRegistry — a name → {@link NodeDef} map. The engine resolves a graph's
 * node `type` strings against a registry to instantiate them. Keeping this
 * explicit (rather than a global) makes tests hermetic: a test can build a
 * registry with exactly the nodes it needs.
 *
 * Node types may also be DECLARED LAZILY ({@link NodeRegistry.declareLazy}): the
 * registry knows the type names and a loader, and the definitions arrive on
 * {@link NodeRegistry.ensure}. That is how a lazy extension's node code stays out of
 * the main chunk until a graph names one of its nodes
 * (`docs/design/lazy-extensions.md`). The engine itself never awaits: a host
 * ensures the types a spec names before it plans (`pending` says which).
 */
import type { NodeDef, Role } from './types';

/** Loads the definitions of a group of lazily declared node types. */
export type LazyNodesLoader = () => Promise<readonly NodeDef<any>[]>;

interface LazyGroup {
  types: readonly string[];
  load: LazyNodesLoader;
  /** The load in flight, shared by every caller; cleared on failure so a later call retries. */
  inFlight: Promise<void> | null;
}

export class NodeRegistry {
  private defs = new Map<string, NodeDef<any>>();
  /** Declared, not yet loaded: type → its group. A type leaves when its group loads. */
  private lazy = new Map<string, LazyGroup>();

  /** Register one or more node definitions. Throws on duplicate type names. */
  register(...defs: NodeDef<any>[]): this {
    for (const def of defs) {
      if (this.defs.has(def.type) || this.lazy.has(def.type)) {
        throw new Error(`NodeRegistry: duplicate node type "${def.type}"`);
      }
      this.defs.set(def.type, def);
    }
    return this;
  }

  /**
   * Declare node types whose definitions `load` provides later. `has` is true for them at
   * once (a composer may name them); `get` throws until {@link ensure} has loaded them. The
   * loader must resolve to exactly these types.
   */
  declareLazy(types: readonly string[], load: LazyNodesLoader): this {
    if (types.length === 0) throw new Error('NodeRegistry.declareLazy: no types declared');
    const group: LazyGroup = { types: [...types], load, inFlight: null };
    for (const type of types) {
      if (this.defs.has(type) || this.lazy.has(type)) {
        throw new Error(`NodeRegistry: duplicate node type "${type}"`);
      }
      this.lazy.set(type, group);
    }
    return this;
  }

  /** The types among `types` that are declared lazily and not loaded yet (no duplicates). */
  pending(types: Iterable<string>): string[] {
    return [...new Set(types)].filter((t) => this.lazy.has(t));
  }

  /**
   * Load every lazily declared type among `types` (one load per group, shared by concurrent
   * callers). Resolves when all are registered; rejects with the loader's error, and a
   * failed group stays declared so the next `ensure` retries it.
   */
  async ensure(types: Iterable<string>): Promise<void> {
    const groups = new Set(this.pending(types).map((t) => this.lazy.get(t)!));
    await Promise.all([...groups].map((g) => this.loadGroup(g)));
  }

  private loadGroup(group: LazyGroup): Promise<void> {
    group.inFlight ??= group
      .load()
      .then((defs) => {
        const got = defs.map((d) => d.type).sort();
        const want = [...group.types].sort();
        if (got.length !== want.length || got.some((t, i) => t !== want[i])) {
          throw new Error(`NodeRegistry: a lazy loader declared [${want.join(', ')}] but provided [${got.join(', ')}]`);
        }
        // A concurrent ensure may have finished this group already.
        if (!this.lazy.has(group.types[0])) return;
        for (const t of group.types) this.lazy.delete(t);
        this.register(...defs);
      })
      .catch((err: unknown) => {
        group.inFlight = null;
        throw err;
      });
    return group.inFlight;
  }

  get(type: string): NodeDef<any> {
    const def = this.defs.get(type);
    if (!def && this.lazy.has(type)) {
      throw new Error(`NodeRegistry: node type "${type}" is declared lazily and not loaded yet; await registry.ensure(["${type}"]) first`);
    }
    if (!def) {
      throw new Error(
        `NodeRegistry: unknown node type "${type}". Registered: ${[...this.defs.keys()].join(', ') || '(none)'}`,
      );
    }
    return def;
  }

  /** True for a registered type and for a lazily declared one (loaded or not). */
  has(type: string): boolean {
    return this.defs.has(type) || this.lazy.has(type);
  }

  /** The LOADED definitions (a lazily declared type appears once {@link ensure} loaded it). */
  list(): NodeDef<any>[] {
    return [...this.defs.values()];
  }

  /**
   * Filtered view over {@link list}: every registered def whose `roles` include
   * `role`. A node may carry several roles, so it can appear under more than one.
   * Advisory only — this powers docs and the future swap UI; it never affects
   * engine execution. No second storage structure: it scans the existing map.
   */
  listByRole(role: Role): NodeDef<any>[] {
    return [...this.defs.values()].filter((def) => def.roles?.includes(role));
  }
}

/** Convenience: build a registry pre-loaded with the given defs. */
export function createRegistry(defs: NodeDef<any>[] = []): NodeRegistry {
  return new NodeRegistry().register(...defs);
}
