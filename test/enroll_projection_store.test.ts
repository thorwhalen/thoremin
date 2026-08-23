/**
 * The projection + labelling slice of the trainer store (#163 §7-§8): projecting the
 * built take, selecting points, and turning a selection into a category whose centroid
 * is computed in FULL feature space — the payoff, and the step it is easiest to get
 * wrong (a 2-D centroid would be meaningless to the classifier).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { categoryKey, classify, type FeatureVector } from '@/enroll';
import { useTrainer } from '@/app/enroll/store';
import { appFeatureDemand } from '@/app/featureDemand';

const prng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 2147483648 - 1;
};

/** Drive a take of three well-separated held head poses via the real store + runner. */
function threePoseTake() {
  const r = prng(7);
  const jit = () => 0.3 * r();
  const base = (): FeatureVector => ({ 'face.head.yaw': jit(), 'face.head.pitch': jit(), 'face.head.roll': jit() });
  useTrainer.getState().setRoutine(['rest', 'look-left', 'look-right', 'look-up', 'look-down', 'tilt-left', 'tilt-right']);
  useTrainer.getState().start(1000);
  let t = 1000;
  const feed = (n: number, make: () => FeatureVector) => {
    for (let i = 0; i < n; i++) {
      t += 33;
      useTrainer.getState().sample(make(), t);
    }
  };
  const holdThrough = (ms: number, make: () => FeatureVector) => {
    const end = t + ms;
    while (t < end) {
      t += 33;
      useTrainer.getState().sample(make(), t);
    }
  };
  feed(120, base); // rest
  let held = base;
  holdThrough(1700, () => held());
  const poses: FeatureVector[] = [
    { 'face.head.yaw': -25 },
    { 'face.head.yaw': 25 },
    { 'face.head.pitch': -25 },
    { 'face.head.pitch': 25 },
    { 'face.head.roll': 20 },
    { 'face.head.roll': -20 },
  ];
  for (const pose of poses) {
    const at = () => ({ ...base(), ...Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, v + jit()])) });
    feed(8, () => ({ ...base(), ...Object.fromEntries(Object.entries(pose).map(([k, v]) => [k, v * 0.5])) }));
    feed(25, at);
    held = at;
    holdThrough(1700, () => held());
  }
}

beforeEach(() => {
  useTrainer.getState().reset();
  appFeatureDemand.reset();
});

describe('projecting the take', () => {
  it('project() needs a build first, and lays out one point per still-point', () => {
    threePoseTake();
    expect(useTrainer.getState().status).toBe('done');
    useTrainer.getState().project();
    expect(useTrainer.getState().layout).toHaveLength(0); // not built yet
    useTrainer.getState().build();
    useTrainer.getState().project();
    const pts = useTrainer.getState().session().points();
    expect(useTrainer.getState().layout).toHaveLength(pts.length);
    // The live cursor is in the same embedding (two finite coordinates through the same
    // umap.transform); its ACCURACY on a real take is asserted in enroll_projection.test.
    const cursor = useTrainer.getState().cursorAt(pts[0].vector)!;
    expect(cursor).toHaveLength(2);
    expect(Number.isFinite(cursor[0]) && Number.isFinite(cursor[1])).toBe(true);
    // And null before a projection exists.
    useTrainer.getState().reset();
    expect(useTrainer.getState().cursorAt(pts[0].vector)).toBeNull();
  });
});

