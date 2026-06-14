/**
 * NodeRegistry — a name → {@link NodeDef} map. The engine resolves a graph's
 * node `type` strings against a registry to instantiate them. Keeping this
 * explicit (rather than a global) makes tests hermetic: a test can build a
 * registry with exactly the nodes it needs.
 */
import type { NodeDef } from './types';

export class NodeRegistry {
  private defs = new Map<string, NodeDef<any>>();

  /** Register one or more node definitions. Throws on duplicate type names. */
  register(...defs: NodeDef<any>[]): this {
    for (const def of defs) {
      if (this.defs.has(def.type)) {
        throw new Error(`NodeRegistry: duplicate node type "${def.type}"`);
      }
      this.defs.set(def.type, def);
    }
    return this;
  }

  get(type: string): NodeDef<any> {
    const def = this.defs.get(type);
    if (!def) {
      throw new Error(
        `NodeRegistry: unknown node type "${type}". Registered: ${[...this.defs.keys()].join(', ') || '(none)'}`,
      );
    }
    return def;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  list(): NodeDef<any>[] {
    return [...this.defs.values()];
  }
}

/** Convenience: build a registry pre-loaded with the given defs. */
export function createRegistry(defs: NodeDef<any>[] = []): NodeRegistry {
  return new NodeRegistry().register(...defs);
}
