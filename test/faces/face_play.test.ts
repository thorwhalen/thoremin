/**
 * A saved personal categorizer drives the face chords (#330 P4), over the REAL recording
 * `video_face_expressions` (a resting face, a smile, then a smile with the mouth open): the
 * recording is carved into a categorizer through the tool's own take and carving, saved as P1's
 * file, resolved to play, and replayed frame by frame through the `face-categorizer` node and
 * the core `expression-chord` renderer. Plus the pure pieces: what each category stands in for,
 * the reading the renderer consumes, the general model passed through, and the per-category
 * degree a player chooses.
 */
import { describe, expect, it } from 'vitest';
import { replayNode } from '@thoremin/dag';
import { categorizerFromModel, trainModel, type FeatureVector, type PersonalCategorizer } from '@thoremin/sdk/enroll';
import { buildFaceCtx } from '@thoremin/sdk/features/catalog';
import { BLENDSHAPE_NAME_BY_FEATURE, FACE_FEATURES } from '@thoremin/sdk/features/face_catalog';
import { ABSENT_EXPRESSION, DEFAULT_EXPRESSION_TO_DEGREE, EMOTIONS, type ExpressionScores } from '@thoremin/sdk/music/expression';
import { diatonicTriad, type ScaleSpec } from '@thoremin/sdk/music/theory';
import type { FaceFrame } from '@thoremin/sdk/nodes/domain';
import { createFaceTake, FACE_REST_CUE, FACE_VOCABULARY_CUE } from '@thoremin/ext-faces/lib/take';
import { carveView, carverFor } from '@thoremin/ext-faces/lib/carving';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import { categorizerPlay, neutralCategoryIndex, standsForOf, toExpressionScores } from '@thoremin/ext-faces/lib/play';
import { faceCategorizerNode } from '@thoremin/ext-faces/nodes/face_categorizer';
import { AUTO_DEGREE, CATEGORY_SLOTS, DEFAULT_FACE_CATEGORIZER, ownDegrees, type FaceCategorizerDial } from '@thoremin/ext-faces/schema';
import { expressionChordNode } from '@/nodes/music/expression_chord';
import { matrixToHeadPose } from '@/nodes';
import { loadStream } from '../helpers/fixtures';

const FPS = 30;
/** The floor of a feature's jitter at rest (a blendshape that does not move at rest). */
const MIN_JITTER = 0.01;
const cMajor: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };

/** The recording's frames as the webcam source emits them: mesh, head pose, blendshapes. */
function recordedFrames(): FaceFrame[] {
  const marks = loadStream('video_face_expressions', 'face.landmarks') as (FaceFrame & { transformMatrix?: number[] })[];
  const shapes = loadStream('video_face_expressions', 'face.blendshapes') as { present: boolean; blendshapes: Record<string, number> }[];
  return marks.map(({ transformMatrix, ...f }, i) => ({
    ...f,
    blendshapes: shapes[i]?.blendshapes ?? {},
    ...(transformMatrix ? { headPose: matrixToHeadPose(transformMatrix) } : {}),
  }));
}

/** Every face catalog feature of a frame: what the trainer's tap (`faceVec.vector`) records. */
function vectorOf(frame: FaceFrame): FeatureVector {
  const out: FeatureVector = {};
  if (!frame.present) return out;
  const ctx = buildFaceCtx(frame);
  for (const f of FACE_FEATURES) {
    const v = f.compute(ctx);
    if (Number.isFinite(v)) out[f.id] = v;
  }
  return out;
}

/** The recording's segments (frame ranges): its resting face, a smile, a smile with the mouth open. */
const SEGMENTS = { rest: [0, 12], smile: [20, 60], open: [66, 96] } as const;

/**
 * The recording saved as P1's categorizer file, in reject mode: the resting frames unclaimed
 * (they are "none of these"), the smile and the open smile one category each, over the
 * blendshape features, each weighted by the inverse of its jitter at rest (noise units, as a
 * session weighs them). Carving the take is the tool's business, tested on its own
 * (`face_session.test.ts`); a recording this short has too few held faces for the still-point
 * sampler, so the categories are its segments.
 */
