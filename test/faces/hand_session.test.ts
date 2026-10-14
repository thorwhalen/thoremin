/**
 * "Your hand shapes" end to end (#385 E8): the SAME session store as "Your faces", over the hand
 * modality. Three acceptance lines of the design (section E, E8):
 *
 * - the scripted hand (`?carve.source=synthetic`) is recorded, carved and saved through the store:
 *   one hand's shape, side-relative, the stills cropped to the hand with its skeleton drawn;
 * - a recorded hands fixture (`video_hand_open_close`, `video_hand_pinch`) replayed through the
 *   store carves an open hand and a fist apart;
 * - a carved hand categorizer, bound through the host's binder, fires its command when the hand
 *   makes that shape (the category dispatcher reads the merged live vector through the hand).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { ok, type Result } from 'acture';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import { HAND_SCRIPT, sourceFromUrl, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { handModalityUi } from '@thoremin/ext-faces/app/handModality';
import { SYNTHETIC_HAND_TIMELINE, syntheticHandShapeFrame } from '@thoremin/ext-faces/lib/synthetic_hand';
import { handModality, handShapeFeatureIds, handsFrameVector } from '@thoremin/sdk/features/modalities/hand';
import { modelFromCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { classify } from '@thoremin/sdk/enroll/classify';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import type { HandsFrame } from '@thoremin/sdk/nodes/domain';
import type { PixelBox, PixelPoint } from '@thoremin/sdk-ui/enroll/modality';
import { categoryBinder } from '@thoremin/sdk-ui/enroll/binder';
import { createCategoryDispatcher } from '@/app/enroll/categoryDispatch';
import { createSavedCategoriesStore, setSavedCategoriesStore, useCategoryBinding } from '@/app/enroll/categoryBinding';
import { loadStream } from '../helpers/fixtures';

let clock = 0;
const crops: (PixelBox | null)[] = [];
const overlays: (readonly (readonly PixelPoint[])[] | null)[] = [];
const frames: FrameOpener = () => ({
  grab: async (crop, overlay) => {
    crops.push(crop?.({ width: 640, height: 480 }) ?? null);
    overlays.push(overlay?.({ width: 640, height: 480 }) ?? null);
    return new Blob([`still-${crops.length}`], { type: 'image/jpeg' });
  },
  close: () => {},
});
const STREAM = {} as MediaStream;

const models = () => createCategorizerStore(handModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });

function deps(source: () => FaceSource, over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source,
    thumbs: memoryThumbStore(),
    frames,
    region: handModalityUi.region,
    overlay: handModalityUi.overlay,
    models: models(),
    modality: handModality,
    now: () => clock,
    pollMs: 33,
    claim: () => {},
    newTakeId: () => 'take-h',
    isoNow: () => '2026-10-13T00:00:00.000Z',
    ...over,
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}

/** The scripted hand, chosen the way the page chooses it, timed by the fake clock. */
function scriptedHand(): FaceSource {
  const real = sourceFromUrl('?carve.source=synthetic', HAND_SCRIPT);
  expect(real.kind).toBe('synthetic');
  real.dispose();
  const start = clock;
  let frame = 0;
  return { kind: 'synthetic', read: () => ({ vector: HAND_SCRIPT.vectorAt(clock - start, frame++), t: clock }), video: () => STREAM, dispose: () => {} };
}

const SHAPES_MS = SYNTHETIC_HAND_TIMELINE.restMs + 16 * (SYNTHETIC_HAND_TIMELINE.holdMs + SYNTHETIC_HAND_TIMELINE.glideMs);
const SHAPE_IDS = new Set(handShapeFeatureIds());

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  crops.length = 0;
  overlays.length = 0;
});
afterEach(() => vi.useRealTimers());

