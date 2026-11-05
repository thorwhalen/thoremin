/**
 * Moving returning players to the true-hand labels (#995): every hand instrument used to default
 * `mirrorHandedness: true` and so read the opposite hand. A stored `true` (the old default; no
 * panel sets it) is dropped from the hot store's dials once per slice version and from a saved
 * instrument on every load, and the flute's enrolled fingerings, keyed by hand (`l.`/`r.`), are
 * turned once and marked so they are never turned twice.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { dropOldMirrorDefault } from '@thoremin/sdk/nodes/player_hands';
import { isDisplayedRight } from '@/nodes/output/overlay/view';
import { CONTRIBUTIONS } from '@/host/contributions';
import { HAND_LABELS_KEY, normalizeLayer } from '@/app/dials/instruments';
import { createVocabularyStore, swapFingeringHands, useFluteFingerVocabulary, useVocabularyStore, type VocabularyRecord } from '@thoremin/ext-air/app/vocabularyStore';
import type { Vocabulary } from '@thoremin/ext-air/lib/vocabulary';

const HAND_DIALS = ['airDrum', 'airBass', 'airGuitar', 'airFlute', 'chordMap', 'chordWheel', 'physicalTheremin', 'conductor'];

describe('the old mirrorHandedness default is dropped (#995)', () => {
  it('a stored true goes, a deliberate false and everything else stay', () => {
    expect(dropOldMirrorDefault({ enabled: true, mirrorHandedness: true })).toEqual({ enabled: true });
    const kept = { enabled: true, mirrorHandedness: false };
    expect(dropOldMirrorDefault(kept)).toBe(kept);
    expect(dropOldMirrorDefault(undefined)).toBeUndefined();
  });

  it("each hand dial's chain drops it, and its schema heals to the player's true hand", () => {
    for (const key of HAND_DIALS) {
      const slice = CONTRIBUTIONS.dialSlices.find((s) => s.key === key);
      expect(slice, key).toBeDefined();
      const last = (slice!.version ?? 1) - 1;
      expect(slice!.migrations?.[last]?.({ enabled: true, mirrorHandedness: true }, {}), `${key}'s last step`).toEqual({ enabled: true });
      const healed = slice!.schema.parse(dropOldMirrorDefault({ ...(slice!.schema.parse(undefined) as object), mirrorHandedness: true })) as { mirrorHandedness: boolean };
      expect(healed.mirrorHandedness, key).toBe(false);
    }
  });

  it("the theremin: a deliberate false (a third-person video) keeps its unmirrored antennas, now `mirrorX`", () => {
    const slice = CONTRIBUTIONS.dialSlices.find((s) => s.key === 'physicalTheremin')!;
    const step = slice.migrations![1]!;
    expect(step({ enabled: true, mirrorHandedness: false }, {})).toEqual({ enabled: true, mirrorHandedness: false, mirrorX: false });
    expect(step({ enabled: true, mirrorHandedness: true }, {})).toEqual({ enabled: true });
  });

  it("the overlay draws the hand labelled Right as the player's right, as the instruments read it", () => {
    expect(isDisplayedRight('Right')).toBe(true);
    expect(isDisplayedRight('Left')).toBe(false);
  });

  it('an instrument saved before the fix loads with the true hands; one saved after keeps its choice', () => {
    const before = normalizeLayer({ airGuitar: { enabled: true, mirrorHandedness: true }, chordMap: { enabled: true, mirrorHandedness: true } } as never) as Record<string, { mirrorHandedness?: boolean }>;
    expect(before.airGuitar!.mirrorHandedness).toBe(false);
    expect(before.chordMap!.mirrorHandedness).toBe(false);
    // Saved by this build (marked): a `true` is the player's own (a mirrored recording), kept.
    const after = normalizeLayer({ airGuitar: { enabled: true, mirrorHandedness: true }, [HAND_LABELS_KEY]: 'true-hand' } as never) as Record<string, { mirrorHandedness?: boolean }>;
    expect(after.airGuitar!.mirrorHandedness).toBe(true);
  });
});

describe("the flute's enrolled fingerings are turned to the true hands once (#995)", () => {
  let provider: ReturnType<typeof createInMemoryProvider<VocabularyRecord>>;
  beforeEach(() => {
    provider = createInMemoryProvider<VocabularyRecord>([], { searchFields: ['name'] });
    useVocabularyStore(provider);
  });
  afterEach(() => useVocabularyStore(null));

  const old: Vocabulary = { features: ['l.index.curl', 'r.index.curl'], entries: [{ label: 'C5', samples: [{ 'l.index.curl': 0.1, 'r.index.curl': 0.9 }] }] };

  it('swaps l. and r. in the features and every sample', () => {
    const turned = swapFingeringHands(old);
    expect(turned.features).toEqual(['r.index.curl', 'l.index.curl']);
    expect(turned.entries[0]!.samples[0]).toEqual({ 'r.index.curl': 0.1, 'l.index.curl': 0.9 });
  });

  it('fingerings saved before the fix are read once, turned, into a new record; the old one is left as it was', async () => {
    const store = createVocabularyStore(provider);
    await store.save('flute-fingers', old);
    await useFluteFingerVocabulary.getState().load();
    const turned = { 'r.index.curl': 0.1, 'l.index.curl': 0.9 };
    expect(useFluteFingerVocabulary.getState().vocab.entries[0]!.samples[0]).toEqual(turned);
    expect((await store.load('flute-fingers-hands'))!.vocabulary.entries[0]!.samples[0]).toEqual(turned);
    // The old record stays for a build that still reads it (a rollback, a stale tab).
    expect((await store.load('flute-fingers'))!.vocabulary).toEqual(old);
    // Loaded again: the new record is read as is, never turned twice.
    await useFluteFingerVocabulary.getState().load();
    expect(useFluteFingerVocabulary.getState().vocab.entries[0]!.samples[0]).toEqual(turned);
  });
});
