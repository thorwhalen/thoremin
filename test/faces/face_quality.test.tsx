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
  it('a chip per category on a fresh carve; none is close on the distinct synthetic faces', async () => {
    const store = await carved();
    const s = () => store.getState();
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const cats = s().working!.categories;
    expect(document.querySelectorAll('[data-face-quality]')).toHaveLength(cats.length);
    expect([...document.querySelectorAll('[data-face-quality]')].every((x) => x.getAttribute('data-face-quality') !== 'close')).toBe(true);
  });

  it('a misfiled hold is suspect, and one click sends it where it looks like it belongs; a placed one is not', () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    // The scripted carve with one surprise hold filed under smile (as a carve could leave it: no pin).
    const c = scriptedCarve({ sd: 0.01 });
    const hold = c.categories[2].members[0];
    c.categories[2].members = c.categories[2].members.slice(1);
    c.categories[0].members.push(hold);
    expect(s().importFile(exportCategorizer(c))).toBe(true);
    render(<FaceSessionView store={store} test={faceTestStore()} />);
    const card = () => document.querySelector(`[data-face-hold="${hold}"]`) as HTMLElement;
    expect(card().querySelector('[data-face-suspect]')?.getAttribute('data-face-suspect')).toBe('cat-3');
    fireEvent.click(card().querySelector('[data-face-accept]')!);
    expect(placeOf(s().working!, hold)).toBe('cat-3');
    // Accepting is a move like any other: a pin.
    expect(s().working!.pins![hold]).toBe('cat-3');
    expect(card().querySelector('[data-face-suspect]')).toBeNull();
    // Put back on purpose (a pin): the player decided, so no mark.
    act(() => {
      expect(s().moveHolds([hold], 'cat-1')).toBe(true);
    });
    expect(placeOf(s().working!, hold)).toBe('cat-1');
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

  /** A run differs from another the way two replays of one take would: the clock's phase, and
   *  jitter on every hold far below a noise unit (`holdJitterNu`, in each feature's own unit).
   *  The jitter goes on the carved holds, not the frames: this clip's rest is looped, so its
   *  frames have no jitter at all and any added to them re-estimates the noise from scratch and
   *  changes which holds the sampler finds, a different take upstream of the chips. */
  interface Variant {
    offsetMs: number;
    holdJitterNu: number;
    seed: number;
  }
  const BASE: Variant = { offsetMs: 0, holdJitterNu: 0, seed: 1 };
  const VARIANTS: Variant[] = [
    { offsetMs: 11, holdJitterNu: 0, seed: 2 },
    { offsetMs: 23, holdJitterNu: 0.05, seed: 3 },
    { offsetMs: 5, holdJitterNu: 0.1, seed: 4 },
  ];

  /** One run: a take over the whole clip (its rest looped to fill the take's), carved at k. */
  function run(k: number, v: Variant = BASE) {
    let a = v.seed;
    const noise = () => {
      a = (a * 1103515245 + 12345) % 2147483648;
      return (a / 2147483648 - 0.5) * 2;
    };
    const take = createFaceTake({ restMs: 0 });
    take.start(v.offsetMs);
    const rest: number[] = [];
    for (let i = Math.round(7.7 * FPS); i <= Math.round(8.5 * FPS); i++) rest.push(i);
    let t = v.offsetMs;
    while (take.phase() === 'rest') {
      take.push(vecAt(rest[Math.floor(t / 33) % rest.length]), t);
      t += 33;
    }
    for (let i = 0; i < frames.length; i++) take.push(vecAt(i), t + (i / FPS) * 1000);
    expect(take.stop()).toBe(true);
    const session = take.session();
    const view = carveView({ session, restVectors: take.restVectors(), carver: carverFor(session, take.restVectors(), 'reject'), k });
    const carved = categorizerFromModel(view.model, session.points(), { name: 'head pose', mode: 'reject', modality: 'face' });
    const c = {
      ...carved,
      samples: carved.samples.map((x) => ({ ...x, vector: Object.fromEntries(Object.entries(x.vector).map(([f, y]) => [f, y + (v.holdJitterNu * noise()) / (carved.weights[f] || 1)])) })),
    };
    const sorted = sortingView(c, { sources: new Map(), range: { minK: 1, maxK: 6, suggestedK: k } });
    return {
      chips: sorted.quality.categories.map((q) => [q.id, q.grade, q.dots, q.closeTo]),
      suspects: [...sorted.suspects],
      hints: [...sorted.hints.values()].map((h) => h.movements.map((m) => m.movement)),
    };
  }

  for (const k of [2, 3]) {
    it(`k = ${k}: the same chips, suspects and hint movements on every run (clock phase, sub-noise jitter)`, () => {
      const a = run(k);
      for (const v of VARIANTS) {
        const b = run(k, v);
        expect(b, JSON.stringify(v)).toEqual(a);
      }
      expect(a.chips.length).toBe(k);
      // Not a vacuous agreement: the clip's few holds make at least one chip something to act on.
      expect(a.chips.some(([, grade]) => grade !== 'distinct')).toBe(true);
    });
  }
});
