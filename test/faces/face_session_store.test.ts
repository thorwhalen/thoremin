/**
 * The face session store end to end (#330 P2), with the synthetic face and in-memory stores:
 * record (rest, then faces), stop and carve at the suggested k, switch neutral in and out of the
 * categories, re-cut k, rename (one click; the general model's names re-matched around it),
 * save several, reopen one with its stills from the store, and delete (its stills go with it
 * unless another saved categorizer names the same holds). #385 E3: stills are taken at capture,
 * one per hold, keyed by the hold's id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import type { PixelBox } from '@thoremin/sdk-ui/enroll/modality';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';

let clock = 0;
const thumbs = memoryThumbStore();
/** The crop each still was asked with (null: the whole frame), in order. */
const grabbed: (PixelBox | null)[] = [];
/** A stream opener for Node: every grab is a still named by its order. */
const frames: FrameOpener = () => ({
  grab: async (crop) => {
    grabbed.push(crop?.({ width: 640, height: 480 }) ?? null);
    return new Blob([`still-${grabbed.length}`], { type: 'image/jpeg' });
  },
  close: () => {},
});
/** Some stream: the store only hands it to the opener. */
const STREAM = {} as MediaStream;
const claims: boolean[] = [];

function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    // No stream by default: the take has no pictures (the stills tests give it one).
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs,
    frames,
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


const withStream = () => ({ ...syntheticSource(() => clock), video: () => STREAM });

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
    expect(s().hasStills).toBe(false);

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
    const store = createFaceSessionStore(deps({ source: withStream }));
    const s = () => store.getState();
    s().start();
    await run(TAKE_MS);
    const a = s().stop();
    // No video to close (#385 E3): the take carves at once.
    expect(s().phase).toBe('carved');
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
  });

  it('stills: one per hold, taken at capture, cropped, filed by hold id only on save, deleted with the last record that names the hold', async () => {
    const box: PixelBox = { x: 10, y: 20, w: 100, h: 100 };
    const regions: { width: number; height: number; keys: number }[] = [];
    const store = createFaceSessionStore(
      deps({
        source: withStream,
        region: ({ vector, width, height }) => {
          regions.push({ width, height, keys: Object.keys(vector).length });
          return box;
        },
      }),
    );
    const s = () => store.getState();
    s().start();
    expect(s().hasStills).toBe(true);
    await run(TAKE_MS);
    await s().stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(s().hasStills).toBe(true);
    // Every hold got its still when it was taken, cropped by the region the live vector gave.
    expect(grabbed).toHaveLength(s().points);
    expect(grabbed.every((b) => b === box)).toBe(true);
    expect(regions.every((r) => r.width === 640 && r.height === 480 && r.keys > 0)).toBe(true);
    const shown = [...s().view!.categories.flatMap((c) => c.exemplars.map((e) => e.index)), ...s().view!.neutral.exemplars];
    expect(Object.keys(s().thumbs).map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: s().points }, (_, i) => i),
    );
    for (const i of shown) expect(s().thumbs[i]).toBeDefined();
    // Nothing filed before a save; then every hold's still, under its id.
    expect(await thumbs.get('take-1:0')).toBeNull();
    await s().save('With pictures');
    const points = s().points;
    for (let i = 0; i < points; i++) expect(await thumbs.get(`take-1:${i}`)).not.toBeNull();
    // Reopened: the stills come back from the store, by the samples' ids.
    const id = s().saved[0].id;
    await s().open(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(s().thumbs).length).toBeGreaterThan(0);
    expect(s().hasStills).toBe(true);
    await s().remove(id);
    expect(await thumbs.get(`take-1:${shown[0]}`)).toBeNull();

    // Overwriting a record by name from another take drops the first take's stills; a record
    // that still names a hold keeps its still.
    let n = 0;
    const store2 = createFaceSessionStore(deps({ source: withStream, newTakeId: () => `take-${++n + 1}` }));
    const s2 = () => store2.getState();
    s2().start();
    await run(TAKE_MS);
    await s2().stop();
    await s2().save('Right away');
    await s2().save('Kept too');
    expect(await thumbs.get('take-2:0')).not.toBeNull();
    s2().start();
    await run(TAKE_MS);
    await s2().stop();
    await s2().save('right away');
    expect(s2().saved).toHaveLength(2);
    expect(await thumbs.get('take-2:0')).not.toBeNull(); // "Kept too" names it
    expect(await thumbs.get('take-3:0')).not.toBeNull();
    await s2().remove(s2().saved.find((m) => m.name === 'Kept too')!.id);
    expect(await thumbs.get('take-2:0')).toBeNull();
  });

  it('a take with no stream takes no pictures, and says so', async () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    s().start();
    await run(TAKE_MS);
    await s().stop();
    expect(grabbed).toHaveLength(0);
    expect(s().hasStills).toBe(false);
    expect(s().thumbs).toEqual({});
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
