/**
 * Explore, pause and the live bars of the face session (#385 E2):
 *
 * - **Pause is a cue segment.** Replayed on the synthetic face: a take paused in the middle of a
 *   held face and resumed during a later one has no still-point inside the pause and none
 *   spanning it (the hold in progress at Pause is dropped with its sampler; the one in progress
 *   at Resume starts over). Each segment is its own vocabulary cue, pooled by the session.
 * - **Explore** reads the camera (claims the features) and collects nothing; Space, through the
 *   host's `carve.capture.toggle` command and the capture seam the store provides, starts
 *   capturing, pauses and resumes; the seam is withdrawn and the claim released when it ends.
 * - **The bars on the real recording** (`video_head_pose`, the production face features with
 *   the head pose from its matrix): exploring, they show what moved (the chin-up pitch);
 *   capturing, they show the features that separate the categories carved so far.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProvider } from '@zodal/store';
import type { FeatureVector } from '@thoremin/sdk/enroll';
import { buildFaceCtx } from '@thoremin/sdk/features/catalog';
import { FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import { matrixToHeadPose } from '@thoremin/sdk/nodes/domain';
import { carveCapture, provideCarveCapture } from '@thoremin/sdk-ui/enroll/capture';
import { createFaceTake, segmentCue } from '@thoremin/ext-faces/lib/take';
import { faceModality } from '@thoremin/sdk/features/modalities/face';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import { createFaceSessionStore, type FaceSessionDeps } from '@thoremin/ext-faces/app/sessionStore';
import { createFaceModelStore, type FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { syntheticSource, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { registry } from '@/app/commands/registry';
import { toggleCarveCapture } from '@/app/enroll/carveCapture';
import { loadStream } from '../helpers/fixtures';
import { FACES } from '../helpers/extensions';

const DWELL_MS = 220;
const FRAME_MS = 1000 / 30;

describe('pause is a cue segment (the synthetic face)', () => {
  /** The synthetic face through a take, paused over [pauseAt, resumeAt) when given. */
  function take(pause?: { at: number; resume: number }) {
    const t = createFaceTake();
    t.start(0);
    const holdsWhilePaused: string[] = [];
    let pointsAtPause = -1;
    const end = SYNTHETIC_TIMELINE.restMs + 8 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
    for (let f = 0, ms = 0; ms <= end; f++, ms = f * FRAME_MS) {
      if (pause && ms >= pause.at && t.phase() === 'faces' && pointsAtPause < 0) {
        pointsAtPause = t.pointCount();
        t.pause(ms);
      }
      if (pause && ms >= pause.resume && t.phase() === 'paused') t.resume(ms);
      t.push(syntheticFaceVector(ms, f), ms);
      if (t.phase() === 'paused') holdsWhilePaused.push(t.hold());
    }
    expect(t.stop()).toBe(true);
    return { take: t, points: t.session().points(), pointsAtPause, holdsWhilePaused };
  }

  // The smile is held from 3.75 s (after the opening rest and its glide); a hold is taken after
  // 220 ms of stillness. Pause at 3.9 s is inside that hold, before it is taken; resume at 7.0 s
  // is inside the surprise held from 6.85 s.
  const PAUSE = { at: 3900, resume: 7000 };

  it('without a pause, that smile is taken (the control)', () => {
    const { points } = take();
    expect(points.some((p) => p.t >= 3700 && p.t < 4100)).toBe(true);
    expect(new Set(points.map((p) => p.cue))).toEqual(new Set([segmentCue(faceModality, 1).id]));
  });

  it('no still-point inside the pause, and none spanning it', () => {
    const { points, pointsAtPause, holdsWhilePaused, take: t } = take(PAUSE);
    expect(pointsAtPause).toBeGreaterThanOrEqual(0);
    const before = points.slice(0, pointsAtPause);
    const after = points.slice(pointsAtPause);
    // Before: every hold was complete (its dwell over) before Pause.
    for (const p of before) expect(p.t + DWELL_MS).toBeLessThanOrEqual(PAUSE.at);
    // After: every hold began after Resume; the surprise held across Resume is taken from Resume.
    expect(after.length).toBeGreaterThan(0);
    for (const p of after) expect(p.t).toBeGreaterThanOrEqual(PAUSE.resume);
    expect(after[0].t - PAUSE.resume).toBeLessThan(400);
    // The smile held at Pause is not taken at all.
    expect(points.some((p) => p.t >= 3700 && p.t < 4100)).toBe(false);
    // Two segments, pooled.
    expect(t.segments()).toBe(2);
    expect(new Set(after.map((p) => p.cue))).toEqual(new Set([segmentCue(faceModality, 2).id]));
    expect(segmentCue(faceModality, 2).id).toBe('faces-yours#2');
    // Paused, the ring still runs: holds are seen (not taken).
    expect(holdsWhilePaused).toContain('settling');
    expect(holdsWhilePaused).toContain('taken');
  });

  it('a face taken before the pause and held across it (a blink in between) is not taken again', () => {
    const t = createFaceTake();
    t.start(0);
    const blink = (v: FeatureVector): FeatureVector => ({ ...v, 'face.blendshape.eye.blinkLeft': 0.9, 'face.blendshape.eye.blinkRight': 0.9 });
    // The smile is taken at about 4.07 s and held to 5.05 s: pause at 4.3 s, blink at 4.5 s,
    // resume at 4.8 s still smiling.
    for (let f = 0, ms = 0; ms <= 9000; f++, ms = f * FRAME_MS) {
      if (ms >= 4300 && t.phase() === 'faces' && t.segments() === 1) t.pause(ms);
      if (ms >= 4800 && t.phase() === 'paused') t.resume(ms);
      const v = syntheticFaceVector(ms, f);
      t.push(ms >= 4500 && ms < 4600 ? blink(v) : v, ms);
    }
    const points = t.session().points();
    const smiles = points.filter((p) => p.t >= 3700 && p.t < 5100);
    expect(smiles).toHaveLength(1);
    expect(smiles[0].cue).toBe('faces-yours');
    // The segment does take the next face (the relaxed face after the smile).
    expect(points.some((p) => p.cue === 'faces-yours#2')).toBe(true);
  });

  it('the ring says latched, not taken, when the capture begins on a face already held', () => {
    const t = createFaceTake();
    t.start(0);
    let first: string | null = null;
    for (let f = 0, ms = 0; ms <= 4000 && first === null; f++, ms = f * FRAME_MS) {
      t.push(syntheticFaceVector(ms, f), ms);
      if (t.phase() === 'faces') first = t.hold();
    }
    expect(t.pointCount()).toBe(0);
    expect(first).toBe('latched');
  });

  it('exploring first changes nothing in the capture: the noise units start at the rest', () => {
    const frames = (offset: number, t: ReturnType<typeof createFaceTake>) => {
      for (let f = 0, ms = 0; ms <= 12_000; f++, ms = f * FRAME_MS) t.push(syntheticFaceVector(ms, f), offset + ms);
    };
    const plain = createFaceTake();
    plain.start(0);
    frames(0, plain);
    const explored = createFaceTake();
    explored.explore(0);
    // Six seconds of trying faces, the face changing every frame (smile, surprise, ...): the
    // frame-to-frame differences a noise warm-up must never be fed. Then the same capture.
    for (let f = 0, ms = 0; ms < 6000; f++, ms = f * FRAME_MS) explored.push(syntheticFaceVector(f % 2 ? 4500 : 7500, f), ms);
    explored.start(6000);
    frames(6001, explored);
    const a = plain.session().points();
    const b = explored.session().points();
    expect(b.length).toBe(a.length);
    b.forEach((p, i) => expect(p.t - 6001).toBeCloseTo(a[i].t, 6));
  });

  it('exploring collects nothing, and the ring runs', () => {
    const t = createFaceTake();
    t.explore(0);
    const holds = new Set<string>();
    for (let f = 0, ms = 0; ms <= 9000; f++, ms = f * FRAME_MS) {
      t.push(syntheticFaceVector(ms, f), ms);
      holds.add(t.hold());
    }
    expect(t.phase()).toBe('explore');
    expect(t.pointCount()).toBe(0);
    for (const h of ['open', 'settling', 'taken']) expect(holds).toContain(h);
    t.start(9100);
    expect(t.phase()).toBe('rest');
    // Exploring then stopping builds nothing.
    const u = createFaceTake();
    u.explore(0);
    expect(u.stop()).toBe(false);
  });
});

