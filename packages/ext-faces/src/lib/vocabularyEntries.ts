/**
 * A categorizer as vocabulary entries (#451): each category's name and its samples, for another
 * extension's vocabulary to import (the air guitar's chords, through sdk-ui's importer seam). A
 * category's samples are its holds' still-points and their supporting frames (#385 E3: rows
 * aligned with the categorizer's features), so a carve of a few holds still gives a vocabulary
 * entry enough samples to measure its spread. Pure.
 */
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

export interface CategoryEntry {
  label: string;
  samples: FeatureVector[];
}

/** Each named category with its holds' vectors and supporting frames, in the categorizer's order. */
export function categoryEntries(c: Pick<PersonalCategorizer, 'categories' | 'samples' | 'features'>): CategoryEntry[] {
  const byId = new Map(c.samples.map((s) => [s.id, s]));
  return c.categories
    .filter((cat) => cat.label.trim() !== '')
    .map((cat) => ({
      label: cat.label.trim(),
      samples: cat.members.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        const frames = (s.support ?? []).map((row) => {
          const v: FeatureVector = {};
          row.forEach((x, j) => {
            if (x !== null && Number.isFinite(x)) v[c.features[j]] = x;
          });
          return v;
        });
        return [s.vector as FeatureVector, ...frames];
      }),
    }));
}