describe('select and label → categories in FULL feature space', () => {
  it('a labelled selection becomes a category whose centroid is the mean of the ORIGINAL vectors, and it classifies its own points', () => {
    threePoseTake();
    useTrainer.getState().build();
    useTrainer.getState().project();
    const pts = useTrainer.getState().session().points();
    // Group the points by which pose they are (yaw sign / pitch sign), from the RAW
    // vectors — this is what a player would circle in the picture.
    const idx = (pred: (v: FeatureVector) => boolean) => pts.map((p, i) => [p.vector, i] as const).filter(([v]) => pred(v)).map(([, i]) => i);
    const left = idx((v) => (v['face.head.yaw'] ?? 0) < -10);
    const right = idx((v) => (v['face.head.yaw'] ?? 0) > 10);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);

    useTrainer.getState().select(left);
    useTrainer.getState().labelSelection('to my left');
    useTrainer.getState().select(right);
    useTrainer.getState().labelSelection('to my right');

    const model = useTrainer.getState().model!;
    expect(model.categories).toHaveLength(2);
    // The centroid is the FULL-space mean of the selected raw vectors — NOT a 2-D point.
    const leftMeanYaw = left.reduce((s, i) => s + (pts[i].vector['face.head.yaw'] ?? 0), 0) / left.length;
    const leftCat = model.categories.find((c) => useTrainer.getState().labels[categoryKey(c)] === 'to my left')!;
    expect(leftCat.centroid['face.head.yaw']).toBeCloseTo(leftMeanYaw, 5);
    // A held-left vector classifies as the left category, not the right.
    const c = classify(model, { 'face.head.yaw': -25, 'face.head.pitch': 0, 'face.head.roll': 0 });
    expect(useTrainer.getState().labels[c.categoryId ? categoryKey(model.categories.find((x) => x.id === c.categoryId)!) : '']).toBe('to my left');
  });

  it('drawn and automatic categories do not fight: labelling switches to drawn (the k-slider is inert), reverting restores the cut', () => {
    threePoseTake();
    useTrainer.getState().build();
    expect(useTrainer.getState().categorySource).toBe('cut');
    const cutModel = useTrainer.getState().model!;
    const cutCount = cutModel.categories.length;
    // Draw a group: the model becomes the drawn one, and the k-slider no longer re-cuts.
    useTrainer.getState().select([0, 1]);
    useTrainer.getState().labelSelection('mine');
    expect(useTrainer.getState().categorySource).toBe('drawn');
    const drawn = useTrainer.getState().model!;
    expect(drawn.categories).toHaveLength(1);
    useTrainer.getState().setK(6);
    expect(useTrainer.getState().model).toBe(drawn); // slider did not overwrite the drawn model
    expect(useTrainer.getState().k).toBe(6); // but the intended k is remembered
    // Revert: back to the automatic cut at the remembered k, drawn groups gone.
    useTrainer.getState().useAutomaticCut();
    expect(useTrainer.getState().categorySource).toBe('cut');
    expect(useTrainer.getState().labelGroups).toEqual([]);
    expect(useTrainer.getState().model!.categories.length).toBeGreaterThanOrEqual(1);
    void cutCount;
  });

  it('removing the LAST drawn group falls back to the automatic cut, not a null model', () => {
    threePoseTake();
    useTrainer.getState().build();
    useTrainer.getState().select([0, 1]);
    useTrainer.getState().labelSelection('a');
    expect(useTrainer.getState().categorySource).toBe('drawn');
    useTrainer.getState().removeLabelGroup('a');
    expect(useTrainer.getState().categorySource).toBe('cut');
    expect(useTrainer.getState().model).not.toBeNull();
  });

  it('groups are a PARTITION: a point re-labelled leaves its old group; removing a group rebuilds the model', () => {
    threePoseTake();
    useTrainer.getState().build();
    const pts = useTrainer.getState().session().points();
    const first = [0, 1, 2];
    const overlap = [2, 3, 4];
    useTrainer.getState().select(first);
    useTrainer.getState().labelSelection('a');
    useTrainer.getState().select(overlap);
    useTrainer.getState().labelSelection('b');
    const groups = useTrainer.getState().labelGroups;
    const a = groups.find((g) => g.name === 'a')!;
    const b = groups.find((g) => g.name === 'b')!;
    // Point 2 moved from a to b; no point is in two groups.
    expect(a.members).not.toContain(2);
    expect(b.members).toContain(2);
    expect(a.members.filter((i) => b.members.includes(i))).toEqual([]);
    void pts;
    useTrainer.getState().removeLabelGroup('a');
    expect(useTrainer.getState().labelGroups.map((g) => g.name)).toEqual(['b']);
    expect(useTrainer.getState().model!.categories).toHaveLength(1);
    // Removing the last drawn group reverts to the automatic cut (a model, not null).
    useTrainer.getState().removeLabelGroup('b');
    expect(useTrainer.getState().categorySource).toBe('cut');
    expect(useTrainer.getState().model).not.toBeNull();
  });
});
