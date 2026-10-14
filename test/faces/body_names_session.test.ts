/**
 * Default pose names end to end (#383, body-movement B3): a scripted take of a vocabulary's poses
 * through "Your poses" (the session store over the body modality), carved, and named. The
 * acceptance: every category is named for the pose its holds were taken in, no name twice, and a
 * pose outside the vocabulary gets `pose n`. The vocabulary follows the context: standing by
 * default, seated when the take never saw the legs, conductor when asked for (the Conductor
 * tool's entry point), and its choice is kept on the file and by a re-cut.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/ext-faces/app/categorizers';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import type { FaceSource } from '@thoremin/ext-faces/app/sources';
import { bodyModalityUi } from '@thoremin/ext-faces/app/bodyModality';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { exportCategorizer, importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { POSES, poseVector, type PoseName, type PoseSpec } from '../helpers/body_poses';

let clock = 0;
const frames: FrameOpener = () => ({ grab: async () => new Blob(['x'], { type: 'image/jpeg' }), close: () => {} });
const STREAM = {} as MediaStream;

function deps(source: () => FaceSource): FaceSessionDeps {
  return {
    source,
    thumbs: memoryThumbStore(),
    frames,
    region: bodyModalityUi.region,
    figure: bodyModalityUi.figure,
    stillsByDefault: false,
    models: createCategorizerStore(bodyModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) }),
    modality: bodyModality,
    now: () => clock,
    pollMs: 33,
    claim: () => {},
    newTakeId: () => 'take-n',
    isoNow: () => '2026-10-14T00:00:00.000Z',
  };
}

const TIMELINE = { restMs: 3500, nuisanceMs: 4000, holdMs: 1300, glideMs: 250, passes: 2 } as const;

/** The take's script: the rest, the three nuisance steps (held at rest), then each pose in turn
 *  with the rest between, `passes` times. */
function script(poses: readonly PoseSpec[], legs = true) {
  const rest: PoseSpec = { ...POSES.rest, legs };
  const cycle = poses.flatMap((p) => [{ ...p, legs }, rest]);
  const T = TIMELINE;
  const setup = T.restMs + 3 * T.nuisanceMs;
  const at = (ms: number): { from: PoseSpec; to: PoseSpec; mix: number } => {
    if (ms < setup) return { from: rest, to: rest, mix: 1 };
    const span = T.holdMs + T.glideMs;
    const step = Math.floor((ms - setup) / span);
    const into = ms - setup - step * span;
    return { from: step === 0 ? rest : cycle[(step - 1) % cycle.length], to: cycle[step % cycle.length], mix: Math.min(1, into / T.glideMs) };
  };
  const vectorAt = (ms: number, frame: number): FeatureVector => {
    const p = at(ms);
    const a = poseVector(p.from, frame);
    const b = poseVector(p.to, frame);
    if (p.mix >= 1) return b;
    const out: FeatureVector = {};
    for (const k of Object.keys(b)) out[k] = Number.isFinite(a[k]) ? a[k] + (b[k] - a[k]) * p.mix : b[k];
    return out;
  };
  return { vectorAt, ms: setup + T.passes * cycle.length * (T.holdMs + T.glideMs) };
}

