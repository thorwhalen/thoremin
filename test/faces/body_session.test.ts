/**
 * "Your poses" end to end (#382 = #385 E9): the SAME session store as "Your faces" and "Your hand
 * shapes", over the body modality. The acceptance lines of #382 and E9:
 *
 * - the scripted body (`?carve.source=synthetic`): the rest, three nuisance demonstrations, four
 *   held poses with the rest between, carves into FOUR at the suggested k, each hold with its stick
 *   figure and no camera still (stills are opt-in, #387 C7);
 * - a re-cut and a correction re-derive the model;
 * - an exported file round-trips with its skeletons;
 * - the mirror (#387 B10, off by default) makes "left arm out" and "right arm out" one pose;
 * - the visibility mask: a body that has lost most of what its categories were taught on "cannot
 *   be seen" in the live test rather than guessed at.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/ext-faces/app/categorizers';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import { BODY_SCRIPT, sourceFromUrl, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { bodyModalityUi, poseFigureSvg } from '@thoremin/ext-faces/app/bodyModality';
import { createFaceTestStore } from '@thoremin/ext-faces/app/testStore';
import { liveModel } from '@thoremin/ext-faces/lib/live';
import { SYNTHETIC_BODY_TIMELINE } from '@thoremin/ext-faces/lib/synthetic_body';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { exportCategorizer, importCategorizer, modelFromCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { classify } from '@thoremin/sdk/enroll/classify';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { loadStream } from '../helpers/fixtures';

let clock = 0;
let grabs = 0;
const frames: FrameOpener = () => ({
  grab: async () => {
    grabs += 1;
    return new Blob([`still-${grabs}`], { type: 'image/jpeg' });
  },
  close: () => {},
});
const STREAM = {} as MediaStream;

const models = () => createCategorizerStore(bodyModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });

function deps(source: () => FaceSource, over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source,
    thumbs: memoryThumbStore(),
    frames,
    region: bodyModalityUi.region,
    figure: bodyModalityUi.figure,
    stillsByDefault: false,
    models: models(),
    modality: bodyModality,
    now: () => clock,
    pollMs: 33,
    claim: () => {},
    newTakeId: () => 'take-b',
    isoNow: () => '2026-10-14T00:00:00.000Z',
    ...over,
  };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}

/** The scripted body, chosen the way the page chooses it, timed by the fake clock; `edit` changes
 *  each vector (a mask, a mirror). */
function scriptedBody(edit: (v: FeatureVector, ms: number) => FeatureVector = (v) => v): FaceSource {
  const real = sourceFromUrl('?carve.source=synthetic', BODY_SCRIPT);
  expect(real.kind).toBe('synthetic');
  real.dispose();
  const start = clock;
  let frame = 0;
  return { kind: 'synthetic', read: () => ({ vector: edit(BODY_SCRIPT.vectorAt(clock - start, frame++), clock - start), t: clock }), video: () => STREAM, dispose: () => {} };
}

const T = SYNTHETIC_BODY_TIMELINE;
/** The rest, the three nuisances, and the four poses twice over. */
const TAKE_MS = T.restMs + 3 * T.nuisanceMs + 16 * (T.holdMs + T.glideMs);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  grabs = 0;
});
afterEach(() => vi.useRealTimers());

async function record(d: FaceSessionDeps, before: (s: ReturnType<typeof createFaceSessionStore>) => void = () => {}) {
  const store = createFaceSessionStore(d);
  before(store);
  store.getState().start();
  // The setup steps: the rest first, then each nuisance in turn.
  await run(T.restMs + 200);
  expect(store.getState().setupStep).toBe(1);
  await run(TAKE_MS - T.restMs - 200);
  await store.getState().stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getState().phase).toBe('carved');
  return store;
}

/** The pose each sample was taken in, from the scripted body's timeline (the hold's time). */
const POSE_BY_HOLD = (c: { samples: readonly { id: string; vector: FeatureVector }[] }) =>
  new Map(
    c.samples.map((s) => {
      const v = s.vector;
      const up = (k: string) => v[`body.dir.upperArm.${k}.up`];
      const name = up('left') > 45 && up('right') > 45 ? 'arms up' : up('left') > -30 && up('right') < -60 ? 'left arm out' : up('right') > -30 && up('left') < -60 ? 'right arm out' : v['body.angle.knee.left'] < 150 ? 'crouch' : 'rest';
      return [s.id, name] as const;
    }),
  );

