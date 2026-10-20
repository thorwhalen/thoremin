/**
 * The worker client behind the categorizer's off-page forest and merge (#499, #587):
 * `workerForestBuilder` and `workerMergeRunner` over a fake `Worker` handed in as the seam.
 * `forest_prefetch.test.ts` and `merge_off_page.test.ts` drive the prefetcher and the merge
 * runner with injected functions; this file pins the client they get in a browser: no worker
 * class, no client; one lazily made worker answering requests by id; an error answer or an
 * answer of the wrong kind rejecting; a worker that dies failing everything waiting and being
 * made again on the next call; a worker that cannot be made rejecting the call.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerForestBuilder, workerMergeRunner, type WorkRequest, type WorkResponse } from '@thoremin/ext-faces/lib/forest_prefetch';
import type { ForestInputs } from '@thoremin/sdk/enroll/sorting';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';

class FakeWorker {
  static made: FakeWorker[] = [];
  posted: WorkRequest[] = [];
  onmessage: ((e: { data: WorkResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FakeWorker.made.push(this);
  }
  postMessage(r: WorkRequest) {
    this.posted.push(r);
  }
  answer(data: WorkResponse) {
    this.onmessage?.({ data });
  }
}

const make = () => new FakeWorker() as unknown as Worker;
const INPUTS = { key: 'k' } as unknown as ForestInputs;
const BASE = { samples: [] } as unknown as PersonalCategorizer;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.made = [];
});

describe('the categorizer worker client', () => {
  it('is null where the browser has no workers', () => {
    vi.stubGlobal('Worker', undefined);
    expect(workerForestBuilder(make)).toBeNull();
    expect(workerMergeRunner(make)).toBeNull();
  });

  it('makes its worker on the first call and answers each request by its id', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const build = workerForestBuilder(make)!;
    expect(FakeWorker.made).toHaveLength(0);
    const a = build(INPUTS);
    const b = build({ key: 'k2' } as unknown as ForestInputs);
    const [w] = FakeWorker.made;
    expect(FakeWorker.made).toHaveLength(1);
    expect(w.posted.map((r) => [r.id, r.kind])).toEqual([[1, 'forest'], [2, 'forest']]);
    // Out of order, and an answer nobody waits for is ignored.
    w.answer({ id: 2, forest: 'f2' as never });
    w.answer({ id: 99, forest: 'stray' as never });
    w.answer({ id: 1, forest: 'f1' as never });
    expect(await a).toBe('f1');
    expect(await b).toBe('f2');
  });

  it('a merge goes the same way, with its base, points and options', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const merge = workerMergeRunner(make)!;
    const p = merge(BASE, [], { k: 3 } as never);
    const [w] = FakeWorker.made;
    expect(w.posted[0]).toMatchObject({ kind: 'merge', base: BASE, points: [], options: { k: 3 } });
    w.answer({ id: 1, merge: 'merged' as never });
    expect(await p).toBe('merged');
  });

  it('an error answer rejects with its message', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const build = workerForestBuilder(make)!;
    const p = build(INPUTS);
    FakeWorker.made[0].answer({ id: 1, error: 'bad inputs' });
    await expect(p).rejects.toThrow('bad inputs');
  });

  it('an answer of the wrong kind rejects', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const build = workerForestBuilder(make)!;
    const merge = workerMergeRunner(make)!;
    const f = build(INPUTS);
    FakeWorker.made[0].answer({ id: 1, merge: 'm' as never });
    await expect(f).rejects.toThrow(/forest request with something else/);
    const m = merge(BASE, [], {} as never);
    FakeWorker.made[1].answer({ id: 1, forest: 'f' as never });
    await expect(m).rejects.toThrow(/merge request with something else/);
  });

  it('a worker that dies fails everything waiting, and the next call makes a new one', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const build = workerForestBuilder(make)!;
    const a = build(INPUTS);
    const b = build(INPUTS);
    FakeWorker.made[0].onerror!();
    await expect(a).rejects.toThrow('the categorizer worker failed');
    await expect(b).rejects.toThrow('the categorizer worker failed');
    const c = build(INPUTS);
    expect(FakeWorker.made).toHaveLength(2);
    FakeWorker.made[1].answer({ id: 3, forest: 'again' as never });
    expect(await c).toBe('again');
  });

  it('a worker that cannot be made rejects the call, and is tried again next time', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    let refuse = true;
    const build = workerForestBuilder(() => {
      if (refuse) throw new Error('blocked by the page policy');
      return make();
    })!;
    await expect(build(INPUTS)).rejects.toThrow('blocked by the page policy');
    refuse = false;
    const p = build(INPUTS);
    await flush();
    FakeWorker.made[0].answer({ id: 1, forest: 'ok' as never });
    expect(await p).toBe('ok');
  });

  it('a thrown non-error is rejected as an error', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const build = workerForestBuilder(() => {
      throw 'nope';
    })!;
    await expect(build(INPUTS)).rejects.toThrow('nope');
  });
});
