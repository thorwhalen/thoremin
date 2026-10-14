/**
 * A hand-shape or pose categorizer, resolved to play chords (#450): what the `categorizer-chord`
 * node reads (a transient the host sets off the tick, `../app/categorizerChords.ts`). Pure: the
 * live model under the record's own tuning (its modality's projection, with the categorizer's
 * hand and mirror; "cannot see you" below the trained coverage), and the reading as the overlay's
 * `CategoryScores`, each category's bar captioned with the chord it plays.
 */
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { liveModel, type LiveModel, type LiveReading, type Tuning } from '@thoremin/sdk/enroll/live';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import type { ChordModality } from '../schema';

/** The carve modality of each chord modality. */
export const CHORD_MODALITY: Readonly<Record<ChordModality, CarveModality>> = { hand: handModality, body: bodyModality };

export interface CategorizerChordPlay {
  /** The saved record's id: the node plays this model only while the dial still names it. */
  id: string;
  name: string;
  modality: ChordModality;
  live: LiveModel;
}

/** A saved hand-shape or pose categorizer, resolved to play under its own tuning. */
export function categorizerChordPlay(record: { id: string; name: string; modality: ChordModality; categorizer: PersonalCategorizer; tuning?: Partial<Tuning> }): CategorizerChordPlay {
  return {
    id: record.id,
    name: record.name,
    modality: record.modality,
    live: liveModel(record.categorizer, record.tuning ?? {}, { modality: CHORD_MODALITY[record.modality] }),
  };
}

/** No reading (the part not in view, or too little of it): absent, every category at 0. */
export function absentChordScores(play: CategorizerChordPlay): CategoryScores {
  const cats = play.live.model.categories;
  return { present: false, label: null, labels: cats.map((c) => c.label), scores: cats.map(() => 0), title: play.name };
}

/** One reading as `CategoryScores`: the settled category named, each category's membership as
 *  its bar. Neutral names nothing. */
export function toChordScores(play: CategorizerChordPlay, reading: Pick<LiveReading, 'label' | 'memberships'>): CategoryScores {
  return {
    present: true,
    label: reading.label,
    labels: reading.memberships.map((m) => m.label),
    scores: reading.memberships.map((m) => m.value),
    title: play.name,
  };
}

/** The index of the settled category in the categorizer's order, or null (none of these). */
export function categoryIndex(play: CategorizerChordPlay, categoryId: string | null): number | null {
  if (categoryId === null) return null;
  const i = play.live.model.categories.findIndex((c) => c.id === categoryId);
  return i < 0 ? null : i;
}
