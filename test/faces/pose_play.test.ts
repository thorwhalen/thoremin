/**
 * A saved pose categorizer plays in the instrument (#384, body-movement B4). The acceptance: an
 * instrument with a saved body categorizer composes the node, draws the category and dispatches a
 * bound command on entry in a headless replay (the dispatcher of #160, unchanged), and its
 * `ready` / `fermata` / `cut-off` poses state the body conductor's transport (A5's seam), only
 * while the dial says so.
 *
 * The categorizer is a real one: a scripted take of the conductor's poses through "Your poses"
 * (`../helpers/pose_take.ts`), named by #383's conductor vocabulary.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ok, type Result } from 'acture';
import { defineNode, Engine, replayNode, StreamRecorder } from '@thoremin/dag';
import { z } from 'zod';
import { createTransport } from '@thoremin/ictus';
import { createFeatureDemand } from '@thoremin/sdk/features/demand';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { pickCategories } from '@/nodes/output/canvas_overlay';
import { createCategoryDispatcher } from '@/app/enroll/categoryDispatch';
import type { SavedCategories } from '@/app/enroll/categoryBinding';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { EMPTY_BODY_FRAME, type CategoryScores } from '@thoremin/sdk/nodes/domain';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { posePlay, transportRolesOf, type PoseCategorizerPlay, type PoseTransport } from '@thoremin/ext-faces/lib/posePlay';
import { liveModel } from '@thoremin/sdk/enroll/live';
import { poseCategorizerNode } from '@thoremin/ext-faces/nodes/pose_categorizer';
import { startPosePlay, usePosePlay, POSE_PLAY_DEMAND_OWNER, type PosePlayDeps } from '@thoremin/ext-faces/app/posePlay';
import { DEFAULT_POSE_CATEGORIZER, type PoseCategorizerDial } from '@thoremin/ext-faces/schema';
import type { FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { POSES, poseFrame, poseVector, scriptedPoseCategorizer, type PoseName } from '../helpers/body_poses';
import { resetPoseClock, take } from '../helpers/pose_take';
import { FACES } from '../helpers/extensions';

const seed = () => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Glass Bells')!.layer);
const withPoses = (id: string, transport = false) => ({ ...seed(), poseCategorizer: { ...DEFAULT_POSE_CATEGORIZER, id, transport } });
const into = (spec: { edges: readonly { from: { node: string; port: string }; to: { node: string; port: string } }[] }, node: string, port: string) =>
  spec.edges.filter((e) => e.to.node === node && e.to.port === port).map((e) => `${e.from.node}.${e.from.port}`);

describe.runIf(FACES)('the poseCategorizer dial composes the pose branch', () => {
  it('nothing by default; a saved id composes the node on the body vector, drawn on the overlay', () => {
    expect(branchIdsFor(seed())).not.toContain('pose-categorizer');
    const ids = branchIdsFor(withPoses('mine'));
    expect(ids).toContain('pose-categorizer');
    const composed = composeInstrumentGraph(ids, {}, createAppRegistry());
    expect(composed.branches).toEqual(expect.arrayContaining(['pose-categorizer', 'body-source']));
    expect(into(composed.spec, 'poseCat', 'vector')).toEqual(['bodyVec.vector']);
    expect(into(composed.spec, 'poseCat', 'model')).toEqual(['ui.poseCategorizerModel']);
    expect(into(composed.spec, 'overlay', 'learnedCategories')).toEqual(['poseCat.category']);
    expect(composed.elements).toEqual(expect.arrayContaining(['categoryLabel', 'categoryBars']));
    // No conductor composed: the transport edge is dropped, not an error.
    expect(into(composed.spec, 'conductor', 'transportPose')).toEqual([]);
  });

  it('with the conductor composed, the pose node feeds its transportPose (the structural guard)', () => {
    const s = { ...withPoses('mine', true), conductor: { ...(seed().conductor as object), enabled: true, source: 'body' } };
    const composed = composeInstrumentGraph(branchIdsFor(s as never), {}, createAppRegistry());
    expect(composed.branches).toContain('conductor');
    expect(into(composed.spec, 'conductor', 'transportPose')).toEqual(['poseCat.transportPose']);
  });

  it('the composed graph compiles and ticks against the real registry, its ports validated', () => {
    const registry = createAppRegistry();
    const recorder = new StreamRecorder({ only: ['poseCat.category'] });
    const engine = new Engine(composeInstrumentGraph(branchIdsFor(withPoses('mine')), undefined, registry).spec, registry, { taps: [recorder], validatePorts: true });
    for (let i = 0; i < 20; i++) engine.tick();
    expect(recorder.values('poseCat.category')).toHaveLength(20);
    engine.dispose();
  });
});

/** The script the replay plays: each pose for `frames` camera frames. */
const SCRIPT: readonly (readonly [PoseName, number])[] = [
  ['rest', 20],
  ['ready', 20],
  ['rest', 20],
  ['fermata', 20],
  ['rest', 20],
  ['cut-off', 20],
  ['rest', 20],
];
const frames = (): { pose: PoseName; vector: FeatureVector }[] => {
  let f = 0;
  return SCRIPT.flatMap(([pose, n]) => Array.from({ length: n }, () => ({ pose, vector: poseVector(POSES[pose], 10_000 + f++) })));
};

