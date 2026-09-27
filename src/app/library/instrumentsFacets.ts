/**
 * The Instruments view's facets (option B of Discussion #272): class, starred, tags and what
 * an instrument uses, as chips with live counts.
 *
 * The counts come from `@zodal/groups-core`'s `facetPanel`, not from a hand-rolled tally,
 * because faceted counts have two rules everyone gets wrong once:
 *
 *  - **within a family, selections are OR; across families, AND** ("Field" or "Air", and
 *    starred, and tagged "calm");
 *  - **a family's counts ignore that family's own selection** (the N+1 rule): pick "Air" and
 *    the "Field" chip still says how many field instruments there are, instead of 0, which
 *    would make the chips a dead end.
 *
 * So each family's counts are taken over the instruments that pass the search and every
 * OTHER family's selection, and the list shows the ones that pass them all.
 *
 * React-free: the view hands in plain items and a selection, and reads chips and the
 * allowed set back.
 */
import { CONTAINS, defineGroups, edgeId, type Edge, type FacetValue, type Node, type NodeId } from '@zodal/groups-core';

/** The facet families, in chip order. */
export const FACET_FAMILIES = [
  { id: 'class', label: 'Class' },
  { id: 'star', label: 'Starred' },
  { id: 'tag', label: 'Tags' },
  { id: 'uses', label: 'Uses' },
] as const;
export type FacetFamilyId = (typeof FACET_FAMILIES)[number]['id'];

/** What one instrument contributes to the facets. `values` are per family: the group ids
 *  it belongs to there, each with the label a chip shows. */
export interface FacetItem {
  id: string;
  values: Partial<Record<FacetFamilyId, readonly { id: string; label: string; hint?: string }[]>>;
}

/** Selected group ids per family (empty or absent = no filter from that family). */
export type FacetSelection = Partial<Record<FacetFamilyId, ReadonlySet<string>>>;

export interface FacetChip extends FacetValue {
  /** The facet family it belongs to. */
  family: FacetFamilyId;
  /** A longer explanation, for a tooltip (e.g. a branch's description). */
  hint?: string;
}

export interface FacetView {
  /** One row of chips per family that has any, in {@link FACET_FAMILIES} order. */
  families: { id: FacetFamilyId; label: string; chips: FacetChip[] }[];
  /** The item ids that pass every family's selection (and were in the pool). */
  allowed: Set<string>;
}

const familyRoot = (f: FacetFamilyId) => `family:${f}`;
const groupOf = (f: FacetFamilyId, value: string) => `${f}:${value}`;
const itemNode = (id: string) => `item:${id}`;

export interface FacetViewOptions {
  /** A fixed chip order per family, by value id (the rest follow, by label). Chips never
   *  reorder as counts change, so one never moves out from under the pointer. */
  order?: Partial<Record<FacetFamilyId, readonly string[]>>;
}

/**
 * The chips and the allowed set for `pool` (the item ids the text search kept) under
 * `selection`. Selected chips are always shown, even at zero and even when no instrument
 * has that value any more (a starred instrument unstarred while "Starred" is picked), so a
 * selection can always be seen and undone. Empty unselected ones are not shown (a chip that
 * leads to nothing is a dead end).
 */
export function facetView(
  items: readonly FacetItem[],
  pool: Iterable<string>,
  selection: FacetSelection,
  { order = {} }: FacetViewOptions = {},
): FacetView {
  // The group space, built in one step (one root per family, one group per value, an edge
  // per membership): adding edges one by one clones the space each time.
  const nodes = new Map<string, Node>();
  const hints = new Map<string, string>();
  const edges = new Map<string, Edge>();
  const edge = (parent: string, child: string) => {
    const id = `${parent}>${child}`;
    if (!edges.has(id)) edges.set(id, { id: edgeId(id), parent: parent as NodeId, child: child as NodeId, kind: CONTAINS });
  };
  const group = (f: FacetFamilyId, value: string, label: string) => {
    const g = groupOf(f, value);
    if (!nodes.has(g)) nodes.set(g, { id: g as NodeId, label });
    edge(familyRoot(f), g);
    return g;
  };
  for (const f of FACET_FAMILIES) nodes.set(familyRoot(f.id), { id: familyRoot(f.id) as NodeId, label: f.label });
  for (const it of items) {
    nodes.set(itemNode(it.id), { id: itemNode(it.id) as NodeId, label: it.id });
    for (const f of FACET_FAMILIES) {
      for (const v of it.values[f.id] ?? []) {
        const g = group(f.id, v.id, v.label);
        if (v.hint) hints.set(g, v.hint);
        edge(g, itemNode(it.id));
      }
    }
  }
  // A selected value no instrument has any more still gets its chip.
  for (const f of FACET_FAMILIES) for (const v of selection[f.id] ?? []) group(f.id, v, v);
  const groups = defineGroups({ profile: 'labels', nodes: [...nodes.values()], edges: [...edges.values()] });

  // The members of a family's selection (OR within it), as item ids; null = no filter.
  const passing = (f: FacetFamilyId): Set<string> | null => {
    const sel = selection[f];
    if (!sel || sel.size === 0) return null;
    const out = new Set<string>();
    for (const value of sel) {
      for (const m of groups.members(groupOf(f, value), { expand: 'closure', itemsOnly: true })) {
        out.add(String(m).slice('item:'.length));
      }
    }
    return out;
  };
  const filters = new Map(FACET_FAMILIES.map((f) => [f.id, passing(f.id)] as const));
  const poolIds = [...pool];
  const passesAllBut = (id: string, skip: FacetFamilyId | null) =>
    FACET_FAMILIES.every((f) => f.id === skip || filters.get(f.id) === null || filters.get(f.id)!.has(id));

  const families = FACET_FAMILIES.map((f) => {
    const sel = selection[f.id] ?? new Set<string>();
    // The N+1 rule: this family's counts ignore its own selection.
    const countPool = poolIds.filter((id) => passesAllBut(id, f.id)).map((id) => itemNode(id) as NodeId);
    const values = groups.facets({
      under: familyRoot(f.id) as NodeId,
      items: countPool,
      selected: new Set([...sel].map((v) => groupOf(f.id, v) as NodeId)),
      hideEmpty: false,
    });
    const fixed = order[f.id] ?? [];
    const rank = (v: FacetValue) => {
      const i = fixed.indexOf(String(v.group).slice(f.id.length + 1));
      return i === -1 ? fixed.length : i;
    };
    // A selected value with no members is not a group to groups-core (so `facets` skips it);
    // it still gets its chip, at zero, or the selection could not be seen or undone.
    const offered = new Set(values.map((v) => String(v.group)));
    const stranded: FacetValue[] = [...sel]
      .map((v) => groupOf(f.id, v))
      .filter((g) => !offered.has(g))
      .map((g) => ({ group: g as NodeId, label: nodes.get(g)?.label ?? g, count: 0, selected: true, hasChildren: false, depth: 1 }));
    const chips: FacetChip[] = [...values, ...stranded]
      .filter((v) => v.count > 0 || v.selected)
      .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
      .map((v) => ({ ...v, family: f.id, hint: hints.get(String(v.group)) }));
    return { id: f.id, label: f.label, chips };
  }).filter((f) => f.chips.length > 0);

  return { families, allowed: new Set(poolIds.filter((id) => passesAllBut(id, null))) };
}

/** A chip's value id within its family (the group id without the family prefix). */
export const chipValue = (chip: FacetChip): string => String(chip.group).slice(chip.family.length + 1);
