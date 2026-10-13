/**
 * The face session store end to end (#330 P2), with the synthetic face and in-memory stores:
 * record (rest, then faces), stop and carve at the suggested k, switch neutral in and out of the
 * categories, re-cut k, rename (one click; the general model's names re-matched around it),
 * save several, reopen one with its stills from the store, and delete (its stills go with it
 * unless another saved categorizer shares the take).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore, type FrameGrabber } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';

let clock = 0;
const thumbs = memoryThumbStore();
const grabbed: number[][] = [];
const grab: FrameGrabber = async (_blob, seconds) => {
  grabbed.push([...seconds]);
  return seconds.map((s) => new Blob([`still@${s.toFixed(2)}`], { type: 'image/jpeg' }));
};
const claims: boolean[] = [];

function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => {
      const src = syntheticSource(() => clock);
      // A fake video: the store only needs SOME stream to start a take; MediaRecorder is absent
      // in Node, so the take keeps no video and the stills come from a stubbed blob below.
      return { ...src, video: () => null };
    },
    thumbs,
    grab,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: (on) => claims.push(on),
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-13T00:00:00.000Z',
    ...over,
  };
}

/** Advance the fake clock and the poll together, `ms` at a time. */
async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}


/** A MediaRecorder and MediaStream for Node: the take keeps a one-chunk video, and `stop` ends
 *  on a later microtask, as a real recorder's does (so a Stop has something to wait for). */
function stubRecorder() {
  const blob = new Blob(['video']);
  class FakeRecorder {
    state = 'inactive';
    mimeType = 'video/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onstart: (() => void) | null = null;
    start() {
      this.state = 'recording';
      this.onstart?.();
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable?.({ data: blob });
        this.onstop?.();
      });
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(private tracks: unknown[] = []) {}
      getVideoTracks() {
        return this.tracks;
      }
    },
  );
}
const withVideo = () => ({ ...syntheticSource(() => clock), video: () => new (globalThis.MediaStream as unknown as new (t: unknown[]) => MediaStream)([{}]) });