async function run(ms: number) {
  for (let t = 0; t < ms; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
}

/** Record a take of `poses` (names), carve it at one category per pose, return the store. */
async function take(names: readonly PoseName[], opts: { legs?: boolean; vocabulary?: string } = {}) {
  const s = script(
    names.map((n) => POSES[n]),
    opts.legs ?? true,
  );
  const start = clock;
  let frame = 0;
  const source = (): FaceSource => ({ kind: 'synthetic', read: () => ({ vector: s.vectorAt(clock - start, frame++), t: clock }), video: () => STREAM, dispose: () => {} });
  const store = createFaceSessionStore(deps(source));
  if (opts.vocabulary) store.getState().setVocabulary(opts.vocabulary);
  store.getState().start();
  await run(s.ms);
  await store.getState().stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(store.getState().phase).toBe('carved');
  if (store.getState().working!.categories.length !== names.length) store.getState().setK(names.length);
  return store;
}

/** The pose a sample was taken in: the nearest of the take's poses (degrees per 90, lengths as they are). */
function poseOf(v: FeatureVector, names: readonly PoseName[], legs = true): PoseName {
  const unit = (k: string) => (k.startsWith('body.dir.') || k.startsWith('body.angle.') ? 90 : 1);
  let best: { n: PoseName; d: number } | null = null;
  for (const n of names) {
    const p = poseVector({ ...POSES[n], legs });
    let d = 0;
    for (const [k, x] of Object.entries(v)) if (Number.isFinite(x) && Number.isFinite(p[k])) d += ((x - p[k]) / unit(k)) ** 2;
    if (!best || d < best.d) best = { n, d };
  }
  return best!.n;
}

/** Each category's label against the one pose all of its holds were taken in. */
function namesByPose(store: Awaited<ReturnType<typeof take>>, names: readonly PoseName[], legs = true) {
  const c = store.getState().working!;
  const byId = new Map(c.samples.map((x) => [x.id, x.vector]));
  return c.categories.map((cat) => {
    const poses = new Set(cat.members.map((id) => poseOf(byId.get(id)!, [...names, 'rest'], legs)));
    expect(poses.size).toBe(1);
    return { pose: [...poses][0], label: cat.label };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
});
afterEach(() => vi.useRealTimers());

const STANDING: readonly PoseName[] = ['arms up', 'left arm up', 'right arm up', 'arms out', 'hands together', 'lean left', 'lean right', 'crouch'];

describe('Your poses names its categories from the vocabulary of its context', () => {
  it('standing: every pose named for itself, never twice; the rest is Neutral', async () => {
    const store = await take(STANDING);
    const got = namesByPose(store, STANDING);
    for (const g of got) expect(g.label).toBe(g.pose);
    expect(new Set(got.map((g) => g.label)).size).toBe(STANDING.length);
    const c = store.getState().working!;
    expect(c.vocabulary).toBeUndefined();
    expect(c.neutral.length).toBeGreaterThan(0);
  }, 60_000);

  it('a pose outside the vocabulary gets `pose n`', async () => {
    const names: readonly PoseName[] = ['arms up', 'arms forward', 'crouch'];
    const store = await take(names);
    const got = namesByPose(store, names);
    expect(got.find((g) => g.pose === 'arms up')!.label).toBe('arms up');
    expect(got.find((g) => g.pose === 'crouch')!.label).toBe('crouch');
    expect(got.find((g) => g.pose === 'arms forward')!.label).toMatch(/^pose \d+$/);
  }, 60_000);

  it('seated (the legs never seen): the seated set, no crouch', async () => {
    const names: readonly PoseName[] = ['arms up', 'left arm up', 'arms out', 'hands together', 'lean right'];
    const store = await take(names, { legs: false });
    const c = store.getState().working!;
    expect(c.features.some((f) => /knee|thigh|shank/.test(f))).toBe(false);
    for (const g of namesByPose(store, names, false)) expect(g.label).toBe(g.pose);
  }, 60_000);

  it('conductor (asked for): ready, fermata, cut-off; kept on the file, by a re-cut and by an import', async () => {
    const names: readonly PoseName[] = ['ready', 'fermata', 'cut-off'];
    const store = await take(names, { vocabulary: 'conductor' });
    expect(store.getState().vocabulary).toBe('conductor');
    for (const g of namesByPose(store, names)) expect(g.label).toBe(g.pose);
    const c = store.getState().working!;
    expect(c.vocabulary).toBe('conductor');
    // A re-cut names its new categories from the same vocabulary.
    store.getState().setK(2);
    store.getState().setK(3);
    expect(store.getState().working!.categories.map((x) => x.label).sort()).toEqual(['cut-off', 'fermata', 'ready']);
    const back = importCategorizer(exportCategorizer(store.getState().working!));
    expect(back.ok && back.categorizer.vocabulary).toBe('conductor');
    // The choice was this take's: the next one starts from coverage again.
    store.getState().reset();
    expect(store.getState().vocabulary).toBeNull();
  }, 60_000);

  it('the vocabulary is chosen before the take, and a reset returns to the choice', async () => {
    const store = createFaceSessionStore(deps(() => ({ kind: 'synthetic', read: () => null, video: () => STREAM, dispose: () => {} })));
    expect(store.getState().vocabulary).toBeNull();
    store.getState().setVocabulary('conductor');
    expect(store.getState().vocabulary).toBe('conductor');
    store.getState().setVocabulary(null);
    expect(store.getState().vocabulary).toBeNull();
  });
});
