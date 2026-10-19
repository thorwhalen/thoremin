/**
 * A lean through the session store (#349): "Hold to lean in and out" after a hold is taken makes
 * several holds that, once carved, sit in the category of the hold they leaned on, at every k.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { FACE_TAKE_DEFAULTS } from '@thoremin/ext-faces/lib/take';
import { placeOf } from '@thoremin/sdk/enroll/sorting';

let clock = 1000;
const { restMs, holdMs, glideMs } = SYNTHETIC_TIMELINE;
const SPAN = holdMs + glideMs;
const smileAt = (n: number) => restMs + glideMs + 150 + n * 6 * SPAN;

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
});
afterEach(() => vi.useRealTimers());

describe('a lean through the store', () => {
  it('needs a hold to lean on, then lands its holds with that hold at every k', async () => {
    const store = createFaceSessionStore({
      source: () => ({ ...syntheticSource(() => clock), video: () => null }),
      thumbs: memoryThumbStore(),
      frames: () => null,
      models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
      now: () => clock,
      pollMs: 33,
      claim: () => undefined,
      newTakeId: () => 'take-lean',
      isoNow: () => '2026-10-19T00:00:00.000Z',
    });
    const s = () => store.getState();
    s().start();
    const t0 = clock;
    await run(restMs + 400);
    // Nothing taken yet: nothing to lean on.
    expect(s().points).toBe(0);
    s().beginBurst(true);
    expect(s().burst).toBeNull();

    await run(Math.max(0, t0 + smileAt(0) - clock) + 700);
    expect(s().points).toBeGreaterThan(0);
    const before = s().points;
    s().beginBurst(true);
    expect(s().burst).not.toBeNull();
    await run(1200);
    s().endBurst();
    expect(s().points).toBeGreaterThan(before);
    expect(s().points - before).toBeLessThanOrEqual(FACE_TAKE_DEFAULTS.leanHolds);
    await run(Math.max(0, t0 + smileAt(1) - clock));
    await s().stop();
    expect(s().phase).toBe('carved');
    const w = s().working!;
    const anchor = `take-lean:${before - 1}`;
    const leaned = w.samples.map((x) => x.id).filter((id) => Number(id.split(':')[1]) >= before && Number(id.split(':')[1]) < s().points + 0 && id !== anchor);
    expect(leaned.length).toBeGreaterThan(0);
    const { minK, maxK } = s().view!;
    for (let k = minK; k <= maxK; k++) {
      s().setK(k);
      const at = s().working!;
      const home = placeOf(at, anchor);
      for (const id of w.samples.map((x) => x.id).filter((id) => Number(id.split(':')[1]) > before - 1 && Number(id.split(':')[1]) < before + FACE_TAKE_DEFAULTS.leanHolds)) {
        if (!Object.keys(w.pins ?? {}).includes(id)) continue;
        expect(placeOf(at, id), `k=${k} ${id}`).toBe(home);
      }
    }
  });
});