/** Record the scripted hand and save it: the saved record. */
async function carveScripted(name = 'My shapes'): Promise<{ record: CategorizerRecord; store: ReturnType<typeof createFaceSessionStore>; d: FaceSessionDeps }> {
  const d = deps(scriptedHand);
  const store = createFaceSessionStore(d);
  store.getState().start();
  await run(SHAPES_MS);
  await store.getState().stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getState().phase).toBe('carved');
  expect(await store.getState().save(name)).toBe(true);
  const [saved] = await d.models.list();
  const record = (await d.models.load(saved.id))!;
  return { record, store, d };
}

describe('Your hand shapes: the scripted hand through the session store', () => {
  it('records, carves and saves one hand shape per category, side-relative, with cropped stills', async () => {
    const { record, store } = await carveScripted();
    const c = record.model.categorizer;
    expect(record.id).toBe('hand:my-shapes');
    expect(c.modality).toBe('hand');
    expect(c.hand).toBeUndefined(); // either hand (the default) is written as absent
    // Side-relative shape features only: no `hand.right.*`, no positions.
    for (const f of c.features) expect(SHAPE_IDS.has(f)).toBe(true);
    for (const s of c.samples) for (const k of Object.keys(s.vector)) expect(SHAPE_IDS.has(k)).toBe(true);
    // The four scripted shapes, apart from the relaxed hand (Neutral).
    const labels = c.categories.map((x) => x.label);
    expect(c.categories.length).toBeGreaterThanOrEqual(3);
    expect(labels).toEqual(expect.arrayContaining(['fist', 'pinch']));
    expect(c.neutral.length).toBeGreaterThan(0);
    // Every still cropped to the hand (a square around the wrist and fingertips), its skeleton drawn.
    expect(crops.length).toBeGreaterThan(0);
    for (const b of crops) {
      expect(b).not.toBeNull();
      expect(b!.w).toBeCloseTo(b!.h, 6);
      expect(b!.w).toBeGreaterThan(0);
    }
    expect(overlays.every((o) => o !== null && o.length === 5)).toBe(true);
    // The words are the hand's.
    expect(store.getState().modality.words.many).toBe('hand shapes');
  });

  it('keeps which hand on the file, and reads only that hand', async () => {
    const d = deps(scriptedHand);
    const store = createFaceSessionStore(d);
    store.getState().setHand('left');
    expect(store.getState().hand).toBe('left');
    store.getState().start();
    await run(SHAPES_MS);
    await store.getState().stop();
    // The scripted hand is a RIGHT hand: read as the left only, nothing is in view.
    expect(store.getState().phase).toBe('empty');
    store.getState().setHand('right');
    store.getState().start();
    await run(SHAPES_MS);
    await store.getState().stop();
    expect(store.getState().phase).toBe('carved');
    expect(store.getState().working!.hand).toBe('right');
    // An edit of the working categorizer (undoable).
    store.getState().setHand('either');
    expect(store.getState().working!.hand).toBeUndefined();
    store.getState().undo();
    expect(store.getState().working!.hand).toBe('right');
  });
});

/** A recorded hands fixture's frames as merged live vectors (as the live node reads them). */
function fixtureVectors(scenario: string): FeatureVector[] {
  return (loadStream(scenario, 'src.hands') as HandsFrame[]).map((f) => handsFrameVector(f));
}

