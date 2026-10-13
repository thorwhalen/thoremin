// @vitest-environment jsdom
/**
 * Carve quality in "Your faces" (#385 E6): the chips, the suspect holds and the hints reach the
 * Sorting grid through `sortingView` and the session store, in the modality's words; a suspect is
 * one click from where it looks like it belongs; and on the REAL recording `video_head_pose` the
 * chips are the same on every run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createInMemoryProvider } from '@zodal/store';
import { BLENDSHAPE_NAME_BY_FEATURE } from '@thoremin/sdk/features/face_catalog';
import { categorizerFromModel, type FeatureVector } from '@thoremin/sdk/enroll';
import { placeOf } from '@thoremin/sdk/enroll/sorting';
import { exportCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { scriptedCarve } from '../helpers/scripted_carve';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_TIMELINE } from '@thoremin/ext-faces/lib/synthetic';
import { faceTestStore } from '@thoremin/ext-faces/app/faceSession';
import { createFaceTake } from '@thoremin/ext-faces/lib/take';
import { carveView, carverFor, sortingView } from '@thoremin/ext-faces/lib/carving';
import { FaceSessionView } from '@thoremin/ext-faces/panels/FaceSessionPanel';
import { loadStream } from '../helpers/fixtures';
import '@/app/dials/useDialsSettings'; // the dials host the panel's "Play it" reads

const TAKE_MS = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
let clock = 0;

function deps(): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: () => undefined,
    newTakeId: () => 'take-1',
    isoNow: () => '2026-10-13T00:00:00.000Z',
  };
}

async function carved() {
  vi.useFakeTimers();
  const store = createFaceSessionStore(deps());
  store.getState().start();
  for (let t = 0; t < TAKE_MS + 300; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
  await store.getState().stop();
  vi.useRealTimers();
  expect(store.getState().phase).toBe('carved');
  return store;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('quality in the grid', () => {
  it('a chip per category; a misfiled hold is suspect, and one click sends it back', async () => {
    const store = await carved();
    const s = () => store.getState();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const cats = s().working!.categories;
    expect(document.querySelectorAll('[data-face-quality]')).toHaveLength(cats.length);
    // The synthetic faces are distinct expressions: none is close.
    expect(s().view && 'quality' in s().view! && s().view!.quality.categories.every((q) => q.grade !== 'close')).toBe(true);

    // File a hold of category 1 under category 2: it is suspect, looking like category 1.
    const [first, second] = cats;
    const hold = first.members[0];
    act(() => {
      expect(s().moveHolds([hold], second.id)).toBe(true);
    });
    const card = () => document.querySelector(`[data-face-hold="${hold}"]`) as HTMLElement;
    expect(card().querySelector('[data-face-suspect]')?.getAttribute('data-face-suspect')).toBe(first.id);
    // Two holds of a face, one of another: the category is CLOSE to Neutral now, and says so.
    expect(document.querySelector(`[data-face-category="${second.id}"] [data-face-quality]`)?.textContent).toMatch(/close to Neutral/);
    fireEvent.click(card().querySelector('[data-face-accept]')!);
    expect(placeOf(s().working!, hold)).toBe(first.id);
    // Accepting is a move like any other: a pin, and undoable.
    expect(s().working!.pins![hold]).toBe(first.id);
    expect(card().querySelector('[data-face-suspect]')).toBeNull();
  });

  it('a CLOSE pair gets a hint in plain words and a Merge (the scripted carve, imported)', () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(s().importFile(exportCategorizer(scriptedCarve()))).toBe(true);
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const hint = document.querySelector('[data-face-hint="cat-2"]') as HTMLElement;
    expect(hint.textContent).toContain('"open smile" is close to "smile". They differ mostly in mouth open (+');
    expect(hint.textContent).toContain('open your mouth wider for "open smile", or merge them.');
    expect(document.querySelector('[data-face-category="cat-3"] [data-face-quality]')?.getAttribute('data-face-quality')).toBe('distinct');
    const merge = [...hint.querySelectorAll('button')].find((b) => b.textContent === 'Merge with smile')!;
    fireEvent.click(merge);
    expect(s().working!.categories.map((c) => c.label)).toEqual(['smile', 'surprise']);
  });
});

describe('the chips on the REAL recording (video_head_pose)', () => {
  const frames = loadStream('video_head_pose', 'face.pose') as { blendshapes: Record<string, number> }[];
  const FPS = 29.3;
  const vecAt = (i: number): FeatureVector => Object.fromEntries(Object.entries(BLENDSHAPE_NAME_BY_FEATURE).map(([id, name]) => [id, frames[i].blendshapes[name] ?? 0]));

  /** One run: a take over the whole clip (its rest looped to fill the take's), carved at k. */
  function run(k: number) {
    const take = createFaceTake({ restMs: 0 });
    take.start(0);
    const rest: number[] = [];
    for (let i = Math.round(7.7 * FPS); i <= Math.round(8.5 * FPS); i++) rest.push(i);
    let t = 0;
    while (take.phase() === 'rest') {
      take.push(vecAt(rest[Math.floor(t / 33) % rest.length]), t);
      t += 33;
    }
    for (let i = 0; i < frames.length; i++) take.push(vecAt(i), t + (i / FPS) * 1000);
    expect(take.stop()).toBe(true);
    const session = take.session();
    const view = carveView({ session, restVectors: take.restVectors(), carver: carverFor(session, take.restVectors(), 'reject'), k });
    const c = categorizerFromModel(view.model, session.points(), { name: 'head pose', mode: 'reject', modality: 'face' });
    const sorted = sortingView(c, { sources: new Map(), range: { minK: 1, maxK: 6, suggestedK: k } });
    return {
      chips: sorted.quality.categories.map((q) => [q.id, q.grade, q.dots, q.closeTo, q.ratio.toFixed(6)]),
      suspects: [...sorted.suspects],
      hints: [...sorted.hints.values()].map((h) => h.text),
    };
  }

  for (const k of [2, 3]) {
    it(`k = ${k}: the same chips, suspects and hints on every run`, () => {
      const a = run(k);
      expect(run(k)).toEqual(a);
      expect(a.chips.length).toBe(k);
      // Not a vacuous agreement: the clip's few holds make at least one chip something to act on.
      expect(a.chips.some(([, grade]) => grade !== 'distinct')).toBe(true);
    });
  }
});
