/**
 * What the Instruments view lists for one instrument, beyond its spec (option B of #272):
 * the words a search finds it by, the facets it belongs to, and the reasons it can match a
 * query, all derived from the library (class, tags, system tags, the tooltip's summary,
 * the branches it uses). Nothing here is stored; a stale reason is impossible.
 *
 * React-free and pure: the view passes in what the library knows about the instrument.
 */
import type { InstrumentSpec } from '@/instruments/spec';
import { BRANCHES } from '@/instruments/branches';
import { INSTRUMENT_CLASSES } from '@/instruments/classes';
import { AIR_INSTRUMENTS } from './category';
import type { InstrumentListItem } from './instrumentsCollection';
import type { FacetItem } from './instrumentsFacets';

/** What the library knows about one instrument, besides its spec. */
export interface ListingFacts {
  /** Its custom tags (label and emoji). */
  customTags: readonly { id: string; label: string; emoji: string }[];
  /** Its derived system tags. */
  systemTags: readonly { id: string; label: string; emoji: string }[];
  /** The tooltip's summary lines ("note source: wrist"). */
  summary: readonly { label: string; value: string }[];
}

/** One way a query can match an instrument that is not its name. */
export interface MatchReason {
  /** As the row shows it ("tag: calm"). */
  text: string;
  /** What a query is matched against: the value alone, without the label word, so "tag"
   *  or "class" does not match every instrument. */
  match: string;
}

export interface Listing {
  item: InstrumentListItem;
  facet: FacetItem;
  reasons: MatchReason[];
}

/** A branch's label: its id in words ("face-chord" → "Face chord"); the branch table has
 *  descriptions, not short labels. */
export const branchLabel = (id: string): string => {
  const words = id.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const branchHint = (id: string): string | undefined => BRANCHES.find((b) => b.id === id)?.description;
/**
 * Branches the "uses" facet leaves out, because another facet already says the same thing:
 * `field-voices` is the Field class, and each air branch is its air instrument's system tag.
 * A chip that selects exactly the same set as another is noise.
 */
export const USES_SAID_ELSEWHERE: ReadonlySet<string> = new Set([
  'field-voices',
  ...AIR_INSTRUMENTS.map((a) => `air-${a.id}`),
]);

const classLabel = (id: string): string => {
  const c = INSTRUMENT_CLASSES.find((x) => x.id === id);
  return c ? c.label.replace(/ instruments$/i, '') : id;
};

export function listingOf(spec: InstrumentSpec, facts: ListingFacts): Listing {
  const tags = [
    ...facts.customTags.map((t) => ({ id: `custom:${t.id}`, label: `${t.emoji} ${t.label}` })),
    ...facts.systemTags.map((t) => ({ id: t.id, label: `${t.emoji} ${t.label}` })),
  ];
  const uses = spec.features
    .filter((id) => !USES_SAID_ELSEWHERE.has(id))
    .map((id) => ({ id, label: branchLabel(id), hint: branchHint(id) }));
  // Most specific first: a short query that only hits the class says so last.
  const reasons: MatchReason[] = [
    ...facts.customTags.map((t) => ({ text: `tag: ${t.label}`, match: t.label })),
    ...facts.systemTags.map((t) => ({ text: t.label, match: t.label })),
    ...facts.summary.map((l) => ({ text: `${l.label.toLowerCase()}: ${l.value}`, match: l.value })),
    ...uses.map((u) => ({ text: `uses: ${u.label.toLowerCase()}`, match: u.label })),
    { text: `class: ${classLabel(spec.class)}`, match: classLabel(spec.class) },
  ];
  return {
    // One reason per line: a newline is never typed, so no query spans two reasons.
    item: { ...spec, searchText: reasons.map((r) => r.match).join('\n') },
    facet: {
      id: spec.id,
      values: {
        class: [{ id: spec.class, label: classLabel(spec.class) }],
        star: spec.starred ? [{ id: 'yes', label: '★ Starred' }] : [],
        tag: tags,
        uses,
      },
    },
    reasons,
  };
}

/**
 * Why `listing` matches `query`, when its name alone does not: the first reason containing
 * the query, as the row shows it in grey. Undefined when the name matches, or the query is
 * empty, or (by construction, never) nothing matches.
 */
export function whyMatched(name: string, reasons: readonly MatchReason[], query: string): string | undefined {
  const q = query.trim().toLowerCase();
  if (!q || name.toLowerCase().includes(q)) return undefined;
  return reasons.find((r) => r.match.toLowerCase().includes(q))?.text;
}
