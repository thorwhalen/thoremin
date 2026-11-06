/**
 * The air guitar's shipped chord shapes (`recorded_chords.ts`): a summary of a recorded take
 * (per-chord feature means and spreads, no frames) turned back into samples that reproduce it
 * exactly, so the guitar plays out of the box; a voicing number (`G (2)`) plays its chord; and
 * the vocabulary store starts from them without saving, and puts them back on request while
 * keeping the player's own chords.
 *
 * The take itself is checked in `test/recordings/air_guitar_chords.test.ts` (private data).
 */
import { describe, expect, it } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { classify } from '@thoremin/sdk/enroll';
import { parseChordName } from '@thoremin/sdk/music/guitar';
import { canonicalChordLabel, chordOfLabel, RECORDED_CHORDS, recordedChordVocabulary, SEED_SAMPLES, vocabularyFromSummary } from '@thoremin/ext-air/lib/recorded_chords';
import { trainVocabulary, withEntry } from '@thoremin/ext-air/lib/vocabulary';
import { chordShapeFeatureIds } from '@thoremin/ext-air/lib/hand_shape';
import { createVocabularyState, createVocabularyStore, useVocabularyStore, type VocabularyRecord } from '@thoremin/ext-air/app/vocabularyStore';
import { enrolSamples } from './synthetic_guitar';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / (xs.length - 1));

describe('the recorded chord shapes', () => {
  it('ship fifteen chords in the live feature space, each playable', () => {
    expect(RECORDED_CHORDS.features).toEqual(chordShapeFeatureIds());
    expect(RECORDED_CHORDS.chords.map((c) => c.label)).toEqual(['E', 'A', 'D', 'G', 'G (2)', 'G (3)', 'C', 'F', 'F (2)', 'Em', 'Am', 'Dm', 'Gm', 'Cm', 'Fm']);
    for (const c of RECORDED_CHORDS.chords) expect(parseChordName(chordOfLabel(c.label))).not.toBeNull();
    expect(RECORDED_CHORDS.heldOut.chordAccuracy).toBeGreaterThan(0.9);
  });

  it('turn back into samples with exactly the summary’s means and spreads', () => {
    const vocab = recordedChordVocabulary();
    expect(vocab.entries).toHaveLength(RECORDED_CHORDS.chords.length);
    for (const [i, e] of vocab.entries.entries()) {
      const c = RECORDED_CHORDS.chords[i]!;
      expect(e.samples).toHaveLength(SEED_SAMPLES);
      for (const f of Object.keys(c.centroid)) {
        const xs = e.samples.map((s) => s[f]!);
        expect(mean(xs)).toBeCloseTo(c.centroid[f]!, 3);
        expect(sd(xs)).toBeCloseTo(c.spread[f]!, 3);
      }
    }
  });

  it('train a classifier that names each chord’s own shape as that chord', () => {
    const model = trainVocabulary(recordedChordVocabulary())!;
    expect(model.categories).toHaveLength(15);
    for (const c of RECORDED_CHORDS.chords) {
      const id = classify(model, c.centroid).categoryId;
      expect(model.categories.find((k) => k.id === id)?.label).toBe(c.label);
    }
  });

  it('a summary with no spread is its centroid', () => {
    const v = vocabularyFromSummary({ ...RECORDED_CHORDS, features: ['a'], chords: [{ label: 'C', centroid: { a: 1 }, spread: {}, frames: 1 }] });
    expect(v.entries[0]!.samples.every((s) => s.a === 1)).toBe(true);
  });
});

describe('voicing labels', () => {
  it('a numbered voicing plays its chord', () => {
    expect(chordOfLabel('G (2)')).toBe('G');
    expect(chordOfLabel('F#m (3)')).toBe('F#m');
    expect(chordOfLabel('Em')).toBe('Em');
  });
  it('a typed label is spelled canonically, voicing kept, the first voicing plain', () => {
    expect(canonicalChordLabel('g (2)')).toBe('G (2)');
    expect(canonicalChordLabel('Gmaj(3)')).toBe('G (3)');
    expect(canonicalChordLabel('g (1)')).toBe('G');
    expect(canonicalChordLabel('em')).toBe('Em');
    expect(canonicalChordLabel('H (2)')).toBeNull();
  });
});

describe('the guitar vocabulary starts from the recorded chords', () => {
  const setup = (records: VocabularyRecord[] = []) => {
    const provider = createInMemoryProvider<VocabularyRecord>(records, { searchFields: ['name'] });
    useVocabularyStore(provider);
    const published: unknown[] = [];
    const state = createVocabularyState({ name: 'guitar', features: chordShapeFeatureIds(), publish: (m) => published.push(m), seed: recordedChordVocabulary });
    return { provider, state, published };
  };

  it('with nothing saved: the recorded chords are played, and nothing is saved until the player changes them', async () => {
    const { provider, state, published } = setup();
    await state.getState().load();
    expect(state.getState().vocab.entries.map((e) => e.label)).toHaveLength(15);
    expect((published.at(-1) as { categories: unknown[] }).categories).toHaveLength(15);
    expect(await createVocabularyStore(provider).load('guitar')).toBeNull();
    useVocabularyStore(null);
  });

  it('a saved list is kept as it is; "use the recorded chords" puts them in, keeping the player’s other chords', async () => {
    const own = withEntry({ features: chordShapeFeatureIds(), entries: [] }, 'G', enrolSamples('G', 40, 1));
    const withB7 = withEntry(own, 'B7', enrolSamples('C', 40, 2));
    const { provider, state } = setup([{ id: 'guitar', name: 'guitar', createdAt: 0, vocabulary: withB7 }]);
    await state.getState().load();
    expect(state.getState().vocab.entries.map((e) => e.label)).toEqual(['G', 'B7']);
    await state.getState().useSeed();
    const labels = state.getState().vocab.entries.map((e) => e.label);
    expect(labels).toHaveLength(16);
    expect(labels).toContain('B7');
    // The recorded G replaced the player's (wrong-hand) G.
    expect(state.getState().vocab.entries.find((e) => e.label === 'G')!.samples).toEqual(recordedChordVocabulary().entries.find((e) => e.label === 'G')!.samples);
    expect((await createVocabularyStore(provider).load('guitar'))!.vocabulary.entries).toHaveLength(16);
    useVocabularyStore(null);
  });
});

describe('labels checked against a progression of fourths', async () => {
  const { labelsByFourths, voicingLabels } = await import('../../scripts/air/lib_recorded_chords');
  it('a doubtful name that breaks the fourths is replaced by the one they imply; a sure one is kept', () => {
    const d = labelsByFourths(['E', 'A', 'B', 'G', 'C'], [0.9, 0.9, 0.4, 0.9, 0.9]);
    expect(d.map((x) => x.label)).toEqual(['E', 'A', 'D', 'G', 'C']);
    expect(labelsByFourths(['E', 'A', 'B', 'G'], [0.9, 0.9, 0.95, 0.9]).map((x) => x.label)).toEqual(['E', 'A', 'B', 'G']);
  });
  it('keeps the quality, and a repeat is not a break', () => {
    expect(labelsByFourths(['Am', 'Em', 'Gm'], [0.9, 0.3, 0.9]).map((x) => x.label)).toEqual(['Am', 'Dm', 'Gm']);
    expect(labelsByFourths(['G', 'G', 'C'], [0.9, 0.3, 0.9]).map((x) => x.label)).toEqual(['G', 'G', 'C']);
  });
  it('a name said again is the next voicing', () => {
    expect(voicingLabels(['G', 'G', 'C', 'G'])).toEqual(['G', 'G (2)', 'C', 'G (3)']);
  });
});
