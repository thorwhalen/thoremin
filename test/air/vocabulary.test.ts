/**
 * The enrolled vocabulary (#249): a few held samples per shape train a classifier that
 * recognises fresh holds of the same shapes, labelled with the player's names; the
 * samples survive a JSON round trip (what localStorage does to them) and the model
 * derived from them is the same.
 */
import { describe, it, expect } from 'vitest';
import { classify } from '@thoremin/sdk/enroll';
import { VocabularySchema, emptyVocabulary, jitterWeights, trainVocabulary, withEntry, withoutEntry, MIN_SAMPLES_PER_ENTRY } from '@/extensions/air/lib/vocabulary';
import { chordShapeFeatureIds } from '@/extensions/air/lib/hand_shape';
import { enrolSamples } from './synthetic_guitar';

const NAMES: Record<string, string> = { G: 'G', C: 'C', D: 'D', E: 'Em' };

function vocabOf(n = 40) {
  let v = emptyVocabulary(chordShapeFeatureIds());
  Object.entries(NAMES).forEach(([shape, label], i) => (v = withEntry(v, label, enrolSamples(shape, n, 100 + i))));
  return v;
}

describe('the enrolled vocabulary', () => {
  it('recognises fresh holds of each enrolled shape by the player\'s name', () => {
    const model = trainVocabulary(vocabOf())!;
    expect(model.categories.map((c) => c.label)).toEqual(['G', 'C', 'D', 'Em']);
    for (const [shape, label] of Object.entries(NAMES)) {
      const fresh = enrolSamples(shape, 30, 900);
      const results = fresh.map((v) => classify(model, v));
      // The nearest enrolled chord is the right one...
      const nearest = results.filter((c) => {
        const best = Object.entries(c.memberships).sort((a, b) => b[1] - a[1])[0][0];
        return model.categories.find((k) => k.id === best)?.label === label;
      }).length;
      expect(nearest / fresh.length, label).toBeGreaterThanOrEqual(0.95);
      // ...and most holds are inside the reject radius (it accepts 90% of the training
      // holds by construction; live, the tracker HOLDS the chord through a rejected frame).
      expect(results.filter((c) => c.rejected).length / fresh.length, label).toBeLessThanOrEqual(0.25);
    }
  });

  it('weights each feature by the inverse of its within-shape jitter', () => {
    const v = vocabOf();
    const w = jitterWeights(v.entries, v.features);
    for (const f of v.features) expect(w[f]).toBeGreaterThan(0);
    // A feature constant within every shape and between them still gets a finite weight.
    const flat = jitterWeights([{ label: 'x', samples: [{ a: 1 }, { a: 1 }] }], ['a']);
    expect(Number.isFinite(flat.a)).toBe(true);
  });

  it('needs enough samples per entry, and a name per entry', () => {
    expect(trainVocabulary(emptyVocabulary(['a']))).toBeNull();
    const thin = withEntry(emptyVocabulary(chordShapeFeatureIds()), 'G', enrolSamples('G', MIN_SAMPLES_PER_ENTRY - 1, 1));
    expect(trainVocabulary(thin)).toBeNull();
    expect(() => VocabularySchema.parse({ features: [], entries: [{ label: ' ', samples: [] }] })).toThrow();
  });

  it('replaces an entry of the same name and removes by name', () => {
    let v = vocabOf(10);
    v = withEntry(v, 'G', enrolSamples('A', 12, 5));
    expect(v.entries.map((e) => e.label)).toEqual(['G', 'C', 'D', 'Em']);
    expect(v.entries[0].samples).toHaveLength(12);
    expect(withoutEntry(v, 'C').entries.map((e) => e.label)).toEqual(['G', 'D', 'Em']);
  });

  it('survives JSON (non-finite features are dropped at capture) and trains the same model', () => {
    const v = withEntry(vocabOf(10), 'A', enrolSamples('A', 10, 3).map((s) => ({ ...s, broken: NaN })));
    const round = VocabularySchema.parse(JSON.parse(JSON.stringify(v)));
    expect(round).toEqual(v);
    expect(trainVocabulary(round)).toEqual(trainVocabulary(v));
  });
});
