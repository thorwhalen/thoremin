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
import { Engine, replayNode, StreamRecorder } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { pickCategories } from '@/nodes/output/canvas_overlay';
import { createCategoryDispatcher } from '@/app/enroll/categoryDispatch';
import type { SavedCategories } from '@/app/enroll/categoryBinding';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { CategoryScores } from '@thoremin/sdk/nodes/domain';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { posePlay, transportRolesOf, type PoseCategorizerPlay, type PoseTransport } from '@thoremin/ext-faces/lib/posePlay';
import { liveModel } from '@thoremin/ext-faces/lib/live';
import { poseCategorizerNode } from '@thoremin/ext-faces/nodes/pose_categorizer';
import { startPosePlay, usePosePlay, type PosePlayDeps } from '@thoremin/ext-faces/app/posePlay';
import { DEFAULT_POSE_CATEGORIZER, type PoseCategorizerDial } from '@thoremin/ext-faces/schema';
import type { FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { POSES, poseVector, type PoseName } from '../helpers/body_poses';
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

  it('with transport on: ready, fermata and cut-off state the conductor\'s predicates; the rest states all false', async () => {
    const out = await replay({ id: 'mine', transport: true });
    expect(ends(out).map((o) => o.transport)).toEqual([
      { ready: false, hold: false, cutoff: false },
      { ready: true, hold: false, cutoff: false },
      { ready: false, hold: false, cutoff: false },
      { ready: false, hold: true, cutoff: false },
      { ready: false, hold: false, cutoff: false },
      { ready: false, hold: false, cutoff: true },
      { ready: false, hold: false, cutoff: false },
    ]);
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
    expect(hidden[1].transportPose).toEqual({ ready: false, hold: false, cutoff: false });
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
  /** A record whose categorizer is of `modality` (the resolver reads nothing else of a refused one). */
  const record = (id: string, modality: string): FaceModelRecord => ({ id, name: id.toUpperCase(), createdAt: 0, model: { categorizer: { modality } } }) as unknown as FaceModelRecord;

  function harness(records: Record<string, FaceModelRecord>) {
    let dial: Partial<PoseCategorizerDial> = { ...DEFAULT_POSE_CATEGORIZER };
    const listeners = new Set<() => void>();
    const published: (PoseCategorizerPlay | null | 'some')[] = [];
    const deps: PosePlayDeps = {
      load: async (id) => records[id] ?? null,
      dial: () => dial,
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      onModelsChanged: () => () => {},
      publish: (p) => published.push(p === null ? null : 'some'),
    };
    return {
      deps,
      published,
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
    stop();
  });
});
