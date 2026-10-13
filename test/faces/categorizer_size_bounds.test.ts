/**
 * Where the categorizer size bound applies (#393 lower: "#338: imported categorizers have no
 * size limits", and its review). The bound guards the UNTRUSTED door (`importCategorizer`) and
 * the edits that grow a categorizer (a live face added, a take merged), each refusing with a
 * message; it is not on the shared schema, which also validates the player's saved records, so a
 * record saved before the bound existed still loads instead of silently vanishing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { addSample } from '@thoremin/ext-faces/lib/corrections';
import {
  CATEGORIZER_FORMAT,
  CATEGORIZER_VERSION,
  MAX_CATEGORIZER_SAMPLES,
  exportCategorizer,
  importCategorizer,
  type PersonalCategorizer,
} from '@thoremin/sdk/enroll/categorizer';

const models = () => createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] }));

/** A two-category categorizer padded with free samples (in no category) to `total`. */
function sized(total: number): PersonalCategorizer {
  const core = [
    { id: 's-0', vector: { x: 0, y: 0 }, t: 0, cue: 'faces' },
    { id: 's-1', vector: { x: 1, y: 1 }, t: 1, cue: 'faces' },
  ];
  const free = Array.from({ length: total - core.length }, (_, i) => ({ id: `s-${i + 2}`, vector: { x: 0.5, y: 0.5 }, t: i + 2, cue: 'faces' }));
  return {
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    neutralTrained: true,
    name: 'big',
    features: ['x', 'y'],
    weights: { x: 1, y: 1 },
    strangers: 'nearest',
    samples: [...core, ...free],
    categories: [
      { id: 'cat-1', label: 'low', members: ['s-0'] },
      { id: 'cat-2', label: 'high', members: ['s-1'] },
    ],
    neutral: [],
    aside: free.map((x) => x.id),
  };
}

describe('the size bound: refused at the door, never by the saved-record schema', () => {
  it('an import over the bound is refused, saying why', () => {
    const r = importCategorizer(exportCategorizer(sized(MAX_CATEGORIZER_SAMPLES + 1)));
    expect(r).toEqual({ ok: false, error: `invalid categorizer: samples: too many (${MAX_CATEGORIZER_SAMPLES + 1}; at most ${MAX_CATEGORIZER_SAMPLES})` });
    expect(importCategorizer(exportCategorizer(sized(MAX_CATEGORIZER_SAMPLES))).ok).toBe(true);
  });

  it('a saved record over the bound (saved before it existed) still loads', async () => {
    const store = models();
    const big = sized(MAX_CATEGORIZER_SAMPLES + 10);
    const rec = await store.save('Big', { categorizer: big });
    const back = await store.load(rec.id);
    expect(back).not.toBeNull();
    expect(back!.model.categorizer.samples).toHaveLength(MAX_CATEGORIZER_SAMPLES + 10);
  });

  it('a live face added at the bound is refused with a message, not thrown', () => {
    const full = sized(MAX_CATEGORIZER_SAMPLES);
    const r = addSample(full, 'cat-1', { x: 0.1, y: 0 }, { sampleId: 'live:0' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/full/);
    // One under the bound, it is added.
    const room = addSample(sized(MAX_CATEGORIZER_SAMPLES - 1), 'cat-1', { x: 0.1, y: 0 }, { sampleId: 'live:0' });
    expect(room.ok).toBe(true);
    if (room.ok) expect(room.categorizer.samples).toHaveLength(MAX_CATEGORIZER_SAMPLES);
  });
});

describe('merging a take into a categorizer at the bound', () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1000;
  });
  afterEach(() => vi.useRealTimers());

  const deps = (): FaceSessionDeps => ({
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: models(),
    now: () => clock,
    pollMs: 33,
    claim: () => {},
    newTakeId: () => `take-${clock}`,
    isoNow: () => '2026-10-13T00:00:00.000Z',
  });
  const run = async (ms: number) => {
    for (let t = 0; t < ms; t += 33) {
      clock += 33;
      await vi.advanceTimersByTimeAsync(33);
    }
  };
  const TAKE_MS = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);

  it('a merge that would pass the bound merges nothing, says so, and keeps the categorizer', async () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    // Partition mode: the padding is in no category, so no view selects exemplars over it
    // (in reject mode it would be "none of these", whose exemplars cost seconds at the bound).
    s().setMode('partition');
    s().start();
    await run(TAKE_MS);
    await s().stop();
    expect(await s().save('Mine')).toBe(true);
    await s().open(s().saved[0].id);
    // Pad what is open to the bound with copies of its own first face, set aside.
    const open = s().working!;
    const pad = Array.from({ length: MAX_CATEGORIZER_SAMPLES - open.samples.length }, (_, i) => ({ ...open.samples[0], id: `pad-${i}`, t: i }));
    const full: PersonalCategorizer = { ...open, samples: [...open.samples, ...pad], aside: [...(open.aside ?? []), ...pad.map((x) => x.id)] };
    store.setState({ working: full });

    s().startMerge('samples');
    await run(TAKE_MS);
    await s().stop();
    expect(s().phase).toBe('saved');
    expect(s().merging).toBeNull();
    expect(s().notice).toMatch(new RegExp(`^Nothing was merged: .*more than the ${MAX_CATEGORIZER_SAMPLES}`));
    expect(s().working).toEqual(full);
  });
});
