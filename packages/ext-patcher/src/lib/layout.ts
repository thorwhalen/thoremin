/**
 * Where each node of a live graph goes on the patcher's canvas (#14): a layered layout, pure and
 * dependency-free. A node's column is its longest path from a source (a node with no incoming
 * edge), so every edge points right; within a column, nodes keep the spec's order, which is the
 * composer's order (trunk first, then branches), so a re-composed graph moves as little as it can.
 *
 * A delayed edge (feedback, the previous tick's value) is left out of the columns, as the engine
 * leaves it out of its order, so it is the one kind of edge that may point left. Any other cycle
 * cannot occur (the engine refuses one before it commits a spec), but the layout must not
 * hang on a spec it is handed by a test or a future editor: a node reached again while its column
 * is being computed is placed in column 0.
 */
import type { GraphSpec } from '@thoremin/dag';

/** The canvas spacing, in React Flow units. */
export interface LayoutSpacing {
  /** Horizontal distance between two columns. */
  column: number;
  /** Vertical distance between two nodes of one column. */
  row: number;
}

export const DEFAULT_SPACING: LayoutSpacing = { column: 240, row: 90 };

export interface PlacedNode {
  id: string;
  type: string;
  column: number;
  row: number;
  x: number;
  y: number;
}

/** Each node's column: the longest path to it from a source. */
export function columnsOf(spec: Pick<GraphSpec, 'nodes' | 'edges'>): Map<string, number> {
  const ids = new Set(spec.nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const e of spec.edges) {
    if (e.delayed || !ids.has(e.from.node) || !ids.has(e.to.node)) continue;
    incoming.set(e.to.node, [...(incoming.get(e.to.node) ?? []), e.from.node]);
  }
  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(incoming.get(id) ?? []).map(depth)) + 1;
    visiting.delete(id);
    column.set(id, d);
    return d;
  };
  for (const n of spec.nodes) depth(n.id);
  return column;
}

/** Every node of `spec`, placed. */
export function layoutGraph(spec: Pick<GraphSpec, 'nodes' | 'edges'>, { spacing = DEFAULT_SPACING }: { spacing?: LayoutSpacing } = {}): PlacedNode[] {
  const columns = columnsOf(spec);
  const filled = new Map<number, number>();
  return spec.nodes.map((n) => {
    const column = columns.get(n.id) ?? 0;
    const row = filled.get(column) ?? 0;
    filled.set(column, row + 1);
    return { id: n.id, type: n.type, column, row, x: column * spacing.column, y: row * spacing.row };
  });
}