function recordedCategorizer(frames: readonly FaceFrame[]): PersonalCategorizer {
  const features = Object.keys(BLENDSHAPE_NAME_BY_FEATURE);
  const range = ([a, b]: readonly [number, number]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const samples = [
    ...range(SEGMENTS.rest).map((i) => ({ vector: vectorOf(frames[i]), t: (i * 1000) / FPS, cue: FACE_REST_CUE.id })),
    ...[...range(SEGMENTS.smile), ...range(SEGMENTS.open)].map((i) => ({ vector: vectorOf(frames[i]), t: (i * 1000) / FPS, cue: FACE_VOCABULARY_CUE.id })),
  ];
  const rest = samples.filter((x) => x.cue === FACE_REST_CUE.id).map((x) => x.vector);
  const weights = Object.fromEntries(
    features.map((f) => {
      const d = rest.slice(1).map((v, i) => (v[f] ?? 0) - (rest[i][f] ?? 0));
      const sd = Math.sqrt(d.reduce((a, x) => a + x * x, 0) / Math.max(1, d.length));
      return [f, 1 / Math.max(sd, MIN_JITTER)];
    }),
  );
  const nRest = range(SEGMENTS.rest).length;
  const nSmile = range(SEGMENTS.smile).length;
  const clusters = [range([nRest, nRest + nSmile - 1]), range([nRest + nSmile, samples.length - 1])];
  const model = trainModel(samples.map((x) => x.vector), clusters, features, weights, { restVectors: rest });
  return categorizerFromModel(model, samples, { name: 'recorded', mode: 'reject', modality: 'face' });
}

const dial = (id: string, degrees: Partial<Record<string, number>> = {}): FaceCategorizerDial => ({
  id,
  degrees: { ...DEFAULT_FACE_CATEGORIZER.degrees, ...degrees } as FaceCategorizerDial['degrees'],
});

/** The categorizer node then the chord renderer, frame by frame. */
async function playThrough(frames: readonly FaceFrame[], model: ReturnType<typeof categorizerPlay> | null, config: FaceCategorizerDial, general?: ExpressionScores[]) {
  const node = faceCategorizerNode.make(faceCategorizerNode.params.parse({}));
  const read = await replayNode(node, {
    face: [...frames],
    model: frames.map(() => model),
    config: frames.map(() => config),
    ...(general ? { general } : {}),
  }, { dt: 1 / FPS });
  const chord = expressionChordNode.make(expressionChordNode.params.parse({}));
  const played = await replayNode(chord, {
    expression: read.map((r) => r.expression),
    categoryDegrees: read.map((r) => r.degrees),
    spec: frames.map(() => cMajor),
    faceMapping: frames.map(() => 'chord'),
    degrees: frames.map(() => DEFAULT_EXPRESSION_TO_DEGREE),
  }, { dt: 1 / FPS });
  return { read: read.map((r) => r.expression as ExpressionScores), triads: played.map((p) => p.triad as number[]) };
}

/** The most frequent value of `xs` (ties: the first seen). */
const mode = <T>(xs: readonly T[]): T => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

describe('a saved personal categorizer drives the face chords (the recorded faces)', () => {
  const frames = recordedFrames();
  const categorizer = recordedCategorizer(frames);
  const play = categorizerPlay({ id: 'mine', name: 'Mine', categorizer });
  // Well inside the smile and the open smile (the tracker needs a few frames to settle).
  const SMILE = [SEGMENTS.smile[0] + 8, SEGMENTS.smile[1] - 4] as const;
  const OPEN = [SEGMENTS.open[0] + 8, SEGMENTS.open[1] - 2] as const;
  const within = <T>(xs: readonly T[], [a, b]: readonly [number, number]) => xs.slice(a, b + 1);

  it('carves the smile and the open smile apart, and each plays its own chord', async () => {
    expect(categorizer.categories).toHaveLength(2);
    const { read, triads } = await playThrough(frames, play, dial('mine'));
    const smile = mode(within(read, SMILE).map((r) => r.personal?.id ?? null));
    const open = mode(within(read, OPEN).map((r) => r.personal?.id ?? null));
    expect(smile).not.toBeNull();
    expect(open).not.toBeNull();
    expect(smile).not.toBe(open);
    const smileChord = mode(within(triads, SMILE).map((t) => t.join(',')));
    const openChord = mode(within(triads, OPEN).map((t) => t.join(',')));
    expect(smileChord).not.toBe('');
    expect(openChord).not.toBe('');
    expect(smileChord).not.toBe(openChord);
    // Every reading carries the player's categories, by id and name.
    expect(read[SMILE[0]].personal?.ids).toEqual(categorizer.categories.map((c) => c.id));
  });

  it('the resting face is none of these, and plays silence (what neutral plays)', async () => {
    const { read, triads } = await playThrough(frames, play, dial('mine'));
    for (let i = 0; i <= 10; i++) {
      expect(read[i].personal?.id ?? null).toBeNull();
      expect(triads[i]).toEqual([]);
    }
  });

  it('by default, the smile plays the chord of the expression it stands in for', async () => {
    const { read, triads } = await playThrough(frames, play, dial('mine'));
    const smileId = mode(within(read, SMILE).map((r) => r.personal?.id ?? null))!;
    const label = play.standsFor[play.live.model.categories.findIndex((c) => c.id === smileId)];
    expect(label).toBe('happy'); // the general model's one-to-one match for a smile
    expect(mode(within(triads, SMILE).map((t) => t.join(',')))).toBe(diatonicTriad(cMajor, DEFAULT_EXPRESSION_TO_DEGREE.happy).join(','));
  });

  it('a degree the player chose for a category is the chord it plays', async () => {
    const first = await playThrough(frames, play, dial('mine'));
    const smileId = mode(within(first.read, SMILE).map((r) => r.personal?.id ?? null))!;
    expect(CATEGORY_SLOTS).toContain(smileId);
    const { triads } = await playThrough(frames, play, dial('mine', { [smileId]: 4 }));
    expect(mode(within(triads, SMILE).map((t) => t.join(',')))).toBe(diatonicTriad(cMajor, 4).join(','));
    const silenced = await playThrough(frames, play, dial('mine', { [smileId]: -1 }));
    expect(within(silenced.triads, SMILE).filter((t) => t.length > 0).length).toBeLessThan(3);
  });

  it('plays the general model until the personal one is there, and whenever the dial names another', async () => {
    const general = frames.map((_, i): ExpressionScores => ({ ...ABSENT_EXPRESSION, present: true, label: i % 2 ? 'sad' : 'happy' }));
    const none = await playThrough(frames, null, dial('mine'), general);
    expect(none.read).toEqual(general);
    const stale = await playThrough(frames, play, dial('someone-else'), general);
    expect(stale.read).toEqual(general);
  });
});

/** A categorizer carved from the synthetic face (rest, smile, surprise, frown), in `mode`. */
function syntheticCategorizer(mode: 'reject' | 'partition'): PersonalCategorizer {
  const take = createFaceTake();
  take.start(0);
  const ms = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
  for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push(syntheticFaceVector(t, f), t);
  expect(take.stop()).toBe(true);
  const session = take.session();
  const carver = carverFor(session, take.restVectors(), mode);
  const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
  return categorizerFromModel(view.model, session.points(), { name: `synthetic ${mode}`, mode, modality: 'face' });
}

describe('what each category stands in for', () => {
  it('partition mode: the resting category stands in for neutral, the others for distinct expressions', () => {
    const c = syntheticCategorizer('partition');
    const neutral = neutralCategoryIndex(c);
    expect(neutral).toBeGreaterThanOrEqual(0);
    const stands = standsForOf(c);
    expect(stands[neutral]).toBe('neutral');
    const others = stands.filter((_, i) => i !== neutral);
    expect(new Set(others).size).toBe(others.length);
    for (const s of others) expect(EMOTIONS).toContain(s);
  });

  it('a renamed resting category is the player\'s face like any other (they can silence it)', () => {
    const c = syntheticCategorizer('partition');
    const i = neutralCategoryIndex(c);
    const renamed: PersonalCategorizer = { ...c, categories: c.categories.map((cat, j) => (j === i ? { ...cat, label: 'calm' } : cat)) };
    expect(neutralCategoryIndex(renamed)).toBe(-1);
    expect(standsForOf(renamed)).not.toContain('neutral');
  });

  it('reject mode: no category is neutral; every category stands in for a different expression', () => {
    const c = syntheticCategorizer('reject');
    expect(neutralCategoryIndex(c)).toBe(-1);
    const stands = standsForOf(c);
    expect(new Set(stands).size).toBe(stands.length);
    expect(stands).not.toContain('neutral');
  });

  it('a category the general model does not know takes an expression no other took', () => {
    const c = syntheticCategorizer('reject');
    // Every centroid the same blank face: nothing matches, so the spare expressions go in order.
    const blank: PersonalCategorizer = { ...c, samples: c.samples.map((s) => ({ ...s, vector: Object.fromEntries(Object.keys(s.vector).map((k) => [k, 0])) })) };
    expect(standsForOf(blank)).toEqual(EMOTIONS.slice(0, c.categories.length));
  });
});

describe('the reading the renderer consumes', () => {
  const c = syntheticCategorizer('reject');
  const play = categorizerPlay({ id: 'x', name: 'X', categorizer: c });
  const ids = play.live.model.categories.map((cat) => cat.id);

  it('a settled category: its stand-in label, its memberships, the player\'s names', () => {
    const r = toExpressionScores(play, { categoryId: ids[0], memberships: { [ids[0]]: 0.8 } });
    expect(r.label).toBe(play.standsFor[0]);
    expect(r.scores[0]).toBe(0.8);
    expect(r.fired[0]).toBe(true);
    expect(r.personal).toMatchObject({ id: ids[0], name: play.live.model.categories[0].label, ids });
  });

  it('none of these: neutral, no category', () => {
    const r = toExpressionScores(play, { categoryId: null, memberships: {} });
    expect(r.label).toBe('neutral');
    expect(r.personal?.id).toBeNull();
    expect(r.fired.every((f) => !f)).toBe(true);
  });

  it('the dial\'s Auto slots are not degrees: only a player\'s choice reaches the renderer', () => {
    expect(ownDegrees(DEFAULT_FACE_CATEGORIZER)).toEqual({});
    expect(ownDegrees(dial('x', { 'cat-2': 3, 'cat-3': -1, 'cat-4': AUTO_DEGREE }))).toEqual({ 'cat-2': 3, 'cat-3': -1 });
  });
});
