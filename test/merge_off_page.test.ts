/**
 * Merging a take into a big categorizer off the page (#587): small carves merge on the page (no
 * round trip), big ones in the worker with the same answer; a worker that cannot run falls back to
 * the page; a refusal the merge itself makes (a categorizer it cannot read) still reaches the caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { CATEGORIZER_FORMAT, CATEGORIZER_VERSION, PersonalCategorizerSchema, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { mergeSession } from '@thoremin/sdk/enroll/from_model';
import { createMergeRunner } from '@thoremin/ext-faces/lib/forest_prefetch';

function base(n: number): PersonalCategorizer {
  const ids = Array.from({ length: n }, (_, i) => `t:${i}`);
  const half = Math.floor(n / 2);
  return PersonalCategorizerSchema.parse({
    format: CATEGORIZER_FORMAT,
    version: CATEGORIZER_VERSION,
    name: 'm',
    features: ['x', 'y'],
    weights: { x: 1, y: 1 },
    strangers: 'nearest',
    samples: ids.map((id, i) => ({ id, vector: { x: i < half ? i % 5 : 20 + (i % 5), y: i % 3 }, t: i, cue: 'c' })),
    categories: [
      { id: 'cat-1', label: 'low', members: ids.slice(0, half) },
      { id: 'cat-2', label: 'high', members: ids.slice(half) },
    ],
    neutral: [],
  });
}
const added = [{ id: 'new:0', vector: { x: 21, y: 1 }, t: 1000, cue: 'c' }];

describe('createMergeRunner', () => {
  it('merges a small carve on the page', async () => {
    const run = vi.fn();
    const r = await createMergeRunner({ run, offPageFrom: 100 }).merge(base(20), added, {});
    expect(run).not.toHaveBeenCalled();
    expect(r.categorizer.samples).toHaveLength(21);
  });

  it('hands a big carve to the worker and returns what it answers', async () => {
    const b = base(120);
    const run = vi.fn(async (...args: Parameters<typeof mergeSession>) => mergeSession(...args));
    const r = await createMergeRunner({ run, offPageFrom: 100 }).merge(b, added, { seed: 'samples' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(r).toEqual(mergeSession(b, added, { seed: 'samples' }));
  });

  it('runs on the page when the worker cannot run, and passes on a refusal the merge itself makes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dead = createMergeRunner({ run: async () => Promise.reject(new Error('the categorizer worker failed')), offPageFrom: 10 });
    expect((await dead.merge(base(20), added, {})).categorizer.samples).toHaveLength(21);
    const refusing = createMergeRunner({ run: async () => Promise.reject(new Error('features: expected array')), offPageFrom: 10 });
    await expect(refusing.merge(base(20), added, {})).rejects.toThrow('features');
    expect((await createMergeRunner({ run: null, offPageFrom: 10 }).merge(base(20), added, {})).categorizer.samples).toHaveLength(21);
    warn.mockRestore();
  });
});
