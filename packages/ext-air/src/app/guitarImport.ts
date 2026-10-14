/**
 * The air guitar's chords take a carved hand-shape categorizer (#451, choice C4 of #387): the
 * importer the air extension provides through sdk-ui's seam when its UI mounts. A category named
 * as a chord (`parseChordName`: "G", "Am", "D7") becomes the vocabulary entry of that name, its
 * holds and their supporting frames as samples; an entry of the same name is replaced (the carve
 * tool asks first). A COPY into the guitar's own vocabulary, whose samples stay the SSOT of its
 * classifier: no store is shared, and the faces extension never imports this one.
 */
import type { VocabularyImporter } from '@thoremin/sdk-ui/enroll/vocabularyImport';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { parseChordName } from '../lib/guitar';
import { MIN_SAMPLES_PER_ENTRY } from '../lib/vocabulary';
import { useGuitarVocabulary, type VocabularyState } from './vocabularyStore';

export const AIR_GUITAR_IMPORTER_ID = 'air-guitar';

/** The air guitar's importer over its vocabulary store (the app's by default). */
export function guitarVocabularyImporter(state: { getState(): VocabularyState } = useGuitarVocabulary): VocabularyImporter {
  const accepts = (label: string): boolean => parseChordName(label.trim()) !== null;
  return {
    id: AIR_GUITAR_IMPORTER_ID,
    modality: 'hand',
    label: 'air guitar chords',
    accepts,
    has: (label) => state.getState().vocab.entries.some((e) => e.label === label.trim()),
    async import(entries) {
      if (!state.getState().loaded) await state.getState().load();
      const features = state.getState().vocab.features;
      const imported: string[] = [];
      const skipped: string[] = [];
      for (const e of entries) {
        const label = e.label.trim();
        // Only the guitar's features (the hand modality's shape features are the same ids).
        const samples = e.samples.map((v) => Object.fromEntries(features.filter((f) => Number.isFinite(v[f])).map((f) => [f, v[f]])) as FeatureVector).filter((v) => Object.keys(v).length > 0);
        if (!accepts(label) || samples.length < MIN_SAMPLES_PER_ENTRY) {
          skipped.push(label);
          continue;
        }
        await state.getState().enrol(label, samples);
        imported.push(label);
      }
      return { imported, skipped };
    },
  };
}
