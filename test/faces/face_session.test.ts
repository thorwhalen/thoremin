/**
 * The face categorizer session's pure core (#330 P2, `@thoremin/ext-faces`): the take (rest,
 * then the player's faces), the carve in both modes, re-cutting k without recording again, the
 * names (the player's kept across a re-cut, `neutral` in partition mode, the general model's
 * one-to-one proposal), the exemplars, and the categorizer the save writes.
 *
 * Replayed from the REAL recording `video_head_pose` (the held smile at ~5.3 s), and from the
 * synthetic face the smoke drives (`?faces.source=synthetic`).
 */
import { describe, expect, it } from 'vitest';
import { BLENDSHAPE_NAME_BY_FEATURE } from '@thoremin/sdk/features/face_catalog';
import { categorizerFromModel, categorizerMode, classify, modelFromCategorizer, NO_REJECT_RADIUS, type FeatureVector } from '@thoremin/sdk/enroll';
import { createFaceTake, FACE_TAKE_DEFAULTS } from '@thoremin/ext-faces/lib/take';
import { carveView, carverFor, NEUTRAL_LABEL, withTypedName, type TypedName } from '@thoremin/ext-faces/lib/carving';
import { SYNTHETIC_EXPRESSIONS, SYNTHETIC_TIMELINE, syntheticExpressionAt, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import { loadStream } from '../helpers/fixtures';

/** Run the synthetic face through a take for `ms`, at 30 fps. */
function syntheticTake(ms = SYNTHETIC_TIMELINE.restMs + 6 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs) * 2) {
  const take = createFaceTake();
  take.start(0);
  for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push(syntheticFaceVector(t, f), t);
  expect(take.stop()).toBe(true);
  return take;
}

describe('the synthetic face', () => {
  it('speaks catalog blendshape ids, and every expression names real blendshapes', () => {
    const v = syntheticFaceVector(0, 0);
    expect(Object.keys(v).sort()).toEqual(Object.keys(BLENDSHAPE_NAME_BY_FEATURE).sort());
    const names = new Set(Object.values(BLENDSHAPE_NAME_BY_FEATURE));
    for (const e of SYNTHETIC_EXPRESSIONS) for (const n of Object.keys(e.blendshapes)) expect(names.has(n), `${e.name}: ${n}`).toBe(true);
    expect(syntheticExpressionAt(100).name).toBe('rest');
    expect(syntheticExpressionAt(SYNTHETIC_TIMELINE.restMs + 600).name).toBe('smile');
  });
});

describe('the take', () => {
  it('rests first, for at least restMs and minRestFrames face frames, then collects faces', () => {
    const take = createFaceTake();
    expect(take.phase()).toBe('idle');
    take.push(syntheticFaceVector(0, 0), 0); // ignored before start
    take.start(0);
    expect(take.phase()).toBe('rest');
    // Frames with no face do not count toward the rest.
    for (let f = 0; f < 200; f++) take.push({ 'hand.right.x': 0.5 }, f * 33);
    expect(take.phase()).toBe('rest');
    let f = 0;
    for (; f < FACE_TAKE_DEFAULTS.minRestFrames - 1; f++) take.push(syntheticFaceVector(0, f), 7000 + f * 33);
    expect(take.phase()).toBe('rest');
    take.push(syntheticFaceVector(0, f), 7000 + f * 33);
    expect(take.phase()).toBe('faces');
    expect(take.restVectors().length).toBe(FACE_TAKE_DEFAULTS.minRestFrames);
    // A repeated time is dropped.
    const before = take.facesStartedAt();
    take.push(syntheticFaceVector(0, f), 7000 + f * 33);
    expect(take.facesStartedAt()).toBe(before);
  });

  it('a take with no held face does not build', () => {
    const take = createFaceTake({ restMs: 0, minRestFrames: 5 });
    take.start(0);
    for (let f = 0; f < 10; f++) take.push(syntheticFaceVector(0, f), f * 33);
    expect(take.stop()).toBe(false);
    expect(take.phase()).toBe('done');
  });
});