describe('Your poses: the scripted body through the session store', () => {
  it('carves four held poses with the rest into four at the suggested k, each hold with its stick figure', async () => {
    const d = deps(scriptedBody);
    const store = await record(d);
    const s = store.getState();
    const c = s.working!;
    expect(c.modality).toBe('body');
    expect(c.mirror).toBeUndefined();
    expect(s.view!.k).toBe(4);
    expect(c.categories).toHaveLength(4);
    // Each category is one scripted pose, all of its holds; the rest is Neutral.
    const pose = POSE_BY_HOLD(c);
    const names = c.categories.map((cat) => new Set(cat.members.map((id) => pose.get(id))));
    for (const n of names) expect(n.size).toBe(1);
    expect(names.map((n) => [...n][0]).sort()).toEqual(['arms up', 'crouch', 'left arm out', 'right arm out']);
    expect(c.neutral.length).toBeGreaterThan(0);
    for (const id of c.neutral) expect(pose.get(id)).toBe('rest');
    // No general model yet (B3): the fallback names.
    expect(c.categories.map((x) => x.label).sort()).toEqual(['pose 1', 'pose 2', 'pose 3', 'pose 4']);
    // Only pose features, no positions.
    for (const x of c.samples) for (const k of Object.keys(x.vector)) expect(bodyModality.keep(k)).toBe(true);
    // A stick figure per hold, no camera still (opt-in), and the grid shows the figures.
    expect(c.samples.every((x) => x.skeleton !== undefined && x.skeleton['wrist.left'] !== undefined)).toBe(true);
    expect(grabs).toBe(0);
    expect(s.hasStills).toBe(false);
    expect(s.figures).toBe(true);
    expect(Object.keys(s.thumbs)).toHaveLength(c.samples.length);
    expect(s.thumbs[0]).toMatch(/^data:image\/svg\+xml/);
  });

  it('a re-cut and a correction re-derive the model', async () => {
    const d = deps(scriptedBody);
    const store = await record(d);
    const before = store.getState().working!;
    store.getState().setK(3);
    const three = store.getState().working!;
    expect(three.categories).toHaveLength(3);
    expect(modelFromCategorizer(three).categories).toHaveLength(3);
    store.getState().setK(4);
    expect(store.getState().working!.categories).toHaveLength(4);
    // A correction (of a saved categorizer): a live "arms up" added to the arms-up category.
    expect(await store.getState().save('Corrected')).toBe(true);
    const [saved] = await d.models.list();
    await store.getState().open(saved.id);
    expect(store.getState().phase).toBe('saved');
    const c = store.getState().working!;
    const pose = POSE_BY_HOLD(c);
    const up = c.categories.find((cat) => pose.get(cat.members[0]) === 'arms up')!;
    const live = BODY_SCRIPT.vectorAt(T.restMs + 3 * T.nuisanceMs + 600, 999);
    expect(store.getState().correct(up.id, live)).toBe(true);
    const corrected = store.getState().working!;
    const added = corrected.samples.at(-1)!;
    expect(corrected.categories.find((x) => x.id === up.id)!.members).toContain(added.id);
    expect(added.skeleton).toBeDefined();
    const model = modelFromCategorizer(corrected);
    expect(model.categories.find((x) => x.id === up.id)!.members).toContain(corrected.samples.length - 1);
    expect(classify(model, live).categoryId).toBe(up.id);
    expect(before.samples.length).toBe(corrected.samples.length - 1);
  });

  it('an exported file round-trips with its skeletons and reads the same', async () => {
    const store = await record(deps(scriptedBody));
    expect(await store.getState().save('My poses')).toBe(true);
    const c = store.getState().working!;
    const text = exportCategorizer(c);
    const back = importCategorizer(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.categorizer.samples.map((x) => x.skeleton)).toEqual(c.samples.map((x) => x.skeleton));
    // Opened from the file into a fresh store: the grid shows the figures it carries.
    const other = createFaceSessionStore(deps(scriptedBody));
    expect(other.getState().importFile(text)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(Object.keys(other.getState().thumbs)).toHaveLength(c.samples.length);
    const a = modelFromCategorizer(c);
    const b = modelFromCategorizer(back.categorizer);
    for (const x of c.samples) expect(classify(b, x.vector).categoryId).toBe(classify(a, x.vector).categoryId);
  });

  it('with the mirror on, left arm out and right arm out are one pose, also when read live', async () => {
    const d = deps(scriptedBody);
    const store = await record(d, (s) => s.getState().setMirror(true));
    const c = store.getState().working!;
    expect(c.mirror).toBe(true);
    // Every sample on the canonical side: the left arm out and the right arm out hold the same vector.
    const pose = POSE_BY_HOLD(c);
    expect([...pose.values()]).not.toContain('right arm out');
    // Three poses now (arms up, one arm out, crouch) at the suggested k.
    expect(store.getState().view!.k).toBe(3);
    expect(await store.getState().save('Mirrored')).toBe(true);
    // The live test reads a right arm out as the left one's category.
    const live = liveModel(c, {}, { modality: bodyModality });
    const left = BODY_SCRIPT.vectorAt(T.restMs + 3 * T.nuisanceMs + 2 * (T.holdMs + T.glideMs) + 600, 7);
    const right = BODY_SCRIPT.vectorAt(T.restMs + 3 * T.nuisanceMs + 4 * (T.holdMs + T.glideMs) + 600, 7);
    const m = modelFromCategorizer(c);
    expect(classify(m, live.project(right)).categoryId).toBe(classify(m, live.project(left)).categoryId);
    expect(classify(m, live.project(left)).categoryId).not.toBeNull();
  });

  it("an opened mirrored categorizer shows its mirror, and closing it returns to the player's choice", async () => {
    const d = deps(scriptedBody);
    const first = await record(d, (s) => s.getState().setMirror(true));
    expect(await first.getState().save('Mirrored')).toBe(true);
    const store = createFaceSessionStore(d);
    expect(store.getState().mirror).toBe(false);
    const [saved] = await d.models.list();
    await store.getState().open(saved.id);
    expect(store.getState().mirror).toBe(true);
    store.getState().reset();
    expect(store.getState().mirror).toBe(false);
  });

  it('a bound pose set needs the modality's own share of its features (the live test's bar)', async () => {
    const { presenceFor } = await import('@/app/enroll/categoryBinding');
    expect(presenceFor({ modality: 'body' })).toBe(bodyModality.minCoverage);
    expect(presenceFor({ modality: 'hand' })).toBeUndefined();
    expect(presenceFor(undefined)).toBeUndefined();
  });

  it('camera stills are opt-in, and the setup steps can be skipped', async () => {
    const d = deps(scriptedBody);
    const store = createFaceSessionStore(d);
    expect(store.getState().keepStills).toBe(false);
    store.getState().setKeepStills(true);
    store.getState().start();
    await run(T.restMs + 200);
    expect(store.getState().setupStep).toBe(1);
    store.getState().skipSetup();
    store.getState().skipSetup();
    expect(store.getState().setupStep).toBe(3);
    store.getState().skipSetup();
    expect(store.getState().setupStep).toBe(0);
    await run(33);
    expect(store.getState().phase).toBe('faces');
    expect(store.getState().hasStills).toBe(true);
    store.getState().cancelRecording();
  });

  it('the live test says it cannot see you when most of the taught features are gone', async () => {
    const store = await record(deps(scriptedBody));
    const c = store.getState().working!;
    const live = liveModel(c, {}, { modality: bodyModality });
    const legsOut = (v: FeatureVector) => Object.fromEntries(Object.entries(v).filter(([k]) => !/thigh|shank|knee|ankle|hip\.|stance|height|extension|dir\.forearm/.test(k)));
    const test = createFaceTestStore({ source: () => scriptedBody(legsOut), claim: () => {}, now: () => clock, pollMs: 33, publishMs: 100 });
    expect(live.inView(BODY_SCRIPT.vectorAt(1000, 1))).toBe(true);
    expect(live.inView(legsOut(BODY_SCRIPT.vectorAt(1000, 1)))).toBe(false);
    test.getState().start(live);
    await run(200);
    expect(test.getState().noFace).toBe(true);
    test.getState().stop();
    expect(bodyModality.words.unseen).toMatch(/Cannot see you/);
  });

  it('draws a stick figure as an SVG', () => {
    const skeleton = bodyModality.skeleton!(BODY_SCRIPT.vectorAt(1000, 1))!;
    const svg = poseFigureSvg(skeleton);
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/<polyline/g) ?? []).length).toBe(8);
  });
});