// ---- the store, the seam and the command ----------------------------------------------------

let clock = 0;
const claims: boolean[] = [];

function deps(over: Partial<FaceSessionDeps> = {}): FaceSessionDeps {
  return {
    source: () => ({ ...syntheticSource(() => clock), video: () => null }),
    thumbs: memoryThumbStore(),
    frames: () => null,
    models: createFaceModelStore(createInMemoryProvider<FaceModelRecord>([], { idField: 'id', searchFields: ['name'] })),
    now: () => clock,
    pollMs: 33,
    claim: (on) => claims.push(on),
    capture: provideCarveCapture,
    newTakeId: () => 'take-e2',
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

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  claims.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('Explore, Space and pause in the store', () => {
  // The carve commands are the faces extension's (#600 S11): absent when core runs alone.
  it.runIf(FACES)('explores with the claim held and nothing recorded; the command starts, pauses and resumes; the seam goes with the take', async () => {
    const store = createFaceSessionStore(deps());
    const s = () => store.getState();
    expect(carveCapture()).toBeNull();
    expect(toggleCarveCapture()).toBe(false); // Space is the browser's: nothing is live

    s().explore();
    expect(s().phase).toBe('explore');
    expect(claims).toEqual([true]);
    expect(carveCapture()?.state()).toBe('explore');
    await run(2000);
    expect(s().points).toBe(0);
    expect(s().live()).not.toBeNull();

    // Space (the command, through the seam): Explore starts capturing, the same claim kept.
    expect(toggleCarveCapture()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().phase).toBe('rest');
    expect(claims).toEqual([true]);
    // During the rest the command refuses; Space is still the carve's (swallowed, nothing done).
    expect((await registry.dispatch('carve.capture.toggle', {})).ok).toBe(false);
    expect(toggleCarveCapture()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().phase).toBe('rest');
    await run(SYNTHETIC_TIMELINE.restMs + 300);
    expect(s().phase).toBe('faces');
    await run(4 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs));
    const taken = s().points;
    expect(taken).toBeGreaterThan(0);

    const paused = await registry.dispatch('carve.capture.toggle', {});
    expect(paused.ok && paused.value).toMatchObject({ what: 'faces', from: 'capturing', to: 'paused' });
    expect(s().phase).toBe('paused');
    // A held auto-repeat is swallowed, not dispatched.
    expect(toggleCarveCapture({ repeat: true })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().phase).toBe('paused');
    await run(3 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs));
    expect(s().points).toBe(taken);
    expect(s().live()).not.toBeNull();

    expect(toggleCarveCapture()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s().phase).toBe('faces');
    await run(4 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs));
    expect(s().points).toBeGreaterThan(taken);

    await s().stop();
    expect(s().phase).toBe('carved');
    expect(claims).toEqual([true, false]);
    expect(carveCapture()).toBeNull();
    expect(s().live()).toBeNull();
    // The resumed segment's holds are in the carve, under their own cue.
    const file = JSON.parse(s().exportFile('E2')!.text) as { samples: { cue: string }[] };
    expect(new Set(file.samples.map((x) => x.cue))).toEqual(new Set(['faces-yours', 'faces-yours#2']));
  });

  it('closing Explore (Cancel, or the tool) releases the claim and withdraws the seam', async () => {
    const store = createFaceSessionStore(deps());
    store.getState().explore();
    await run(500);
    expect(carveCapture()).not.toBeNull();
    store.getState().cancelRecording();
    expect(store.getState().phase).toBe('idle');
    expect(claims).toEqual([true, false]);
    expect(carveCapture()).toBeNull();
    // A store that is not live never withdraws another's control.
    const other = { what: 'x', state: () => 'explore' as const, toggle: () => undefined, beginBurst: () => false, endBurst: () => false };
    const withdraw = provideCarveCapture(other);
    store.getState().reset();
    expect(carveCapture()).toBe(other);
    withdraw();
  });
});

