/**
 * A hand-shape categorizer as the air guitar's chords (#451, choice C4 of #387): a COPY into the
 * air guitar's own vocabulary through sdk-ui's importer seam, the faces extension never importing
 * the air extension.
 *
 * - **Pure**: a categorizer's categories as vocabulary entries, each its holds' still-points and
 *   their supporting frames (rows aligned with the features, back to keyed vectors).
 * - **The importer**: chord names taken, other names and thin entries skipped, an entry of the
 *   same name replaced.
 * - **End to end**: the scripted hand recorded and carved in Your hand shapes, its categories
 *   renamed G, Am and C, saved, then imported. The air guitar's classifier, trained from those
 *   samples (its own training), reads each scripted shape as its chord: a carved hand sample IS a
 *   vocabulary vector (#385 E8).
 * - **The seam**: the air extension's UI mount provides the importer; "Use as air guitar chords"
 *   asks before replacing, and says what it did.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { classify } from '@thoremin/sdk/enroll/classify';
import type { TrainedModel } from '@thoremin/sdk/enroll';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { vocabularyImporters } from '@thoremin/sdk-ui/enroll/vocabularyImport';
import { createFaceSessionStore } from '@thoremin/ext-faces/app/sessionStore';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { HAND_SCRIPT, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_HAND_TIMELINE, syntheticHandVector, syntheticHandShapeAt } from '@thoremin/ext-faces/lib/synthetic_hand';
import { categoryEntries } from '@thoremin/ext-faces/lib/vocabularyEntries';
import { createVocabularyState, useVocabularyStore, type VocabularyRecord } from '@thoremin/ext-air/app/vocabularyStore';
import { guitarVocabularyImporter, AIR_GUITAR_IMPORTER_ID } from '@thoremin/ext-air/app/guitarImport';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { AIR, FACES } from '../helpers/extensions';

describe('categoryEntries (pure)', () => {
  it('each named category: its holds\' vectors, then their supporting frames as keyed vectors', () => {
    const entries = categoryEntries({
      features: ['a', 'b'],
      samples: [
        { id: 's1', vector: { a: 1, b: 2 }, t: 0, cue: 'c', support: [[1.1, null], [0.9, 2.1]] },
        { id: 's2', vector: { a: 5, b: 6 }, t: 0, cue: 'c' },
      ],
      categories: [
        { id: 'cat-1', label: ' G ', members: ['s1'] },
        { id: 'cat-2', label: '', members: ['s2'] },
      ],
    } as never);
    expect(entries).toEqual([{ label: 'G', samples: [{ a: 1, b: 2 }, { a: 1.1 }, { a: 0.9, b: 2.1 }] }]);
  });
});

let published: (TrainedModel | null)[] = [];
const freshState = () => {
  useVocabularyStore(createInMemoryProvider<VocabularyRecord>([], { idField: 'id', searchFields: ['name'] }));
  published = [];
  return createVocabularyState({ name: 'guitar', features: chordShapeFeatureIds(), publish: (m) => published.push(m) });
};
afterEach(() => useVocabularyStore(null));

describe.runIf(AIR)('the air guitar importer', () => {
  it('takes chord names, skips other names and thin entries, and replaces an entry of the same name', async () => {
    const state = freshState();
    const importer = guitarVocabularyImporter(state);
    const f = chordShapeFeatureIds();
    const shape = (x: number): FeatureVector => Object.fromEntries(f.map((k, j) => [k, x + j * 0.01]));
    const many = (x: number) => Array.from({ length: 8 }, (_, i) => shape(x + i * 0.001));
    expect(importer.accepts('G')).toBe(true);
    expect(importer.accepts('Am7')).toBe(true);
    expect(importer.accepts('fist')).toBe(false);
    const r = await importer.import([
      { label: 'G', samples: many(0) },
      { label: 'fist', samples: many(1) },
      { label: 'Am', samples: many(2).slice(0, 2) },
      { label: 'C', samples: [...many(3), { unrelated: 1 }] },
    ]);
    expect(r).toEqual({ imported: ['G', 'C'], skipped: ['fist', 'Am'] });
    expect(state.getState().vocab.entries.map((e) => e.label)).toEqual(['G', 'C']);
    // Only the guitar's features are kept (an empty vector is dropped).
    for (const e of state.getState().vocab.entries) for (const s of e.samples) expect(Object.keys(s).every((k) => f.includes(k))).toBe(true);
    expect(importer.has('G')).toBe(true);
    await importer.import([{ label: 'G', samples: many(5) }]);
    expect(state.getState().vocab.entries).toHaveLength(2);
    expect(state.getState().vocab.entries[0].samples[0][f[0]]).toBeCloseTo(5);
    expect(published.at(-1)).not.toBeNull();
  });
});

// ---- end to end ----------------------------------------------------------------------------

let clock = 0;
const STREAM = {} as MediaStream;
const CYCLE_MS = SYNTHETIC_HAND_TIMELINE.holdMs + SYNTHETIC_HAND_TIMELINE.glideMs;
const CHORD_OF: Record<string, string> = { fist: 'G', pinch: 'Am', open: 'C' };

describe.runIf(AIR && FACES)('a carved hand categorizer becomes the air guitar\'s chords', () => {
  let store: ReturnType<typeof createFaceSessionStore>;
  let saved: CategorizerRecord;

  beforeAll(async () => {
    vi.useFakeTimers();
    clock = 1000;
    const models = createCategorizerStore(handModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });
    const source = (): FaceSource => {
      const start = clock;
      let frame = 0;
      return { kind: 'synthetic', read: () => ({ vector: HAND_SCRIPT.vectorAt(clock - start, frame++), t: clock }), video: () => STREAM, dispose: () => {} };
    };
    store = createFaceSessionStore({ source, thumbs: memoryThumbStore(), frames: () => null, models, modality: handModality, now: () => clock, pollMs: 33, claim: () => {}, newTakeId: () => 'take-g', isoNow: () => '2026-10-14T00:00:00.000Z' });
    store.getState().start();
    for (let t = 0; t < SYNTHETIC_HAND_TIMELINE.restMs + 16 * CYCLE_MS; t += 33) {
      clock += 33;
      await vi.advanceTimersByTimeAsync(33);
    }
    await store.getState().stop();
    // The player names the shapes as chords.
    for (const c of store.getState().working!.categories) if (CHORD_OF[c.label]) store.getState().rename(c.id, CHORD_OF[c.label]);
    expect(await store.getState().save('Chords')).toBe(true);
    saved = (await models.load('hand:chords'))!;
    vi.useRealTimers();
  }, 60_000);
  beforeEach(() => vi.useRealTimers());

  it('imports the chord-named categories with their supporting frames, and the guitar reads each shape as its chord', async () => {
    const state = freshState();
    const importer = guitarVocabularyImporter(state);
    const asked: string[] = [];
    expect(await store.getState().importSaved(saved.id, importer, (q) => (asked.push(q), true))).toBe(true);
    expect(asked).toEqual([]); // nothing replaced
    const labels = state.getState().vocab.entries.map((e) => e.label).sort();
    expect(labels).toEqual(expect.arrayContaining(['Am', 'G']));
    expect(store.getState().notice).toMatch(/^Now in the air guitar chords: /);
    // More samples than holds: the supporting frames came along.
    const holds = saved.model.categorizer.categories.find((c) => c.label === 'G')!.members.length;
    expect(state.getState().vocab.entries.find((e) => e.label === 'G')!.samples.length).toBeGreaterThan(holds);
    // The guitar's own classifier, trained from the imported samples, reads the scripted shapes.
    const model = published.at(-1)!;
    expect(model).not.toBeNull();
    let checked = 0;
    for (let f = 0, ms = SYNTHETIC_HAND_TIMELINE.restMs; ms < SYNTHETIC_HAND_TIMELINE.restMs + 10 * CYCLE_MS; f++, ms += 99) {
      const into = (ms - SYNTHETIC_HAND_TIMELINE.restMs) % CYCLE_MS;
      const shape = syntheticHandShapeAt(ms).name;
      const chord = CHORD_OF[shape];
      if (!chord || !labels.includes(chord) || into < SYNTHETIC_HAND_TIMELINE.glideMs + 200) continue;
      const v = handModality.project!(syntheticHandVector(ms, 9000 + f), {});
      const c = classify(model, v);
      expect(model.categories.find((x) => x.id === c.categoryId)?.label, `${shape} at ${ms}`).toBe(chord);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('asks before replacing an entry the guitar already has; a no keeps it', async () => {
    const state = freshState();
    const importer = guitarVocabularyImporter(state);
    await importer.import([{ label: 'G', samples: Array.from({ length: 6 }, () => Object.fromEntries(chordShapeFeatureIds().map((k) => [k, 0.5]))) }]);
    const before = state.getState().vocab;
    const asked: string[] = [];
    expect(await store.getState().importSaved(saved.id, importer, (q) => (asked.push(q), false))).toBe(false);
    expect(asked[0]).toMatch(/already have G/);
    expect(state.getState().vocab).toBe(before);
  });

  it('a categorizer with no chord names says so and imports nothing', async () => {
    const state = freshState();
    const importer = guitarVocabularyImporter(state);
    const models = createCategorizerStore(handModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });
    const plain = await models.save('Plain', { categorizer: { ...saved.model.categorizer, categories: saved.model.categorizer.categories.map((c, i) => ({ ...c, label: `shape ${i + 1}` })) } });
    const s2 = createFaceSessionStore({ source: () => ({ kind: 'synthetic', read: () => null, video: () => null, dispose: () => {} }) as FaceSource, thumbs: memoryThumbStore(), frames: () => null, models, modality: handModality, now: () => 0, pollMs: 33, claim: () => {}, newTakeId: () => 't', isoNow: () => '' });
    expect(await s2.getState().importSaved(plain.id, importer, () => true)).toBe(false);
    expect(s2.getState().notice).toMatch(/None of the categories .* is named as one of the air guitar chords/);
    expect(state.getState().vocab.entries).toHaveLength(0);
  });
});

describe.runIf(AIR)('the seam: the air extension provides the importer when its UI mounts', () => {
  it('AIR_UI\'s mount effects register the air guitar importer for hand categorizers, and withdraw it', async () => {
    await import('@/app/store'); // the hot store's host, which the other mount effects read
    const { default: AIR_UI } = await import('@thoremin/ext-air/ui');
    // Each effect on its own: one that needs a browser (storage) must not hide this one.
    const cleanups = (AIR_UI.onMount ?? []).map((m) => {
      try {
        return m();
      } catch {
        return undefined;
      }
    });
    expect(vocabularyImporters('hand').map((i) => i.id)).toContain(AIR_GUITAR_IMPORTER_ID);
    expect(vocabularyImporters('body')).toEqual([]);
    for (const c of cleanups) if (typeof c === 'function') c();
    expect(vocabularyImporters('hand').map((i) => i.id)).not.toContain(AIR_GUITAR_IMPORTER_ID);
  });
});
