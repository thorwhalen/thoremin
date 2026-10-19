/**
 * A big carve through the session store (#587): a re-cut of a categorizer past the suggestion's
 * size waits for its forest to be built in the worker instead of racing it onto the page, and a
 * later move of the k slider wins over an earlier one still waiting; a take merged into it goes
 * through the injected off-page merge. A small carve re-cuts at once, as before.
 */
import { describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { CATEGORIZER_FORMAT, CATEGORIZER_VERSION, PersonalCategorizerSchema, exportCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { scriptedCarve } from '../helpers/scripted_carve';
import { createFaceSessionStore, FACE_SESSION_DEFAULTS, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import type { ForestPrefetcher } from '@thoremin/ext-faces/lib/forest_prefetch';

/** The face features a file may carry (two of the scripted carve's own). */
const [FX, FY] = scriptedCarve().features;

/** `n` holds in four blobs, one category each, over two features. */
function blobs(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `t:${i}`);
  const cats = [0, 1, 2, 3].map((k) => ({ id: `cat-${k + 1}`, label: '', members: ids.filter((_, i) => i % 4 === k) }));
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'big',
    features: [FX, FY],
    weights: { [FX]: 1, [FY]: 1 },
    strangers: 'nearest',
    samples: ids.map((id, i) => ({ id, vector: { [FX]: (i % 4) * 10 + ((i * 7) % 5) / 5, [FY]: (i % 4 === 1 ? 6 : 0) + ((i * 3) % 7) / 7 }, t: i, cue: 'c' })),
    categories: cats,
    neutral: [],
  });
}

function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => 0), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => 0,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-19T00:00:00.000Z',
    ...over,
  };
}

describe('a re-cut waits for the worker\'s forest', () => {
  it('on a big carve the slider waits, and the later move wins; on a small one it cuts at once', async () => {
    const waits: (() => void)[] = [];
    const forests: ForestPrefetcher = {
      prefetch: async () => true,
      whenReady: () => new Promise<void>((r) => waits.push(r)),
    };
    const big = createFaceSessionStore(deps({ forests }));
    expect(big.getState().importFile(exportCategorizer(blobs(FACE_SESSION_DEFAULTS.suggestUpTo + 100)))).toBe(true);
    const k0 = big.getState().view!.k;
    expect(k0).toBe(4);
    big.getState().setK(3);
    big.getState().setK(2);
    expect(big.getState().view!.k).toBe(k0); // nothing yet: the forest is being built
    expect(waits).toHaveLength(2);
    waits.forEach((r) => r());
    await Promise.resolve();
    await Promise.resolve();
    expect(big.getState().view!.k).toBe(2); // the later one, once

    const small = createFaceSessionStore(deps({ forests }));
    expect(small.getState().importFile(exportCategorizer(blobs(60)))).toBe(true);
    small.getState().setK(3);
    expect(small.getState().view!.k).toBe(3);
    expect(waits).toHaveLength(2);
  });
});

describe('a take merged into a carve goes through the injected merge', () => {
  it('is awaited, called once with the carve and the new holds, and its answer is what lands', async () => {
    vi.useFakeTimers();
    let clock = 1000;
    const run = async (ms: number) => {
      for (let t = 0; t < ms; t += 33) {
        clock += 33;
        await vi.advanceTimersByTimeAsync(33);
      }
    };
    const { mergeSession } = await import('@thoremin/sdk/enroll/from_model');
    const merge = vi.fn(async (...args: Parameters<typeof mergeSession>) => mergeSession(...args));
    const store = createFaceSessionStore(
      deps({ merge, source: () => ({ ...syntheticSource(() => clock), video: () => null }), now: () => clock, newTakeId: () => `take-${clock}` }),
    );
    const s = () => store.getState();
    const { restMs, holdMs, glideMs } = SYNTHETIC_TIMELINE;
    const take = restMs + 3 * 6 * (holdMs + glideMs);
    s().start();
    await run(take);
    await s().stop();
    expect(s().phase).toBe('carved');
    const before = s().working!;
    s().startMerge('samples');
    await run(take);
    await s().stop();
    expect(merge).toHaveBeenCalledTimes(1);
    const [base, added] = merge.mock.calls[0];
    expect(base.samples).toHaveLength(before.samples.length);
    expect(added.length).toBeGreaterThan(0);
    expect(s().notice).toMatch(/^Merged/);
    expect(s().working!.samples.length).toBe(before.samples.length + added.length);
    vi.useRealTimers();
  });
});