describe('carving the synthetic take', () => {
  const take = syntheticTake();
  const session = take.session();
  const points = session.points();

  it('partition: k counts neutral, the resting category is called neutral, the rest named one-to-one', () => {
    const carver = carverFor(session, take.restVectors(), 'partition');
    expect(carver.neutral).toEqual([]);
    expect(carver.maxK()).toBe(points.length);
    const view = carveView({ session, restVectors: take.restVectors(), carver, k: 4 });
    expect(view.k).toBe(4);
    const labels = view.categories.map((c) => c.label.toLowerCase());
    expect(new Set(labels).size).toBe(4);
    expect(labels).toContain(NEUTRAL_LABEL);
    expect(view.categories.find((c) => c.label === NEUTRAL_LABEL)!.source).toBe('neutral');
    // The smile category is named "happy" by the general model.
    const smileAt = SYNTHETIC_TIMELINE.restMs + SYNTHETIC_TIMELINE.glideMs + SYNTHETIC_TIMELINE.holdMs / 2;
    const smileIdx = points.findIndex((p) => syntheticExpressionAt(p.t).name === 'smile');
    expect(smileIdx, `no held smile near ${smileAt}`).toBeGreaterThanOrEqual(0);
    const smileCat = view.categories.find((c) => view.model.categories.find((m) => m.id === c.id)!.members.includes(smileIdx))!;
    expect(smileCat.label).toBe('happy');
    expect(smileCat.source).toBe('matched');
    // Exemplars: the medoid first, a member of its category.
    for (const c of view.categories) {
      expect(c.exemplars.length).toBeGreaterThan(0);
      expect(c.exemplars[0].role).toBe('medoid');
      expect(view.model.categories.find((m) => m.id === c.id)!.members).toContain(c.exemplars[0].index);
    }
  });

  it('reject: the resting faces are set aside, k counts only the expressions, and they have their own row', () => {
    const carver = carverFor(session, take.restVectors(), 'reject');
    expect(carver.neutralKnown).toBe(true);
    expect(carver.neutral.length).toBeGreaterThan(0);
    for (const i of carver.neutral) expect(syntheticExpressionAt(points[i].t).name).toBe('rest');
    expect(carver.suggestedK()).toBe(3);
    const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
    expect(view.k).toBe(3);
    expect(view.categories.map((c) => c.label)).not.toContain(NEUTRAL_LABEL);
    for (const c of view.model.categories) for (const j of c.members) expect(carver.neutral).not.toContain(j);
    expect(view.neutral.count).toBe(carver.neutral.length);
    expect(view.neutral.exemplars.length).toBeGreaterThan(0);
    expect(view.model.rejectRadius).toBeLessThan(NO_REJECT_RADIUS);
  });

  it('re-cutting k keeps the names the player typed, even through a dip to a small k, and never proposes one twice', () => {
    const carver = carverFor(session, take.restVectors(), 'reject');
    const rest = take.restVectors();
    const at = (k: number, typed: TypedName[]) => carveView({ session, restVectors: rest, carver, k, typed });
    const v3 = at(3, []);
    const smile = v3.categories.find((c) => c.label === 'happy')!;
    // The player renames the smile "grin", and another category "happy" (taking the default).
    let typed = withTypedName([], v3, smile.id, 'grin')!;
    const named = at(3, typed);
    const other = named.categories.find((c) => c.label !== 'grin')!;
    typed = withTypedName(typed, named, other.id, 'happy')!;
    const same = at(3, typed);
    expect(same.categories.find((c) => c.label === 'grin')!.source).toBe('edited');
    expect(same.categories.filter((c) => c.label === 'happy')).toHaveLength(1);
    expect(same.categories.find((c) => c.label === 'happy')!.source).toBe('edited');
    // A third name, then down to k = 1 and back up: every typed name comes back.
    const third = same.categories.find((c) => c.source !== 'edited')!;
    typed = withTypedName(typed, same, third.id, 'wow')!;
    const one = at(1, typed);
    expect(one.categories).toHaveLength(1);
    const back = at(3, typed);
    expect(back.categories.map((c) => c.label).sort()).toEqual(['grin', 'happy', 'wow']);
    expect(back.categories.every((c) => c.source === 'edited')).toBe(true);
    // At a larger k the names survive, and no name is given twice.
    const labels = at(5, typed).categories.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(['grin', 'happy', 'wow']));
    expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(labels.length);
    // Two categories never share a typed name: refused.
    const grin = back.categories.find((c) => c.label === 'grin')!;
    const notGrin = back.categories.find((c) => c.id !== grin.id)!;
    expect(withTypedName(typed, back, notGrin.id, 'Grin')).toBeNull();
    // Renaming a category replaces its own typed name rather than adding one.
    expect(withTypedName(typed, back, grin.id, 'beam')!.map((t) => t.label).sort()).toEqual(['beam', 'happy', 'wow']);
  });

  it('reject mode: the saved model reads most of the neutral faces as none of these', () => {
    const carver = carverFor(session, take.restVectors(), 'reject');
    const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
    const back = modelFromCategorizer(categorizerFromModel(view.model, points, { name: 'n', mode: 'reject', modality: 'face' }));
    // None of these: by the taught Neutral class (#385 E5), or beyond the reject radius.
    const rejected = carver.neutral.filter((i) => classify(back, points[i].vector).categoryId === null).length;
    expect(rejected / carver.neutral.length).toBeGreaterThanOrEqual(0.8);
  });

  it('nothing carved when every held face is neutral: k is 0, and the grid says so rather than failing', () => {
    // Rest frames that span the whole take: every held face is inside the rest cloud.
    const wide = points.map((p) => p.vector);
    const carver = carverFor(session, wide, 'reject');
    expect(carver.carved).toEqual([]);
    expect(carver.suggestedK()).toBe(0);
    const view = carveView({ session, restVectors: wide, carver, k: 3 });
    expect(view.k).toBe(0);
    expect(view.categories).toEqual([]);
  });

  it('saves as a categorizer whose derived model classifies the same, in either mode', () => {
    for (const mode of ['partition', 'reject'] as const) {
      const carver = carverFor(session, take.restVectors(), mode);
      const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
      const saved = categorizerFromModel(view.model, points, { name: `mine ${mode}`, mode, modality: 'face' });
      expect(categorizerMode(saved)).toBe(mode);
      const back = modelFromCategorizer(saved);
      expect(back.categories.map((c) => c.label)).toEqual(view.model.categories.map((c) => c.label));
      if (mode === 'partition') expect(back.rejectRadius).toBe(NO_REJECT_RADIUS);
    }
  });
});

