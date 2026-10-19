/**
 * How a take's holds group, as pure functions of what the session store knows (kept out of it so
 * the store does not grow with each kind of group): the holds recorded under a typed name
 * (#385 E7) and the holds of a lean (#349).
 */
import { holdId } from './thumbnails';
import { moveHolds, placeLabelled, type LabelledHolds } from '@thoremin/sdk/enroll/sorting';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';

/** The holds with a name, by name (case-insensitively), as sample ids; deleted ones left out. */
export function labelledHoldsOf(names: ReadonlyMap<number, string>, dropped: ReadonlySet<number>, tid: string): LabelledHolds[] {
  const by = new Map<string, { label: string; ids: string[] }>();
  for (const [i, raw] of names) {
    const label = raw.trim();
    if (!label || dropped.has(i)) continue;
    const key = label.toLowerCase();
    const g = by.get(key) ?? { label, ids: [] };
    g.ids.push(holdId(tid, i));
    by.set(key, g);
  }
  return [...by.values()];
}

/** Each lean hold with the hold it leaned on, as sample ids; a pair with a deleted end is left out. */
export function leanPairs(leans: ReadonlyMap<number, number>, dropped: ReadonlySet<number>, tid: string): { id: string; with: string }[] {
  return [...leans].filter(([i, on]) => !dropped.has(i) && !dropped.has(on)).map(([i, on]) => ({ id: holdId(tid, i), with: holdId(tid, on) }));
}

/** A categorizer with the names the take's holds were given, and what failed. */
export interface LabelledResult {
  categorizer: PersonalCategorizer;
  /** The categories that now carry a take-given name. */
  named: string[];
  error: string | null;
}

/**
 * `c` with the labelled holds placed and pinned (unchanged when there are none). A failure is
 * said, and the holds are carved like any other. A name that is new makes a category: never past
 * `maxCategories`, the most an instrument has chords for.
 */
export function withLabelsPlaced(c: PersonalCategorizer, groups: readonly LabelledHolds[], { neutralLabel, maxCategories }: { neutralLabel: string; maxCategories: number }): LabelledResult {
  if (groups.length === 0) return { categorizer: c, named: [], error: null };
  const r = placeLabelled(c, groups, { neutralLabel });
  if (!r.ok) return { categorizer: c, named: [], error: r.error };
  const grown = r.categorizer.categories.length > c.categories.length;
  if (grown && r.categorizer.categories.length > maxCategories) {
    return { categorizer: c, named: [], error: `a new name would make more than ${maxCategories} categories, the most an instrument has chords for` };
  }
  const named = r.categorizer.categories.filter((cat) => groups.some((g) => g.label.toLowerCase() === cat.label.trim().toLowerCase())).map((cat) => cat.id);
  return { categorizer: r.categorizer, named, error: null };
}

/**
 * `labelled` with every hold of the take that has no name of its own (and was not deleted in the
 * strip) moved to category `to` and pinned there (#435). A failure is said and nothing moves.
 */
export function holdAllInCategory(labelled: LabelledResult, { names, dropped, count, takeId, to }: { names: ReadonlyMap<number, string>; dropped: ReadonlySet<number>; count: number; takeId: string; to: string }): LabelledResult {
  const present = new Set(labelled.categorizer.samples.map((x) => x.id));
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const hid = holdId(takeId, i);
    if (!dropped.has(i) && !names.get(i)?.trim() && present.has(hid)) ids.push(hid);
  }
  if (ids.length === 0 || !labelled.categorizer.categories.some((c) => c.id === to)) return labelled;
  const r = moveHolds(labelled.categorizer, ids, to);
  return r.ok ? { ...labelled, categorizer: r.categorizer } : { ...labelled, error: labelled.error ?? r.error };
}
