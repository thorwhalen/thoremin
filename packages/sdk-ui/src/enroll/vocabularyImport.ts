/**
 * Importing a carved categorizer into another extension's vocabulary (#451, choice C4 of #387):
 * a saved hand-shape categorizer whose categories are named as chords ("G", "Am") can become the
 * air guitar's enrolled chords. The air guitar keeps its own vocabulary (its samples are the SSOT
 * of its classifier); this is a COPY into it, not a shared store, and the faces extension never
 * imports the air extension: the air extension provides an importer here when its UI mounts, and
 * a carve tool offers "Use as ..." for every importer whose vocabulary would take something.
 *
 * The feature spaces agree by construction (#385 E8: the hand modality's shape features ARE the
 * air guitar's), so a carved sample (and its supporting frames) is a vocabulary sample as is.
 */
import type { FeatureVector } from '@thoremin/sdk/enroll/types';

/** One entry to import: a category's name and its samples. */
export interface VocabularyImportEntry {
  label: string;
  samples: readonly FeatureVector[];
}

/** What an import did, by entry name. */
export interface VocabularyImportResult {
  /** Entries now in the vocabulary (new or replacing one of the same name). */
  imported: string[];
  /** Entries the vocabulary does not take (not a name it understands, or too few samples). */
  skipped: string[];
}

/** A vocabulary that takes imports. */
export interface VocabularyImporter {
  /** A stable id (`air-guitar`). */
  id: string;
  /** The carve modality whose categorizers it takes (`hand`). */
  modality: string;
  /** What the button says after "Use as" (`air guitar chords`). */
  label: string;
  /** Whether an entry of this name would be taken (`G`, `Am`: a chord name). */
  accepts(label: string): boolean;
  /** Whether the vocabulary already has an entry of this name (an import replaces it). */
  has(label: string): boolean;
  /** Import the entries it accepts; the rest are skipped. */
  import(entries: readonly VocabularyImportEntry[]): Promise<VocabularyImportResult>;
}

const importers = new Map<string, VocabularyImporter>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const l of [...listeners]) l();
};

/** Provide an importer (the air extension, on mount); returns the withdrawal. */
export function provideVocabularyImporter(importer: VocabularyImporter): () => void {
  importers.set(importer.id, importer);
  changed();
  return () => {
    if (importers.get(importer.id) === importer) {
      importers.delete(importer.id);
      changed();
    }
  };
}

/** The importers that take categorizers of `modality`, in the order they were provided. */
export function vocabularyImporters(modality: string): VocabularyImporter[] {
  return [...importers.values()].filter((i) => i.modality === modality);
}

/** Be told when importers come and go; returns the unsubscribe. */
export function onVocabularyImporters(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