// ---- the bars on the real recording ---------------------------------------------------------

describe('the bars on the real recording (video_head_pose)', () => {
  interface PoseRecord {
    present: boolean;
    blendshapes: Record<string, number>;
    transformMatrix: number[];
  }
  const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
  const FPS = 29.3;
  const clipMs = (frames.length / FPS) * 1000;
  /** The live face vector the app computes for frame `i` (no landmarks in the fixture). */
  const vecAt = (i: number): FeatureVector => {
    const r = frames[Math.max(0, Math.min(frames.length - 1, i))];
    const ctx = buildFaceCtx({ present: r.present, blendshapes: r.blendshapes, headPose: matrixToHeadPose(r.transformMatrix) } as Parameters<typeof buildFaceCtx>[0]);
    const v: FeatureVector = {};
    for (const f of FACE_FEATURES) {
      const x = f.compute(ctx);
      if (Number.isFinite(x)) v[f.id] = x;
    }
    return v;
  };
  const REST = [Math.round(7.7 * FPS), Math.round(8.5 * FPS)];
  const REST_MS = 3300;
  /** Exploring: the clip, looped. Capturing: its rest (7.7 to 8.5 s) looped for 3.3 s, then the
   *  clip from the start to 10.5 s (chin up, chin down, left, the smile, right, the frown, rest). */
  const fixtureSource = (kind: 'explore' | 'capture'): FaceSource => {
    const start = clock;
    return {
      kind: 'synthetic',
      read: () => {
        const ms = clock - start;
        if (kind === 'explore') return { vector: vecAt(Math.floor(((ms % clipMs) / 1000) * FPS)), t: clock };
        if (ms < REST_MS) return { vector: vecAt(REST[0] + (Math.floor(ms / 33) % (REST[1] - REST[0] + 1))), t: clock };
        return { vector: vecAt(Math.floor(((ms - REST_MS) / 1000) * FPS)), t: clock };
      },
      video: () => null,
      dispose: () => undefined,
    };
  };

  it('exploring: what moved (the chin up is pitch); capturing: what separates the faces so far', async () => {
    let made = 0;
    const store = createFaceSessionStore(deps({ source: () => fixtureSource(made++ === 0 ? 'explore' : 'capture') }));
    const s = () => store.getState();
    s().explore();
    // One pass to warm the noise estimate, then to the chin up (1.0 s into the second pass).
    await run(clipMs + 1000);
    const exploring = s().live()!;
    expect(exploring.reference).toBe('running');
    expect(exploring.ranking).toBe('movement');
    expect(exploring.bars.map((b) => b.id)).toContain('face.head.pitch');

    s().start();
    await run(REST_MS + 10_500);
    expect(s().phase).toBe('faces');
    expect(s().points).toBeGreaterThanOrEqual(4);
    const capturing = s().live()!;
    expect(capturing.reference).toBe('rest');
    expect(capturing.ranking).toBe('separation');
    expect(capturing.categories).toBeGreaterThanOrEqual(2);
    // The open-mouthed smile is what stands apart: the jaw and the mouth separate it, by tens of
    // noise units between the categories' ticks; the omitted head position never shows.
    const [top] = capturing.bars;
    expect(top.id).toMatch(/jaw|mouth|lip/i);
    const ticks = top.ticks.filter((x): x is number => x !== null);
    expect(Math.max(...ticks) - Math.min(...ticks)).toBeGreaterThan(20);
    for (const b of capturing.bars) expect(['face.head.x', 'face.head.y', 'face.head.scale', 'face.head.distanceProxy']).not.toContain(b.id);
    for (const b of capturing.bars) expect(b.band).not.toBeNull();
    await s().stop();
  });
});
