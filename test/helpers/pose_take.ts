/**
 * A scripted "Your poses" take (#383, #384): the session store over the body modality, fed the
 * articulated poses of `./body_poses.ts` on a fake clock (the caller runs `vi.useFakeTimers()`
 * and {@link resetPoseClock}), carved at one category per pose. The rest, the three nuisance
 * steps held at rest, then each pose with the rest between, twice over.
 */
import { expect, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { memoryThumbStore, type FrameOpener } from '@thoremin/ext-faces/app/thumbnails';
import type { FaceSource } from '@thoremin/ext-faces/app/sources';
import { bodyModalityUi } from '@thoremin/ext-faces/app/bodyModality';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { POSES, poseVector, type PoseName, type PoseSpec } from './body_poses';

let clock = 0;

/** Start the fake clock over (call in `beforeEach`, after `vi.useFakeTimers()`). */
export function resetPoseClock(): void {
  clock = 1000;
}
const frames: FrameOpener = () => ({ grab: async () => new Blob(['x'], { type: 'image/jpeg' }), close: () => {} });
export const STREAM = {} as MediaStream;

export function deps(source: () => FaceSource): FaceSessionDeps {
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
export async function take(names: readonly PoseName[], opts: { legs?: boolean; vocabulary?: string } = {}) {
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
export function poseOf(v: FeatureVector, names: readonly PoseName[], legs = true): PoseName {
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
export function namesByPose(store: Awaited<ReturnType<typeof take>>, names: readonly PoseName[], legs = true) {
  const c = store.getState().working!;
  const byId = new Map(c.samples.map((x) => [x.id, x.vector]));
  return c.categories.map((cat) => {
    const poses = new Set(cat.members.map((id) => poseOf(byId.get(id)!, [...names, 'rest'], legs)));
    expect(poses.size).toBe(1);
    return { pose: [...poses][0], label: cat.label };
  });
}