describe('carving the REAL recording (video_head_pose)', () => {
  interface PoseRecord {
    blendshapes: Record<string, number>;
  }
  const frames = loadStream('video_head_pose', 'face.pose') as PoseRecord[];
  const FPS = 29.3;
  const vecAt = (i: number): FeatureVector =>
    Object.fromEntries(Object.entries(BLENDSHAPE_NAME_BY_FEATURE).map(([id, name]) => [id, frames[i].blendshapes[name] ?? 0]));

  it('rest (7.7 to 8.5 s, replayed to fill the rest), then the faces: the held smile is "happy"', () => {
    const take = createFaceTake({ restMs: 0 });
    take.start(0);
    // The clip's rest is shorter than the take's minimum, so it is looped (the frames are real).
    const restFrames: number[] = [];
    for (let i = Math.round(7.7 * FPS); i <= Math.round(8.5 * FPS); i++) restFrames.push(i);
    let t = 0;
    while (take.phase() === 'rest') {
      take.push(vecAt(restFrames[Math.floor(t / 33) % restFrames.length]), t);
      t += 33;
    }
    for (let i = 0; i <= Math.round(10.5 * FPS) && i < frames.length; i++) take.push(vecAt(i), t + (i / FPS) * 1000);
    expect(take.stop()).toBe(true);
    const session = take.session();
    const carver = carverFor(session, take.restVectors(), 'partition');
    const view = carveView({ session, restVectors: take.restVectors(), carver, k: 3 });
    const smileIdx = session.points().findIndex((p) => Math.abs((p.t - t) / 1000 - 5.3) < 0.2);
    expect(smileIdx).toBeGreaterThanOrEqual(0);
    const cat = view.model.categories.find((c) => c.members.includes(smileIdx))!;
    expect(cat.label).toBe('happy');
  });
});
