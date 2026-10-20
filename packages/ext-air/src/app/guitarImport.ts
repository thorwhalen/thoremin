/**
 * The air guitar's chords take a carved hand-shape categorizer (#451, choice C4 of #387): the
 * importer the air extension provides through sdk-ui's seam when its UI mounts. A category named
 * as a chord (`parseChordName`: "G", "Am", "D7") becomes the vocabulary entry of that chord, under
 * its CANONICAL name (as the guitar's own enrolment keeps it: "g" and "Gmaj" are "G"), its holds
 * and their supporting frames as samples; categories with one canonical name are pooled, and an
 * entry of the same name is replaced (the carve tool asks first). A COPY into the guitar's own
 * vocabulary, whose samples stay the SSOT of its classifier: no store is shared, and the faces
 * extension never imports this one.
 */
import type { VocabularyImporter } from '@thoremin/sdk-ui/enroll/vocabularyImport';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { parseChordName } from '@thoremin/sdk/music/guitar';
import { MIN_SAMPLES_PER_ENTRY } from '../lib/vocabulary';
import { airControls } from './controls';
import { useGuitarVocabulary, type VocabularyState } from './vocabularyStore';

export const AIR_GUITAR_IMPORTER_ID = 'air-guitar';

/** The hand that frets (holds the chord shapes): the one that does not strum. */
function frettingHandNow(): 'left' | 'right' {
  try {
    const strum = (airControls.get().airGuitar as { strumHand?: string } | undefined)?.strumHand;
    return strum === 'left' ? 'right' : 'left';
  } catch {
    return 'left';
  }
}

export interface GuitarImporterDeps {
  state?: { getState(): VocabularyState };
  /** The hand that frets now (the air guitar's dial). */
  frettingHand?: () => 'left' | 'right';
}

/** The air guitar's importer over its vocabulary store (the app's by default). */
export function guitarVocabularyImporter({ state = useGuitarVocabulary, frettingHand = frettingHandNow }: GuitarImporterDeps = {}): VocabularyImporter {
  const canonical = (label: string): string | null => parseChordName(label.trim())?.name ?? null;
  return {
    id: AIR_GUITAR_IMPORTER_ID,
    modality: 'hand',
    label: 'air guitar chords',
    canonical,
    has: (label) => {
      const name = canonical(label);
      return name !== null && state.getState().vocab.entries.some((e) => e.label === name);
    },
    async import(entries, options = {}) {
      if (!state.getState().loaded) await state.getState().load();
      const features = state.getState().vocab.features;
      // Only the guitar's features (the hand modality's shape features are the same ids).
      const keep = (v: FeatureVector): FeatureVector => Object.fromEntries(features.filter((f) => Number.isFinite(v[f])).map((f) => [f, v[f]])) as FeatureVector;
      const pooled = new Map<string, FeatureVector[]>();
      const skipped: string[] = [];
      for (const e of entries) {
        const name = canonical(e.label);
        if (name === null) {
          skipped.push(e.label.trim());
          continue;
        }
        pooled.set(name, [...(pooled.get(name) ?? []), ...e.samples.map(keep).filter((v) => Object.keys(v).length > 0)]);
      }
      const imported: string[] = [];
      const warnings: string[] = [];
      for (const [name, samples] of pooled) {
        if (samples.length < MIN_SAMPLES_PER_ENTRY) {
          skipped.push(name);
          continue;
        }
        await state.getState().enrol(name, samples);
        imported.push(name);
      }
      const fret = frettingHand();
      if (imported.length > 0 && options.hand && options.hand !== fret)
        warnings.push(
          options.hand === 'either'
            ? `they were carved from either hand; the air guitar reads your ${fret} hand's shapes`
            : `they were carved from your ${options.hand} hand; the air guitar reads your ${fret} hand's shapes (swap the strumming hand in its settings, or carve them with your ${fret} hand)`,
        );
      const error = state.getState().error;
      if (imported.length > 0 && error) warnings.push(error);
      return { imported, skipped, warnings };
    },
  };
}