const TAKE_MS = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  claims.length = 0;
  grabbed.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('the face session store', () => {
  it('records, carves, re-carves, renames, saves, reopens and deletes', async () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    s().start();
    expect(s().phase).toBe('rest');
    expect(claims).toEqual([true]);
    await run(SYNTHETIC_TIMELINE.restMs + 300);
    expect(s().phase).toBe('faces');
    await run(TAKE_MS - SYNTHETIC_TIMELINE.restMs);
    expect(s().points).toBeGreaterThan(6);
    await s().stop();
    expect(claims).toEqual([true, false]);
    expect(s().phase).toBe('carved');
    // Default mode: neutral is "none of these"; three expressions.
    expect(s().mode).toBe('reject');
    expect(s().view!.k).toBe(3);
    expect(s().view!.neutral.count).toBeGreaterThan(0);
    expect(s().hasVideo).toBe(false);

    // Neutral in: k grows by one, a category is "neutral".
    s().setMode('partition');
    expect(s().view!.mode).toBe('partition');
    expect(s().view!.k).toBe(4);
    expect(s().view!.categories.map((c) => c.label)).toContain('neutral');
    s().setMode('reject');
    expect(s().view!.k).toBe(3);

    // Re-cut k without recording again.
    s().setK(2);
    expect(s().view!.k).toBe(2);
    s().setK(3);

    // Rename: kept, and "happy" never given twice.
    const happy = s().view!.categories.find((c) => c.label === 'happy')!;
    s().rename(happy.id, 'grin');
    const other = s().view!.categories.find((c) => c.label !== 'grin')!;
    s().rename(other.id, 'happy');
    const labels = s().view!.categories.map((c) => c.label);
    expect(labels).toContain('grin');
    expect(labels.filter((l) => l === 'happy')).toHaveLength(1);
    expect(s().view!.categories.filter((c) => c.source === 'edited')).toHaveLength(2);
    // A second category may not take a name the player already gave: refused, with a notice.
    const third = s().view!.categories.find((c) => c.source !== 'edited')!;
    s().rename(third.id, 'Grin');
    expect(s().notice).toMatch(/already called/);
    expect(s().view!.categories.find((c) => c.id === third.id)!.label).not.toBe('Grin');

    // Save two models from the take.
    expect(await s().save('Mine, three')).toBe(true);
    s().setK(2);
    expect(await s().save('Mine, two')).toBe(true);
    expect(s().saved.map((m) => m.name).sort()).toEqual(['Mine, three', 'Mine, two']);

    // Reopen the first: its names as saved, k fixed.
    const first = s().saved.find((m) => m.name === 'Mine, three')!;
    await s().open(first.id);
    expect(s().phase).toBe('saved');
    expect(s().view!.k).toBe(3);
    expect(s().view!.categories.map((c) => c.label)).toEqual(expect.arrayContaining(['grin', 'happy']));
    s().setK(5); // not without the take
    expect(s().view!.k).toBe(3);
    // Rename and save in the saved view.
    s().rename(s().view!.categories[0].id, 'smirk');
    await s().save('Mine, three');
    await s().open(first.id);
    expect(s().view!.categories[0].label).toBe('smirk');

    await s().remove(first.id);
    expect(s().saved.map((m) => m.name)).toEqual(['Mine, two']);
    expect(s().phase).toBe('idle');
  });

  it('a double Stop carves once, and closing the tool while it stops drops the take cleanly', async () => {
    stubRecorder();
    const store = createFaceSessionStore(deps({ source: withVideo }));
    const s = () => store.getState();
    s().start();
    await run(TAKE_MS);
    const a = s().stop();
    expect(s().phase).toBe('stopping');
    const b = s().stop(); // ignored
    await Promise.all([a, b]);
    expect(s().phase).toBe('carved');

    s().start();
    await run(TAKE_MS);
    const c = s().stop();
    s().reset(); // the panel unmounted mid-stop
    await expect(c).resolves.toBeUndefined();
    expect(s().phase).toBe('idle');
    expect(s().view).toBeNull();
    expect(claims.at(-1)).toBe(false);
    vi.unstubAllGlobals();
  });

  it('stills: grabbed from the kept video at each exemplar time, filed under the take only on save, deleted with the last model of the take', async () => {
    stubRecorder();
    const MS = globalThis.MediaStream as unknown as new (t: unknown[]) => MediaStream;
    const store = createFaceSessionStore(
      deps({
        source: () => ({ ...syntheticSource(() => clock), video: () => new MS([{}]) }),
      }),
    );
    const s = () => store.getState();
    s().start();
    expect(s().hasVideo).toBe(true);
    await run(TAKE_MS);
    await s().stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(s().hasVideo).toBe(true);
    const shown = [...s().view!.categories.flatMap((c) => c.exemplars.map((e) => e.index)), ...s().view!.neutral.exemplars];
    expect(Object.keys(s().thumbs).map(Number).sort((a, b) => a - b)).toEqual([...new Set(shown)].sort((a, b) => a - b));
    // Times are seconds into the video: the still-point's engine time minus the take's start.
    expect(grabbed[0].every((t) => t >= 0 && t <= TAKE_MS / 1000 + 1)).toBe(true);
    // Nothing filed before a save.
    expect(await thumbs.get(`take-1:${shown[0]}`)).toBeNull();
    await s().save('With pictures');
    expect(await thumbs.get(`take-1:${shown[0]}`)).not.toBeNull();
    // Reopened: the stills come back from the store.
    const id = s().saved[0].id;
    await s().open(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(s().thumbs).length).toBeGreaterThan(0);
    await s().remove(id);
    expect(await thumbs.get(`take-1:${shown[0]}`)).toBeNull();

    // Save right after a re-cut: the new exemplars' stills are grabbed before the record is filed.
    let n = 0;
    const store2 = createFaceSessionStore(
      deps({
        source: () => ({ ...syntheticSource(() => clock), video: () => new MS([{}]) }),
        newTakeId: () => `take-${++n + 1}`,
      }),
    );
    const s2 = () => store2.getState();
    s2().start();
    await run(TAKE_MS);
    await s2().stop();
    s2().setK(1);
    await s2().save('Right away');
    for (const i of s2().view!.categories.flatMap((c) => c.exemplars.map((e) => e.index))) expect(await thumbs.get(`take-2:${i}`)).not.toBeNull();
    // Overwriting it by name from another take drops the first take's stills.
    s2().start();
    await run(TAKE_MS);
    await s2().stop();
    await s2().save('right away');
    expect(s2().saved).toHaveLength(1);
    const anyOld = s2().saved.length && (await thumbs.get(`take-2:${shown[0]}`));
    expect(anyOld).toBeNull();
    vi.unstubAllGlobals();
  });

  it('a take stopped during the rest says so and does not carve', async () => {
    const store = createFaceSessionStore(deps());
    store.getState().start();
    await run(1000);
    await store.getState().stop();
    expect(store.getState().phase).toBe('empty');
    expect(store.getState().notice).toMatch(/during the rest/);
  });
});