describe('Your hand shapes: a recorded hands fixture through the session store', () => {
  it('carves the recorded open hand and fist apart', async () => {
    const openClose = fixtureVectors('video_hand_open_close');
    const pinch = fixtureVectors('video_hand_pinch');
    // The rest is the scripted relaxed hand (a rest with its jitter); then the recordings, each
    // twice, slowed to half speed (each frame shown for two camera frames) so that the quick
    // open-close of the clip is held long enough to be taken.
    const slow = (v: FeatureVector[]) => v.flatMap((x) => [x, x]);
    const take = [...slow(openClose), ...slow(pinch), ...slow(openClose), ...slow(pinch)];
    let rest = 0;
    let i = 0;
    let started = false;
    const source = (): FaceSource => ({
      kind: 'live',
      read: () => {
        if (!started) return null;
        if (rest < 140) return { vector: handsFrameVector(syntheticHandShapeFrame('rest', rest++)), t: clock };
        return i < take.length ? { vector: take[i++], t: clock } : null;
      },
      video: () => STREAM,
      dispose: () => {},
    });
    const d = deps(source);
    const store = createFaceSessionStore(d);
    started = true;
    store.getState().start();
    await run(140 * 33 + take.length * 33 + 200);
    await store.getState().stop();
    expect(store.getState().phase).toBe('carved');
    const c = store.getState().working!;
    expect(c.modality).toBe('hand');
    expect(c.categories.length).toBeGreaterThanOrEqual(2);
    // The fixture's wide-open frames and its closed fists fall in different categories (each frame
    // read as its nearest category: the carve's split, not its reject radius, is what is checked).
    const model = { ...modelFromCategorizer(c), rejectRadius: Number.POSITIVE_INFINITY, neutral: undefined };
    const read = (v: FeatureVector) => classify(model, handModality.read(v)!).categoryId;
    const open = openClose.filter((v) => handModality.read(v)!.openness > 2.5);
    const fist = openClose.filter((v) => handModality.read(v)!.openness < 1.1);
    expect(open.length).toBeGreaterThan(5);
    expect(fist.length).toBeGreaterThan(5);
    const openIds = new Set(open.map(read));
    const fistIds = new Set(fist.map(read));
    for (const id of fistIds) expect(openIds.has(id)).toBe(false);
  });
});

describe('Your hand shapes: a bound command', () => {
  it('a carved hand categorizer fires the command bound to a shape', async () => {
    setSavedCategoriesStore(createSavedCategoriesStore(createInMemoryProvider([], { idField: 'id', searchFields: ['name'] })));
    const { record, store } = await carveScripted('Hand commands');
    const binder = categoryBinder();
    expect(binder).not.toBeNull(); // installed by the host's bindings module
    expect(await store.getState().bindSaved(record.id, binder!)).toBe(true);
    const active = useCategoryBinding.getState().active!;
    expect(active.name).toBe('Hand commands');
    expect(active.categories.read).toEqual({ modality: 'hand' });
    const fist = active.categories.model.categories.find((x) => x.label === 'fist')!;
    await useCategoryBinding.getState().setBinding(fist.id, { command: 'transport.toggle' });

    // The live vector is the MERGED one (`hand.right.*`); the dispatcher reads it through the hand.
    let vector: FeatureVector | null = null;
    const dispatched: string[] = [];
    const d = createCategoryDispatcher({
      getActive: () => useCategoryBinding.getState().active,
      isEnabled: () => true,
      isPreviewing: () => false,
      holdMs: () => 0,
      isHushed: () => false,
      readVector: () => vector,
      hasCommand: () => true,
      commandTitle: (id) => id,
      isBindable: () => true,
      dispatch: async (command): Promise<Result<unknown>> => {
        dispatched.push(command);
        return ok(undefined);
      },
      notify: () => {},
    });
    const hold = (shape: string, frames: number, t0: number) => {
      for (let f = 0; f < frames; f++) {
        vector = handsFrameVector(syntheticHandShapeFrame(shape, t0 + f), { mirrorHandedness: false });
        d.tick(1000 + (t0 + f) * 33);
      }
    };
    hold('rest', 20, 0);
    expect(dispatched).toEqual([]);
    hold('fist', 20, 20);
    expect(dispatched).toEqual(['transport.toggle']);
    // The left hand makes the same shape (either hand): after a rest, it fires again.
    hold('rest', 20, 40);
    for (let f = 0; f < 20; f++) {
      vector = handsFrameVector(syntheticHandShapeFrame('fist', 60 + f), { mirrorHandedness: true });
      d.tick(1000 + (60 + f) * 33);
    }
    expect(Object.keys(vector!).some((k) => k.startsWith('hand.left.'))).toBe(true);
    expect(dispatched).toEqual(['transport.toggle', 'transport.toggle']);
    setSavedCategoriesStore(null);
  });
});
