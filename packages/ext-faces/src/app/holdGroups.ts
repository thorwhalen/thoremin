/**
 * How a take's holds group, as pure functions of what the session store knows (kept out of it so
 * the store does not grow with each kind of group): the holds recorded under a typed name
 * (#385 E7) and the holds of a lean (#349).
 */
import { holdId } from './thumbnails';
import type { LabelledHolds } from '@thoremin/sdk/enroll/sorting';

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
