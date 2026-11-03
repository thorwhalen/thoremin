/**
 * Dynamic gestures, phase 4 (#754): the SDK half of the Gestures section and of a gesture
 * binding, on scripted gestures of the articulated synthetic hand (`helpers/wave_take.ts`).
 *
 * - each gesture states the shape it was recorded with (length, invariances), and is matched and
 *   judged with it, so a retune of `MATCHER_DEFAULTS` never changes a saved gesture;
 * - the Gestures section's verbs (record more, rename, delete, drop a trace, merge);
 * - a gesture's command binding survives a save (`rekeyBindings` carries gesture ids by name);
 * - the export writes one row per line;
 * - the live listener fires a bound gesture once per repetition.
 */
import { describe, it, expect } from 'vitest';
import { FEATURE_BY_ID } from '@thoremin/sdk/features/catalog';
import {
  addGestureTraces,
  buildGestureModel,
  createGestureListener,
  createMotionSegmenter,
  deleteGesture,
  dropGestureTrace,
  gestureModelFromCategorizer,
  gestureQuality,
  gestureSpace,
  MATCHER_DEFAULTS,
  matchSegment,
  mergeGestures,
  RECORDED_SHAPE,
  renameGesture,
  type GestureEdit,
} from '@thoremin/sdk/enroll/gestures';
import { CATEGORIZER_FORMAT, CATEGORIZER_VERSION, exportCategorizer, importCategorizer, PersonalCategorizerSchema, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { rekeyBindings } from '@thoremin/sdk/enroll/bind';
import { createNoiseEstimator, scaleWeights, type NoiseEstimator } from '@thoremin/sdk/enroll/noise';
import { rowJson } from '@thoremin/sdk/util/json';
import type { Trace } from '@thoremin/sdk/enroll/types';
import { GESTURE_PATHS, waveTake, type WaveScript, type WaveTake } from './helpers/wave_take';

const POSITION = Object.keys(FEATURE_BY_ID).filter((id) => id.startsWith('hand.right.') && FEATURE_BY_ID[id].group === 'hand.position.raw');
const takeOf = (path: keyof typeof GESTURE_PATHS, script: Partial<WaveScript> = {}) => waveTake({ path: GESTURE_PATHS[path], ...script });

function cutTraces(gesture: string, take: WaveTake, cue = `${gesture}-5`): { traces: Trace[]; noise: NoiseEstimator } {
  const noise = createNoiseEstimator();
  const seg = createMotionSegmenter({ gesture, cue, features: POSITION, noise });
  for (const f of take.frames) {
    seg.push(f.v, f.t);
    if (!seg.inRun()) noise.push(f.v, f.t);
  }
  return { traces: seg.traces(), noise };
}

const WAVE = cutTraces('wave', takeOf('wave'));
const CIRCLE = cutTraces('circle', takeOf('circle'));
const WEIGHTS = scaleWeights(WAVE.noise.snapshot());
const OPTS = { features: POSITION, weights: WEIGHTS };

const BASE: PersonalCategorizer = PersonalCategorizerSchema.parse({
  format: CATEGORIZER_FORMAT,
  version: CATEGORIZER_VERSION,
  name: 'hands',
  modality: 'hand',
  features: ['a', 'b'],
  weights: { a: 1, b: 1 },
  strangers: 'nearest',
  samples: [
    { id: 't:0', vector: { a: 0, b: 0 }, t: 0, cue: 'c' },
    { id: 't:1', vector: { a: 1, b: 1 }, t: 1, cue: 'c' },
  ],
  categories: [
    { id: 'cat-1', label: 'open', members: ['t:0'] },
    { id: 'cat-2', label: 'wave', members: ['t:1'] },
  ],
  neutral: [],
});

const ok = (r: GestureEdit): PersonalCategorizer => {
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
};
const WITH = ok(addGestureTraces(ok(addGestureTraces(BASE, WAVE.traces, OPTS)), CIRCLE.traces, OPTS));

describe('a gesture keeps the shape it was recorded with', () => {
  it('a gesture written now states the matcher defaults; one saved before states none and reads the defaults of the day', () => {
    const g = WITH.gestures!.items[0];
    expect({ length: g.length, position: g.position, scale: g.scale }).toEqual(RECORDED_SHAPE);
    expect(RECORDED_SHAPE.length).toBe(MATCHER_DEFAULTS.length);
    const { length: _l, position: _p, scale: _s, ...older } = g;
    void [_l, _p, _s];
    const before = { ...WITH, gestures: { ...WITH.gestures!, items: [older, WITH.gestures!.items[1]] } };
    expect(gestureSpace(before).shapes).toEqual({ 'gesture-2': RECORDED_SHAPE });
    expect(importCategorizer(exportCategorizer(before)).ok).toBe(true);
  });

  it('a stated length is the one a template is made in, whatever the defaults say', () => {
    const short = { ...WITH, gestures: { ...WITH.gestures!, items: WITH.gestures!.items.map((g, i) => (i === 0 ? { ...g, length: 16 } : g)) } };
    const model = gestureModelFromCategorizer(short);
    expect(model.gestures[0].templates[0].rows).toHaveLength(16);
    expect(model.gestures[1].templates[0].rows).toHaveLength(MATCHER_DEFAULTS.length);
    // A model asked for another default length leaves the stated ones as they are.
    expect(buildGestureModel([...WAVE.traces, ...CIRCLE.traces], { ...OPTS, length: 24, shapes: { wave: { length: 16 } } }).gestures.map((g) => g.templates[0].rows.length)).toEqual([16, 24]);
    // A fresh wave is still the wave, compared in the wave's own series.
    const fresh = cutTraces('x', takeOf('wave', { seed: 7 })).traces[0];
    expect(matchSegment(model, fresh.samples).gesture).toBe('gesture-1');
    // The quality judges each gesture in its own series too: the wave's repetitions agree as they
    // do at 16 rows, the circle's as at the default length.
    const agreement = (traces: Trace[], o: object, g: string) => gestureQuality(traces, { ...OPTS, ...o }).gestures.find((x) => x.gesture === g)!.agreement!;
    const both = [...WAVE.traces, ...CIRCLE.traces];
    const shaped = { shapes: { wave: { length: 16 } } };
    expect(agreement(both, shaped, 'wave')).toBeCloseTo(agreement(WAVE.traces, { length: 16 }, 'wave'), 12);
    expect(agreement(both, shaped, 'wave')).not.toBeCloseTo(agreement(WAVE.traces, {}, 'wave'), 6);
    expect(agreement(both, shaped, 'circle')).toBeCloseTo(agreement(CIRCLE.traces, {}, 'circle'), 12);
  });

  it('refuses a stated length that is no series', () => {
    expect(() => buildGestureModel(WAVE.traces, { ...OPTS, shapes: { wave: { length: 1 } } })).toThrow(/gesture "wave": length/);
  });
});

describe('the Gestures section: its verbs', () => {
  it('a take makes a new gesture with a fresh id clear of the categories, its features and weights', () => {
    const items = WITH.gestures!.items;
    expect(items.map((g) => [g.id, g.label, g.traces.length])).toEqual([
      ['gesture-1', 'wave', 5],
      ['gesture-2', 'circle', 5],
    ]);
    expect(items[0].features).toEqual(POSITION);
    for (const f of POSITION) expect(WITH.gestures!.weights[f]).toBe(WEIGHTS[f]);
  });

  it('record more: the traces join the gesture by id, re-projected, ids kept unique, the section weights kept', () => {
    const again = cutTraces('wave', takeOf('wave', { seed: 2, waves: 2 })).traces;
    const other = Object.fromEntries(Object.keys(WEIGHTS).map((f) => [f, WEIGHTS[f] * 3]));
    const c = ok(addGestureTraces(WITH, again, { ...OPTS, weights: other, into: 'gesture-1' }));
    const g = c.gestures!.items[0];
    expect(g.traces).toHaveLength(7);
    // The same cue id twice: the repeats are suffixed, never duplicated.
    expect(new Set(g.traces.map((t) => t.id)).size).toBe(7);
    expect(g.traces[5].id).toBe('wave-5#1~2');
    // A later take never re-scales what was recorded before.
    expect(c.gestures!.weights).toEqual(WITH.gestures!.weights);
    // By name too, ignoring case.
    expect(ok(addGestureTraces(WITH, again.map((t) => ({ ...t, gesture: 'WAVE' })), OPTS)).gestures!.items[0].traces).toHaveLength(7);
    expect(addGestureTraces(WITH, again, { ...OPTS, into: 'gesture-9' })).toMatchObject({ ok: false });
    expect(addGestureTraces(WITH, [], OPTS)).toMatchObject({ ok: false, error: 'no repetition was cut from the take' });
  });

  it('rename, refusing an empty name or another gesture\'s', () => {
    expect(ok(renameGesture(WITH, 'gesture-1', ' hello ')).gestures!.items[0].label).toBe('hello');
    expect(renameGesture(WITH, 'gesture-1', 'Circle')).toMatchObject({ ok: false });
    expect(renameGesture(WITH, 'gesture-1', '  ')).toMatchObject({ ok: false });
    // A held category may share a gesture's name: they are bound apart.
    expect(ok(renameGesture(WITH, 'gesture-2', 'open')).gestures!.items[1].label).toBe('open');
  });

  it('delete: the gesture and its traces, the section with its last one', () => {
    const one = ok(deleteGesture(WITH, 'gesture-1'));
    expect(one.gestures!.items.map((g) => g.id)).toEqual(['gesture-2']);
    expect(ok(deleteGesture(one, 'gesture-2')).gestures).toBeUndefined();
  });

  it('drop a trace, never the only one', () => {
    const c = ok(dropGestureTrace(WITH, 'gesture-1', 'wave-5#3'));
    expect(c.gestures!.items[0].traces.map((t) => t.id)).toEqual(['wave-5#1', 'wave-5#2', 'wave-5#4', 'wave-5#5']);
    let single = WITH;
    for (const id of ['wave-5#1', 'wave-5#2', 'wave-5#3', 'wave-5#4']) single = ok(dropGestureTrace(single, 'gesture-1', id));
    expect(dropGestureTrace(single, 'gesture-1', 'wave-5#5')).toMatchObject({ ok: false });
    expect(dropGestureTrace(WITH, 'gesture-1', 'nope')).toMatchObject({ ok: false });
  });

  it('merge pools the traces under the target, re-projected onto its features', () => {
    const narrow = { ...WITH, gestures: { ...WITH.gestures!, items: WITH.gestures!.items.map((g, i) => (i === 0 ? { ...g, features: POSITION.slice(0, 2), traces: g.traces.map((t) => ({ ...t, rows: t.rows.map((r) => r.slice(0, 2)) })) } : g)) } };
    const c = ok(mergeGestures(narrow, 'gesture-2', 'gesture-1'));
    expect(c.gestures!.items).toHaveLength(1);
    const g = c.gestures!.items[0];
    expect(g.traces).toHaveLength(10);
    for (const t of g.traces) for (const row of t.rows) expect(row).toHaveLength(2);
    // The weights of features no gesture lists any more go.
    expect(Object.keys(c.gestures!.weights).sort()).toEqual(POSITION.slice(0, 2).sort());
    expect(mergeGestures(WITH, 'gesture-1', 'gesture-1')).toMatchObject({ ok: false });
  });
});

describe('a gesture binding across a save (rekeyBindings)', () => {
  const targets = (c: PersonalCategorizer) => ({ categories: c.categories, gestures: c.gestures?.items ?? [] });
  const bindings = { 'cat-1': { command: 'a' }, 'gesture-1': { command: 'wave.cmd' }, 'gesture-2': { command: 'circle.cmd' } };

  it('kept by id and name, and carried by name when the id changes', () => {
    expect(rekeyBindings(targets(WITH), bindings, targets(WITH))).toEqual(bindings);
    // The wave deleted and recorded again: the smallest free id, and its binding found by name.
    const again = ok(addGestureTraces(ok(deleteGesture(WITH, 'gesture-1')), WAVE.traces, OPTS));
    expect(again.gestures!.items.map((g) => [g.id, g.label])).toEqual([
      ['gesture-2', 'circle'],
      ['gesture-1', 'wave'],
    ]);
    expect(rekeyBindings(targets(WITH), bindings, targets(again))).toEqual(bindings);
    const renamed = ok(renameGesture(ok(renameGesture(WITH, 'gesture-1', 'tmp')), 'gesture-2', 'wave'));
    // The circle now called "wave" (id gesture-2) takes the wave's binding by name; its own,
    // and the renamed wave's, go (an id that changed name and no longer carries its name).
    expect(rekeyBindings(targets(WITH), bindings, targets(renamed))).toEqual({ 'cat-1': { command: 'a' }, 'gesture-2': { command: 'wave.cmd' } });
  });

  it('a category and a gesture that share a name never take each other\'s binding', () => {
    // cat-2 is a held category called "wave"; gesture-1 a gesture called "wave".
    const out = rekeyBindings(targets(WITH), { 'cat-2': { command: 'held' }, 'gesture-1': { command: 'moving' } }, targets(WITH));
    expect(out).toEqual({ 'cat-2': { command: 'held' }, 'gesture-1': { command: 'moving' } });
    const noGesture = ok(deleteGesture(WITH, 'gesture-1'));
    expect(rekeyBindings(targets(WITH), { 'gesture-1': { command: 'moving' } }, targets(noGesture))).toEqual({});
  });
});

describe('the export writes one row per line', () => {
  it('rows and times on one line each, and reads back the same', () => {
    const text = exportCategorizer(WITH);
    const pretty = JSON.stringify(PersonalCategorizerSchema.parse(WITH), null, 2);
    const row = WITH.gestures!.items[0].traces[0].rows[0];
    expect(text).toContain(JSON.stringify(row));
    expect(text.length).toBeLessThan(pretty.length / 2);
    const r = importCategorizer(text);
    expect(r.ok && r.categorizer).toEqual(PersonalCategorizerSchema.parse(WITH));
  });

  it('writes the values JSON.stringify writes', () => {
    const v = { a: [1, null, 'x', undefined, NaN], b: { c: undefined, d: [[1, 2], [3]] }, e: [] as number[], f: {} };
    expect(JSON.parse(rowJson(v))).toEqual(JSON.parse(JSON.stringify(v)));
    expect(rowJson(v)).toContain('[1,2]');
  });
});

describe('the live listener', () => {
  const model = gestureModelFromCategorizer(WITH);

  it('fires a taught gesture once per repetition, on its own noise estimate', () => {
    const take = takeOf('wave', { seed: 5 });
    const listener = createGestureListener(model);
    const fires = take.frames.flatMap((f) => listener.push(f.v, f.t) ?? []);
    expect(fires.map((f) => f.gesture)).toEqual(Array(take.waves.length).fill('gesture-1'));
  });

  it('a frame without the hand is not read, and a long refractory period swallows the next repetition', () => {
    const take = takeOf('circle', { seed: 6, pauseMs: 600 });
    const listener = createGestureListener(model, { refractoryMs: 5000 });
    const fires = take.frames.flatMap((f) => listener.push(f.v, f.t) ?? []);
    expect(fires.length).toBeGreaterThan(0);
    expect(fires.length).toBeLessThan(take.waves.length);
    expect(listener.push(null, 1e9)).toBeNull();
    expect(listener.push({}, 1e9 + 1)).toBeNull();
  });

  it('runs the matcher it is given (the #755 seam)', () => {
    let made = 0;
    const listener = createGestureListener(model, {
      matcher: () => {
        made += 1;
        return { push: (_v, t) => ({ fired: { gesture: 'gesture-2', t, startT: t, endT: t, confidence: 1, distance: 0, variation: { speed: 1, scale: 1 } }, following: null }), reset: () => {}, inGesture: () => false };
      },
    });
    expect(made).toBe(1);
    expect(listener.push(Object.fromEntries(POSITION.map((f) => [f, 0.5])), 0)?.gesture).toBe('gesture-2');
  });
});
