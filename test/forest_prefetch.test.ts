/**
 * The re-cut forest built off the page (#499): the prefetcher warms the forest cache from a
 * builder (a worker in the browser), so a re-cut right after finds the forest there; a stale
 * answer is dropped; a builder that fails leaves the re-cut to build on the page as before.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildConstrainedForest } from '@thoremin/sdk/enroll/cluster';
import { CATEGORIZER_FORMAT, CATEGORIZER_VERSION, PersonalCategorizerSchema, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { pendingForest, recut } from '@thoremin/sdk/enroll/sorting';
import { createForestPrefetcher } from '@thoremin/ext-faces/lib/forest_prefetch';

function doc(n: number, shift = 0): PersonalCategorizer {
  const ids = Array.from({ length: n }, (_, i) => `t:${i}`);
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'big',
    features: ['x', 'y'],
    weights: { x: 1, y: 1 },
    strangers: 'nearest',
    samples: ids.map((id, i) => ({ id, vector: { x: ((i * 7919 + shift) % 97) / 10, y: ((i * 104729) % 89) / 10 }, t: i, cue: 'c' })),
    categories: [{ id: 'cat-1', label: '', members: ids }],
    neutral: [],
  });
}

const real = (inputs: NonNullable<ReturnType<typeof pendingForest>>) =>
  Promise.resolve(buildConstrainedForest(inputs.vectors, inputs.features, inputs.weights, { mustLink: inputs.mustLink }));

describe('createForestPrefetcher', () => {
  it('caches the forest it was handed, so the re-cut that follows builds nothing', async () => {
    const c = doc(60);
    const build = vi.fn(real);
    expect(await createForestPrefetcher({ build }).prefetch(c)).toBe(true);
    expect(pendingForest(c)).toBeNull();
    const direct = recut(c, 4);
    expect(direct.ok).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('gives the same cut as building on the page', async () => {
    const c = doc(50, 3);
    const onPage = recut(c, 5);
    const d = doc(50, 4);
    await createForestPrefetcher({ build: real }).prefetch(d);
    const viaWorker = recut(d, 5);
    // d differs from c, so compare against its own cold build
    const cold = recut(doc(50, 4), 5);
    expect(viaWorker).toEqual(cold);
    expect(onPage.ok).toBe(true);
  });

  it('drops an answer a newer request has superseded', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (i: NonNullable<ReturnType<typeof pendingForest>>) => (await gate, real(i));
    const p = createForestPrefetcher({ build: slow });
    const old = doc(40, 11);
    const first = p.prefetch(old);
    const second = p.prefetch(doc(40, 12));
    release();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(pendingForest(old)).not.toBeNull();
  });

  it('leaves the cache cold when the builder fails, and with no builder', async () => {
    const c = doc(30, 21);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await createForestPrefetcher({ build: () => Promise.reject(new Error('no')) }).prefetch(c)).toBe(false);
    expect(await createForestPrefetcher({ build: null }).prefetch(c)).toBe(false);
    expect(pendingForest(c)).not.toBeNull();
    warn.mockRestore();
  });
});