describe.runIf(FACES)('a saved conducting categorizer, replayed through the node', () => {
  let categorizer: PersonalCategorizer;
  let play: PoseCategorizerPlay;

  beforeAll(async () => {
    vi.useFakeTimers();
    resetPoseClock();
    const store = await take(['ready', 'fermata', 'cut-off'], { vocabulary: 'conductor' });
    categorizer = store.getState().working!;
    vi.useRealTimers();
    play = posePlay({ id: 'mine', name: 'Conducting', categorizer });
  }, 60_000);
  afterEach(() => vi.useRealTimers());

  const replay = async (config: Partial<PoseCategorizerDial>, model: PoseCategorizerPlay | null = play) => {
    const script = frames();
    const node = poseCategorizerNode.make(poseCategorizerNode.params.parse({}));
    const out = await replayNode(node, { vector: script.map((s) => s.vector), model: script.map(() => model), config: script.map(() => config) }, { dt: 1 / 30 });
    return script.map((s, i) => ({ pose: s.pose, category: out[i].category as CategoryScores, transport: out[i].transportPose as PoseTransport | undefined }));
  };

  /** The value at the END of each scripted segment (the hysteresis has settled by then). */
  const ends = <T>(xs: readonly T[]): T[] => {
    let i = -1;
    return SCRIPT.map(([, n]) => xs[(i += n)]);
  };

  it('the categorizer is the conductor vocabulary, its roles by name', () => {
    expect(categorizer.categories.map((c) => c.label).sort()).toEqual(['cut-off', 'fermata', 'ready']);
    const roles = transportRolesOf(categorizer);
    const name = (id?: string) => categorizer.categories.find((c) => c.id === id)?.label;
    expect([name(roles.ready), name(roles.hold), name(roles.cutoff)]).toEqual(['ready', 'fermata', 'cut-off']);
  });

  it('draws each pose as its category (the overlay picks the learned reading), the rest as none', async () => {
    const out = await replay({ id: 'mine' });
    expect(ends(out).map((o) => o.category.label)).toEqual([null, 'ready', null, 'fermata', null, 'cut-off', null]);
    for (const o of out) expect(o.category.present).toBe(true);
    const drawn = pickCategories(undefined, undefined, ends(out)[1].category);
    expect(drawn.categories?.label).toBe('ready');
    expect(drawn.categories?.title).toBe('Conducting');
    // The ASL reader, while it reads, keeps the cues.
    const asl: CategoryScores = { present: true, label: 'A', labels: ['A'], scores: [1] };
    expect(pickCategories(asl, ['C'], ends(out)[1].category)).toEqual({ categories: asl, categoryCaptions: ['C'] });
    // Transport off: the conductor's rules decide.
    for (const o of out) expect(o.transport).toBeUndefined();
  });

  it('with transport on: the held ready, fermata or cut-off states its role true; the rest states nothing (the rules decide)', async () => {
    const out = await replay({ id: 'mine', transport: true });
    expect(ends(out).map((o) => o.transport)).toEqual([undefined, { ready: true }, undefined, { hold: true }, undefined, { cutoff: true }, undefined]);
    // Never a stated false: A5 reads one as a veto (ready: false disarms a prepared start).
    for (const o of out) for (const v of Object.values(o.transport ?? {})) expect(v).toBe(true);
  });

  it("through A5's transport: the ready pose arms it, the upbeat leaves the pose, and the downbeat starts the piece", async () => {
    const out = await replay({ id: 'mine', transport: true });
    // The player's arm, as the conductor measures it: raised (not by the rule's geometry: the
    // pose says ready), still while posed, then the upbeat (moving) and a downbeat anchor.
    const t = createTransport({ raisedAbove: 0.99 });
    const readyEnd = SCRIPT[0][1] + SCRIPT[1][1];
    let started = false;
    for (let i = 0; i < readyEnd + 10; i++) {
      const upbeat = i >= readyEnd;
      const step = t.step({ t: i / 30, raise: 0.6, motion: upbeat ? 20 : 2, anchor: i === readyEnd + 8 ? i / 30 : undefined, pose: upbeat ? out[SCRIPT[0][1] + SCRIPT[1][1] + 2].transport : out[i].transport });
      if (step.started) started = true;
    }
    expect(started).toBe(true);
    // Without the pose, the same arm never arms (it is not raised by the rule's measure).
    const rules = createTransport({ raisedAbove: 0.99 });
    let ruled = false;
    for (let i = 0; i < readyEnd + 10; i++) if (rules.step({ t: i / 30, raise: 0.6, motion: i >= readyEnd ? 20 : 2, anchor: i === readyEnd + 8 ? i / 30 : undefined }).started) ruled = true;
    expect(ruled).toBe(false);
  });

  it('a role no category is named for stays unstated (its rule keeps it)', () => {
    const renamed = { ...categorizer, categories: categorizer.categories.map((c) => (c.label === 'fermata' ? { ...c, label: 'arms high' } : c)) };
    const p = posePlay({ id: 'mine', name: 'x', categorizer: renamed });
    expect(Object.keys(p.roles).sort()).toEqual(['cutoff', 'ready']);
  });

  it('only the model the dial names plays; out of view reads absent', async () => {
    const wrong = await replay({ id: 'other', transport: true });
    for (const o of wrong) {
      expect(o.category.present).toBe(false);
      expect(o.transport).toBeUndefined();
    }
    const node = poseCategorizerNode.make(poseCategorizerNode.params.parse({}));
    const hidden = await replayNode(node, { vector: [{}, {}], model: [play, play], config: [{ id: 'mine', transport: true }, { id: 'mine', transport: true }] }, { dt: 1 / 30 });
    expect((hidden[1].category as CategoryScores).present).toBe(false);
    // Out of view states nothing: A5's stop when the player leaves needs the cut-off unstated.
    expect(hidden[1].transportPose).toBeUndefined();
  });

  it('in a graph with the Lab hidden, the node sees the body only through the pose-play claim', async () => {
    // The scripted body as a camera (one pose frame per tick), and the host's transient and dial
    // as the store-controls node gives them.
    const script = frames();
    /** Engine ticks per camera frame: the webcam source hands out its cached frame (the same
     *  object) until the next video frame (#492). */
    let ticksPerFrame = 1;
    /** Camera frames with nobody in them (a frame object each, as the webcam source gives). */
    let gone: (n: number) => boolean = () => false;
    let shown: { n: number; frame: ReturnType<typeof poseFrame> } | null = null;
    const frameAt = (tick: number) => {
      const n = Math.min(Math.floor(tick / ticksPerFrame), script.length - 1);
      if (shown?.n !== n) shown = { n, frame: gone(n) ? { ...EMPTY_BODY_FRAME } : poseFrame(POSES[script[n].pose], 20_000 + n) };
      return shown.frame;
    };
    const camera = defineNode({
      type: 'test-pose-camera',
      roles: ['source'],
      inputs: [],
      outputs: [
        { name: 'body', kind: 'body-frame' },
        { name: 'model', kind: 'pose-categorizer-model' },
        { name: 'config', kind: 'pose-categorizer-config' },
      ],
      params: z.object({}),
      make: () => ({
        process: (_in, ctx) => ({
          body: frameAt(ctx.tick),
          model: play,
          config: { id: 'mine', transport: true },
        }),
      }),
    });
    const reg = createAppRegistry().register(camera);
    const spec = {
      nodes: [
        { id: 'b', type: 'test-pose-camera', params: {} },
        { id: 'bodyVec', type: 'body-feature-vector', params: {} },
        { id: 'poseCat', type: 'pose-categorizer', params: {} },
      ],
      edges: [
        { from: { node: 'b', port: 'body' }, to: { node: 'bodyVec', port: 'body' } },
        { from: { node: 'bodyVec', port: 'vector' }, to: { node: 'poseCat', port: 'vector' } },
        { from: { node: 'b', port: 'model' }, to: { node: 'poseCat', port: 'model' } },
        { from: { node: 'b', port: 'config' }, to: { node: 'poseCat', port: 'config' } },
      ],
    };
    const controls = { featureLab: { show: false, groups: [] as string[] } };
    const demand = createFeatureDemand();
    const run = (groups: () => ReturnType<typeof demand.groups>) => {
      const engine = new Engine(spec, reg, { resources: { controls: () => controls, featureDemand: groups } });
      shown = null;
      const out: { label: string | null; present: boolean }[] = [];
      // One reading per camera frame, at the frame's last tick; every tick of a frame must read
      // the same (a reading per tick would differ from one tick to the next).
      for (let i = 0; i < script.length * ticksPerFrame; i++) {
        engine.tick(i / (30 * ticksPerFrame));
        const c = engine.getOutput('poseCat', 'category') as CategoryScores;
        const reading = { label: c.label, present: c.present };
        if (i % ticksPerFrame > 0) expect(reading).toEqual(out.at(-1));
        else out.push(reading);
      }
      engine.dispose();
      return out;
    };
    // The host's claim, as startPosePlay makes it while the dial names a categorizer.
    const stop = startPosePlay({
      load: async () => ({ id: 'mine', name: 'Conducting', createdAt: 0, model: { categorizer } }) as FaceModelRecord,
      dial: () => ({ id: 'mine', transport: true }),
      subscribe: () => () => {},
      onModelsChanged: () => () => {},
      publish: () => {},
      claim: (on) => (on ? demand.claim(POSE_PLAY_DEMAND_OWNER, bodyModality.groups) : demand.release(POSE_PLAY_DEMAND_OWNER)),
    });
    const claimed = run(() => demand.groups());
    expect(ends(claimed).map((o) => o.label)).toEqual([null, 'ready', null, 'fermata', null, 'cut-off', null]);
    // The engine ticking twice per camera frame reads the same, frame by frame (#492): the vector
    // node keeps its vector for a frame it has seen, so the hysteresis counts camera frames.
    ticksPerFrame = 2;
    expect(run(() => demand.groups())).toEqual(claimed);
    // And through a stretch out of view in the middle of a pose (a new empty vector every tick).
    gone = (n) => n >= SCRIPT[0][1] + 4 && n < SCRIPT[0][1] + 10;
    const lost = run(() => demand.groups());
    expect(lost.some((o) => !o.present)).toBe(true);
    ticksPerFrame = 1;
    expect(run(() => demand.groups())).toEqual(lost);
    gone = () => false;
    stop();
    expect(demand.groups() ?? []).toEqual([]);
    // Without the claim the vector is empty: nobody is seen (the failure the claim exists for).
    const silent = run(() => demand.groups());
    for (const o of silent) expect(o.present).toBe(false);
  });

  it('a bound command dispatches on entry through the existing dispatcher, from the same replay', async () => {
    const { model } = liveModel(categorizer, {}, { modality: bodyModality });
    const ready = model.categories.find((c) => c.label === 'ready')!;
    const set: SavedCategories = { id: 's', name: 'Conducting', createdAt: 0, categories: { model, bindings: { [ready.id]: { command: 'conductor.toggle' } }, read: { modality: 'body' } } };
    let vector: FeatureVector | null = null;
    const dispatched: string[] = [];
    const d = createCategoryDispatcher({
      getActive: () => set,
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
    let t = 0;
    for (const f of frames()) {
      vector = f.vector;
      d.tick((t += 33));
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatched).toEqual(['conductor.toggle']);
  });
});

describe('the host resolves the pose dial off the tick', () => {
  it('A plays, the dial goes to B (still loading) and back to A: the state says A plays, published once', async () => {
    const real = ({ id: 'A', name: 'A', createdAt: 0, model: { categorizer: scriptedPoseCategorizer(['ready', 'fermata']) } }) as FaceModelRecord;
    let dial: Partial<PoseCategorizerDial> = { id: 'A' };
    const listeners = new Set<() => void>();
    let releaseB: (() => void) | null = null;
    const published: unknown[] = [];
    const stop = startPosePlay({
      load: (id) => (id === 'B' ? new Promise((r) => (releaseB = () => r(null))) : Promise.resolve(real)),
      dial: () => dial,
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      onModelsChanged: () => () => {},
      publish: (p) => published.push(p),
      claim: () => {},
    });
    const set = (id: string) => {
      dial = { id };
      for (const l of listeners) l();
    };
    await settle();
    expect(usePosePlay.getState()).toMatchObject({ phase: 'ready', id: 'A' });
    set('B');
    set('A');
    await settle();
    releaseB!();
    await settle();
    expect(usePosePlay.getState()).toMatchObject({ phase: 'ready', id: 'A', name: 'A' });
    expect(published.filter((p) => p !== null)).toHaveLength(1);
    stop();
  });

  it('a binding edit on the playing record does not republish it (the reading is not reset, #371)', async () => {
    let rec = ({ id: 'A', name: 'A', createdAt: 0, model: { categorizer: scriptedPoseCategorizer(['ready', 'fermata']) } }) as FaceModelRecord;
    let changed: (() => void) | null = null;
    const published: unknown[] = [];
    const stop = startPosePlay({
      load: async () => rec,
      dial: () => ({ id: 'A' }),
      subscribe: () => () => {},
      onModelsChanged: (l) => ((changed = l), () => {}),
      publish: (p) => published.push(p),
      claim: () => {},
    });
    await settle();
    expect(published.filter((p) => p !== null)).toHaveLength(1);
    rec = { ...rec, model: { ...rec.model, bindings: { 'cat-1': { command: 'transport.toggle' } } } };
    changed!();
    await settle();
    expect(published.filter((p) => p !== null)).toHaveLength(1);
    stop();
  });

  /** A record whose categorizer is of `modality` (the resolver reads nothing else of a refused one). */
  const record = (id: string, modality: string): FaceModelRecord => ({ id, name: id.toUpperCase(), createdAt: 0, model: { categorizer: { modality } } }) as unknown as FaceModelRecord;

  function harness(records: Record<string, FaceModelRecord>) {
    let dial: Partial<PoseCategorizerDial> = { ...DEFAULT_POSE_CATEGORIZER };
    const listeners = new Set<() => void>();
    const published: (PoseCategorizerPlay | null | 'some')[] = [];
    const claims: boolean[] = [];
    const deps: PosePlayDeps = {
      load: async (id) => records[id] ?? null,
      dial: () => dial,
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      onModelsChanged: () => () => {},
      publish: (p) => published.push(p === null ? null : 'some'),
      claim: (on) => claims.push(on),
    };
    return {
      deps,
      published,
      claims,
      set(id: string) {
        dial = { ...dial, id };
        for (const l of listeners) l();
      },
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('none by default; a face categorizer named by mistake, or a missing one, plays nothing', async () => {
    const h = harness({ face: record('face', 'face') });
    const stop = startPosePlay(h.deps);
    await settle();
    expect(usePosePlay.getState().phase).toBe('none');
    h.set('face');
    await settle();
    expect(usePosePlay.getState().phase).toBe('missing');
    h.set('gone');
    await settle();
    expect(usePosePlay.getState().phase).toBe('missing');
    expect(h.published.every((p) => p === null)).toBe(true);
    // The pose groups are claimed while the dial names one, released with none and on stop.
    expect(h.claims).toEqual([false, true, true]);
    stop();
    expect(h.claims.at(-1)).toBe(false);
  });
});