describe('Your poses: the Que Calor dancer through the session store', () => {
  it("the dancer's still moments are carved, each with its figure, and the categorizer reads its own holds back", async () => {
    // The real clip (20 s at 30 fps, full body), as the live node wrote it. The dancer never
    // stands still for the setup, so the nuisance steps are skipped, as a player may.
    const clip = loadStream('video_body_que_calor', 'bodyVec.vector') as FeatureVector[];
    const fixture = (): FaceSource => {
      const start = clock;
      return { kind: 'live', read: () => ({ vector: clip[Math.min(clip.length - 1, Math.floor((clock - start) / (1000 / 30)))], t: clock }), video: () => null, dispose: () => {} };
    };
    const store = createFaceSessionStore(deps(fixture));
    store.getState().start();
    await run(3100);
    for (let i = 0; i < 3; i++) store.getState().skipSetup();
    await run(33);
    expect(store.getState().phase).toBe('faces');
    await run(clip.length * (1000 / 30) - 3200);
    await store.getState().stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().phase).toBe('carved');
    const c = store.getState().working!;
    const held = c.categories.flatMap((x) => x.members);
    expect(held.length).toBeGreaterThanOrEqual(3);
    expect(c.categories.length).toBeGreaterThanOrEqual(2);
    expect(c.samples.every((x) => x.skeleton !== undefined)).toBe(true);
    const model = { ...modelFromCategorizer(c), rejectRadius: Number.POSITIVE_INFINITY, neutral: undefined };
    const live = liveModel(c, {}, { modality: bodyModality });
    for (const cat of c.categories)
      for (const id of cat.members) {
        const v = c.samples.find((x) => x.id === id)!.vector;
        expect(live.inView(v)).toBe(true);
        expect(classify(model, v).categoryId).toBe(cat.id);
      }
  });
});
