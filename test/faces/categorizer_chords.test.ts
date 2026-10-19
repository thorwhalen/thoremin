/**
 * Hand shapes and poses play chords (#450): the `categorizerChords` dial composes the branch of the
 * modality its categorizer is (`hand-chords` on the trunk's hand vector, `pose-chords` on the body
 * source's), and the `categorizer-chord` node turns the settled category into a voiced chord on
 * the chord-source scale: Auto by the category's place (I, IV, V, vi...), the player's own degree
 * when set, silence for the relaxed hand (Neutral), out of view, or a model the dial no longer names.
 *
 * The hand categorizer is a real one: the scripted hand recorded and carved through "Your hand
 * shapes" (the session store with the hand modality), replayed frame by frame through the node.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInMemoryProvider } from '@zodal/store';
import { importCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { Engine, replayNode, StreamRecorder } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { pickCategories } from '@/nodes/output/canvas_overlay';
import { chordPool, chordSelectNode } from '@/nodes/mapping/chord_select';
import { ALL_BRANCHES } from '@/app/graph';
import { CATEGORIZER_CHORD_NODE_ID, CATEGORIZER_CHORD_PRIORITY } from '@thoremin/ext-faces/branches';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { diatonicTriad, type ScaleSpec } from '@thoremin/sdk/music/theory';
import type { PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import type { CategoryScores, SynthParams } from '@thoremin/sdk/nodes/domain';
import type { CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { createCategorizerStore } from '@thoremin/sdk-ui/enroll/categorizers';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { createFaceSessionStore } from '@thoremin/ext-faces/app/sessionStore';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { HAND_SCRIPT, type FaceSource } from '@thoremin/ext-faces/app/sources';
import { SYNTHETIC_HAND_TIMELINE, syntheticHandShapeAt, syntheticHandVector } from '@thoremin/ext-faces/lib/synthetic_hand';
import { categorizerChordPlay, type CategorizerChordPlay } from '@thoremin/ext-faces/lib/categorizerChord';
import { categorizerChordNode, CATEGORIZER_CHORD_VOICE_ID_BASE } from '@thoremin/ext-faces/nodes/categorizer_chord';
import { categoryBlendNode, type BlendControls } from '@thoremin/ext-faces/nodes/category_blend';
import { startCategorizerChords, useCategorizerChords, type CategorizerChordsDeps } from '@thoremin/ext-faces/app/categorizerChords';
import { AUTO_DEGREE, UNSET_BLEND_VALUE, chordDegreeOf, chordModalityOf, chooseCategorizerChordsWrites, DEFAULT_CATEGORIZER_CHORDS, ORDER_DEGREES, type CategorizerChordsDial } from '@thoremin/ext-faces/schema';
import type { FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { FACES } from '../helpers/extensions';
import { POSES, poseVector, scriptedPoseCategorizer } from '../helpers/body_poses';

const seed = () => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === 'Glass Bells')!.layer);
/** The chord selector's inputs in pool order (a, b, c.., chord27..), each named by what feeds it. */
const POOL = chordPool(64);
const chordInputs = (spec: { edges: readonly { from: { node: string; port: string }; to: { node: string; port: string } }[] }) =>
  spec.edges.filter((e) => e.to.node === 'chordSel').sort((x, y) => POOL.indexOf(x.to.port) - POOL.indexOf(y.to.port)).map((e) => `${e.from.node}.${e.from.port}`);
const withChords = (id: string) => ({ ...seed(), categorizerChords: { ...DEFAULT_CATEGORIZER_CHORDS, id } });
const into = (spec: { edges: readonly { from: { node: string; port: string }; to: { node: string; port: string } }[] }, node: string, port: string) =>
  spec.edges.filter((e) => e.to.node === node && e.to.port === port).map((e) => `${e.from.node}.${e.from.port}`);
const cMajor: ScaleSpec = { root: 0, type: 'major', octaves: 2, baseOctave: 3 };

describe('the dial (pure)', () => {
  it('the modality from the id; Auto by place; the player\'s own degree; none of these is silence', () => {
    expect(chordModalityOf('hand:fists')).toBe('hand');
    expect(chordModalityOf('body:conducting')).toBe('body');
    expect(chordModalityOf('')).toBeNull();
    expect(chordModalityOf('smile')).toBeNull(); // a face categorizer's id
    expect(chordModalityOf('trained:x')).toBeNull();
    expect(chordModalityOf('hand:')).toBeNull();
    const dial = { ...DEFAULT_CATEGORIZER_CHORDS, degrees: { ...DEFAULT_CATEGORIZER_CHORDS.degrees, 'cat-2': 6 } };
    expect([0, 1, 2, 3].map((i) => chordDegreeOf(DEFAULT_CATEGORIZER_CHORDS, `cat-${i + 1}`, i))).toEqual([0, 3, 4, 5]);
    expect(chordDegreeOf(dial, 'cat-2', 1)).toBe(6);
    expect(chordDegreeOf(dial, null, null)).toBe(-1);
    expect(chordDegreeOf(dial, 'cat-9', 7)).toBe(ORDER_DEGREES[0]);
    const writes = chooseCategorizerChordsWrites('hand:x');
    expect(writes[0]).toEqual(['categorizerChords.id', 'hand:x']);
    // Every slot back to Auto, its target back to '' (its degree, H6 of #613), its blend value unset (#372).
    expect(
      writes
        .slice(1)
        .every(([k, v]) =>
          k.startsWith('categorizerChords.degrees.') ? v === AUTO_DEGREE : k.startsWith('categorizerChords.targets.') ? v === '' : k.startsWith('categorizerChords.blendValues.') && v === UNSET_BLEND_VALUE,
        ),
    ).toBe(true);
  });
});

describe.runIf(FACES)('the dial composes the branch of its categorizer\'s modality', () => {
  it('nothing by default, nor for a face or unknown id; a hand id composes hand-chords on the trunk\'s hand vector', () => {
    expect(branchIdsFor(seed())).not.toContain('hand-chords');
    expect(branchIdsFor(withChords('smile'))).not.toEqual(expect.arrayContaining(['hand-chords']));
    const ids = branchIdsFor(withChords('hand:fists'));
    expect(ids).toContain('hand-chords');
    expect(ids).not.toContain('pose-chords');
    const composed = composeInstrumentGraph(ids, {}, createAppRegistry());
    expect(into(composed.spec, 'catChord', 'vector')).toEqual(['handVec.vector']);
    expect(into(composed.spec, 'catChord', 'model')).toEqual(['ui.categorizerChordsModel']);
    expect(into(composed.spec, 'catChord', 'spec')).toEqual(['ui.chordSpec']);
    // Its reading takes the overlay's first categorizer input (#600 S10b: a pool, was `chordCategories`).
    expect(into(composed.spec, 'overlay', 'categorizer1')).toEqual(['catChord.category']);
    // The chord it plays is named and highlighted (#491), through the chord selector's pool (#600
    // S10b: was its own `categorizerChord` port), behind every other chord, feeding the overlay's
    // chord display.
    expect(chordInputs(composed.spec).at(-1)).toBe('catChord.triad');
    expect(into(composed.spec, 'overlay', 'chord')).toEqual(['chordSel.chord']);
    expect(composed.elements).toEqual(expect.arrayContaining(['categoryLabel', 'categoryBars', 'chordName', 'chordGuide']));
    // The category blend (#372): the reading in, the dial in, its controls back a tick later.
    expect(into(composed.spec, 'catBlend', 'category')).toEqual(['catChord.category']);
    expect(into(composed.spec, 'catBlend', 'config')).toEqual(['ui.categorizerChords']);
    const back = composed.spec.edges.find((e) => e.to.node === 'catChord' && e.to.port === 'controls');
    expect(back?.from).toEqual({ node: 'catBlend', port: 'controls' });
    expect(back?.delayed).toBe(true);
    // Its voices reach the merge (the structural guard: a chord nobody hears is not shipped).
    expect(composed.spec.edges.some((e) => e.from.node === 'catChord' && e.from.port === 'params' && e.to.node === 'merge')).toBe(true);
  });

  it('a body id composes pose-chords with the body source; with the pose categorizer too, no fan-in', () => {
    const s = { ...withChords('body:poses'), poseCategorizer: { id: 'body:poses', transport: false } };
    const ids = branchIdsFor(s as never);
    expect(ids).toEqual(expect.arrayContaining(['pose-chords', 'pose-categorizer']));
    const composed = composeInstrumentGraph(ids, {}, createAppRegistry());
    expect(composed.branches).toContain('body-source');
    expect(into(composed.spec, 'catChord', 'vector')).toEqual(['bodyVec.vector']);
    expect(into(composed.spec, 'catBlend', 'category')).toEqual(['catChord.category']);
    // The pose categorizer's reading first, the categorizer chord's second (#600 S10b: the pool).
    expect(into(composed.spec, 'overlay', 'categorizer2')).toEqual(['catChord.category']);
    expect(into(composed.spec, 'overlay', 'categorizer1')).toEqual(['poseCat.category']);
    expect(chordInputs(composed.spec).at(-1)).toBe('catChord.triad');
    expect(composed.elements).toEqual(expect.arrayContaining(['chordName', 'chordGuide']));
  });

  it('its chord shows only while no other sounds: the lowest priority declared, behind a face chord (#600 S10b)', () => {
    const others = Object.values(ALL_BRANCHES).flatMap((b) => b.chords.filter((c) => c.from.node !== CATEGORIZER_CHORD_NODE_ID).map((c) => c.priority));
    expect(others.length).toBeGreaterThan(0);
    expect(Math.min(...others)).toBeGreaterThan(CATEGORIZER_CHORD_PRIORITY);
    const composed = composeInstrumentGraph(['face-chord', 'hand-chords'], {}, createAppRegistry());
    expect(chordInputs(composed.spec)).toEqual(['exprChord.triad', 'catChord.triad']);
  });

  it('the composed graph compiles and ticks against the real registry, its ports validated', () => {
    const registry = createAppRegistry();
    const recorder = new StreamRecorder({ only: ['catChord.params'] });
    const engine = new Engine(composeInstrumentGraph(branchIdsFor(withChords('hand:fists')), undefined, registry).spec, registry, { taps: [recorder], validatePorts: true });
    for (let i = 0; i < 20; i++) engine.tick();
    expect(recorder.values('catChord.params')).toHaveLength(20);
    engine.dispose();
  });
});

// ---- a real hand categorizer, replayed ---------------------------------------------------------

let clock = 0;
const STREAM = {} as MediaStream;
const CYCLE_MS = SYNTHETIC_HAND_TIMELINE.holdMs + SYNTHETIC_HAND_TIMELINE.glideMs;

async function carveHands(): Promise<CategorizerRecord> {
  const models = createCategorizerStore(handModality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });
  const source = (): FaceSource => {
    const start = clock;
    let frame = 0;
    return { kind: 'synthetic', read: () => ({ vector: HAND_SCRIPT.vectorAt(clock - start, frame++), t: clock }), video: () => STREAM, dispose: () => {} };
  };
  const store = createFaceSessionStore({
    source,
    thumbs: memoryThumbStore(),
    frames: () => null,
    models,
    modality: handModality,
    now: () => clock,
    pollMs: 33,
    claim: () => {},
    newTakeId: () => 'take-chords',
    isoNow: () => '2026-10-14T00:00:00.000Z',
  });
  store.getState().start();
  for (let t = 0; t < SYNTHETIC_HAND_TIMELINE.restMs + 16 * CYCLE_MS; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
  await store.getState().stop();
  expect(await store.getState().save('Shapes')).toBe(true);
  return (await models.load('hand:shapes'))!;
}

describe.runIf(FACES)('a saved hand categorizer plays chords (the scripted hand, replayed)', () => {
  let record: CategorizerRecord;
  let categorizer: PersonalCategorizer;
  let play: CategorizerChordPlay;

  beforeAll(async () => {
    vi.useFakeTimers();
    clock = 1000;
    record = await carveHands();
    vi.useRealTimers();
    categorizer = record.model.categorizer;
    play = categorizerChordPlay({ id: record.id, name: record.name, modality: 'hand', categorizer });
  }, 60_000);
  afterEach(() => vi.useRealTimers());

  /** The scripted hand from the end of the rest, a frame per 33 ms, with its shape's name. */
  const script = () => {
    const out: { shape: string; vector: ReturnType<typeof syntheticHandVector>; ms: number }[] = [];
    for (let f = 0, ms = SYNTHETIC_HAND_TIMELINE.restMs; ms < SYNTHETIC_HAND_TIMELINE.restMs + 10 * CYCLE_MS; f++, ms += 33) out.push({ shape: syntheticHandShapeAt(ms).name, vector: syntheticHandVector(ms, 5000 + f), ms });
    return out;
  };

  const replay = async (config: Partial<CategorizerChordsDial>, model: CategorizerChordPlay | null = play, controls?: readonly (BlendControls | undefined)[]) => {
    const frames = script();
    const node = categorizerChordNode.make(categorizerChordNode.params.parse({}));
    const n = frames.length;
    const out = await replayNode(
      node,
      { vector: frames.map((x) => x.vector), model: frames.map(() => model), config: frames.map(() => config), spec: frames.map(() => cMajor), octaveShift: frames.map(() => 0), chordConfig: frames.map(() => ({})), controls: frames.map((_, i) => controls?.[i]) },
      { dt: 1 / 30 },
    );
    expect(out).toHaveLength(n);
    return frames.map((x, i) => ({ ...x, params: out[i].params as SynthParams, category: out[i].category as CategoryScores, triad: out[i].triad as number[] }));
  };

  /** The frame 1 s into each hold (settled), by shape, in order. */
  const settled = <T extends { ms: number; shape: string }>(xs: readonly T[]): T[] =>
    xs.filter((x) => {
      const into = (x.ms - SYNTHETIC_HAND_TIMELINE.restMs) % CYCLE_MS;
      return into >= SYNTHETIC_HAND_TIMELINE.glideMs + 1000 && into < SYNTHETIC_HAND_TIMELINE.glideMs + 1033;
    });

  it('each shape plays its category\'s chord (Auto by place), the relaxed hand plays nothing', async () => {
    const out = await replay({ ...DEFAULT_CATEGORIZER_CHORDS, id: record.id });
    const at = settled(out);
    expect(at.length).toBeGreaterThanOrEqual(8);
    const labels = categorizer.categories.map((c) => c.label);
    const chordOf = new Map<string, string>();
    for (const x of at) {
      const sounding = x.params.voices.filter((v) => v.present);
      for (const v of x.params.voices) expect(v.id).toBeGreaterThanOrEqual(CATEGORIZER_CHORD_VOICE_ID_BASE);
      if (x.shape === 'rest') {
        expect(sounding).toHaveLength(0);
        continue;
      }
      if (!labels.includes(x.shape)) continue;
      expect(x.category.label).toBe(x.shape);
      expect(sounding.length).toBeGreaterThan(0);
      const i = categorizer.categories.findIndex((c) => c.label === x.shape);
      expect(x.triad).toEqual(diatonicTriad(cMajor, ORDER_DEGREES[i % ORDER_DEGREES.length]));
      chordOf.set(x.shape, x.triad.join(','));
    }
    // At least three shapes played, each its own chord.
    expect(chordOf.size).toBeGreaterThanOrEqual(3);
    expect(new Set(chordOf.values()).size).toBe(chordOf.size);
    // The overlay draws it (nothing else reading).
    expect(pickCategories([], [{ scores: at[1].category }]).categories).toBe(at[1].category);
    // ...and names its chord (#491): the categorizer's while the selector holds none, the
    // selector's (a face, pose or sign chord) first; the relaxed hand names nothing.
    const played = at.find((x) => x.triad.length > 0)!;
    // The chord selector (#600 S10b: was `pickChord`): a face, pose or sign chord takes an input
    // ahead of the categorizer's (the lowest priority), and the first non-empty wins.
    const select = chordSelectNode.make(chordSelectNode.params.parse({}));
    const pickChord = (selected: unknown, categorizer: unknown) => (select.process({ a: selected, b: categorizer }, {} as never) as { chord: number[] }).chord;
    expect(pickChord([], played.triad)).toEqual(played.triad);
    expect(pickChord(undefined, played.triad)).toEqual(played.triad);
    expect(pickChord([62, 65, 69], played.triad)).toEqual([62, 65, 69]);
    const rest = at.find((x) => x.shape === 'rest')!;
    expect(pickChord([], rest.triad)).toEqual([]);
  });

  it('the player\'s own degree for a category plays instead of Auto; silence silences it', async () => {
    const fist = categorizer.categories.find((c) => c.label === 'fist')!;
    const own = { ...DEFAULT_CATEGORIZER_CHORDS, id: record.id, degrees: { ...DEFAULT_CATEGORIZER_CHORDS.degrees, [fist.id]: 6 } };
    const fists = settled(await replay(own)).filter((x) => x.shape === 'fist');
    expect(fists.length).toBeGreaterThan(0);
    for (const x of fists) expect(x.triad).toEqual(diatonicTriad(cMajor, 6));
    const quiet = { ...own, degrees: { ...own.degrees, [fist.id]: -1 } };
    for (const x of settled(await replay(quiet)).filter((y) => y.shape === 'fist')) expect(x.params.voices.every((v) => !v.present)).toBe(true);
  });

  it('a category\'s own target plays (H6 of #613): adding the seventh to the chord in force while held', async () => {
    const fist = categorizer.categories.find((c) => c.label === 'fist')!;
    const own = { ...DEFAULT_CATEGORIZER_CHORDS, id: record.id, targets: { ...DEFAULT_CATEGORIZER_CHORDS.targets, [fist.id]: 'ctl:seventh' } };
    const fists = settled(await replay(own)).filter((x) => x.shape === 'fist');
    expect(fists.length).toBeGreaterThan(0);
    for (const x of fists) {
      const pcs = new Set(x.params.voices.filter((v) => v.present).map((v) => Math.round(12 * Math.log2(v.freq / 440) + 69) % 12));
      expect(pcs.size, `fist at ${x.ms} ms`).toBe(4); // a seventh chord
    }
  });

  /** The categorizer chord with the category blend fed back on its delayed edge, as composed. */
  const replayBlended = async (config: Partial<CategorizerChordsDial>) => {
    const first = await replay(config);
    const blend = categoryBlendNode.make(categoryBlendNode.params.parse({}));
    const controls = (await replayNode(blend, { category: first.map((x) => x.category), config: first.map(() => config) }, { dt: 1 / 30 })).map((o) => o.controls as BlendControls);
    // The delayed edge: the blend from the tick before (the category stream is the same either way).
    return { out: await replay(config, play, [undefined, ...controls.slice(0, -1)]), controls };
  };
  const valuesFor = (fist: number, other: number) =>
    Object.fromEntries(categorizer.categories.map((c) => [c.id, c.label === 'fist' ? fist : other])) as CategorizerChordsDial['blendValues'];

  it('the category blend (#372) moves the chord\'s brightness between the categories\' values, smoothly', async () => {
    const config = { ...DEFAULT_CATEGORIZER_CHORDS, id: record.id, blend: 'brightness' as const, blendValues: valuesFor(1, 0) };
    const { out, controls } = await replayBlended(config);
    const at = settled(out);
    const bright = (x: (typeof at)[number]) => x.params.voices.find((v) => v.present)?.brightness;
    const fists = at.filter((x) => x.shape === 'fist');
    const others = at.filter((x) => x.shape !== 'fist' && x.shape !== 'rest' && x.params.voices.some((v) => v.present));
    expect(fists.length).toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);
    for (const x of fists) expect(bright(x), `fist at ${x.ms} ms`).toBeGreaterThan(0.8);
    for (const x of others) expect(bright(x), `${x.shape} at ${x.ms} ms`).toBeLessThan(0.2);
    // Between the holds it passes through the middle rather than switching: some frame reads 0.3..0.7.
    const values = controls.map((c) => c.brightness).filter((v): v is number => typeof v === 'number');
    expect(values.some((v) => v > 0.3 && v < 0.7)).toBe(true);
    // Off (the default): no brightness on any voice.
    const plain = await replay({ ...DEFAULT_CATEGORIZER_CHORDS, id: record.id });
    expect(plain.every((x) => x.params.voices.every((v) => v.brightness === undefined))).toBe(true);
  });

  it('blended to tension, the fist\'s chord gains the key\'s seventh and the others stay triads', async () => {
    const config = { ...DEFAULT_CATEGORIZER_CHORDS, id: record.id, blend: 'tension' as const, blendValues: valuesFor(1, 0) };
    const at = settled((await replayBlended(config)).out);
    const pcs = (x: (typeof at)[number]) => new Set(x.params.voices.filter((v) => v.present).map((v) => Math.round(12 * Math.log2(v.freq / 440) + 69) % 12)).size;
    const fists = at.filter((x) => x.shape === 'fist');
    const others = at.filter((x) => x.shape !== 'fist' && x.shape !== 'rest' && x.params.voices.some((v) => v.present));
    expect(fists.length).toBeGreaterThan(0);
    for (const x of fists) expect(pcs(x), `fist at ${x.ms} ms`).toBeGreaterThanOrEqual(4);
    for (const x of others) expect(pcs(x), `${x.shape} at ${x.ms} ms`).toBe(3);
  });

  it('a category whose target adds the seventh keeps it under a blended tension of 0 (one colouring rule)', async () => {
    const fist = categorizer.categories.find((c) => c.label === 'fist')!;
    const config = {
      ...DEFAULT_CATEGORIZER_CHORDS,
      id: record.id,
      targets: { ...DEFAULT_CATEGORIZER_CHORDS.targets, [fist.id]: 'ctl:seventh' },
      blend: 'tension' as const,
      blendValues: valuesFor(0, 0),
    };
    const fists = settled((await replayBlended(config)).out).filter((x) => x.shape === 'fist');
    expect(fists.length).toBeGreaterThan(0);
    for (const x of fists) {
      const pcs = new Set(x.params.voices.filter((v) => v.present).map((v) => Math.round(12 * Math.log2(v.freq / 440) + 69) % 12));
      expect(pcs.size, `fist at ${x.ms} ms`).toBe(4);
    }
  });

  it('a model the dial does not name, or no hand in view, plays nothing', async () => {
    const stale = await replay({ ...DEFAULT_CATEGORIZER_CHORDS, id: 'hand:other' });
    expect(stale.every((x) => x.params.voices.every((v) => !v.present))).toBe(true);
    const node = categorizerChordNode.make(categorizerChordNode.params.parse({}));
    const out = await replayNode(node, { vector: [{}, {}, {}], model: [play, play, play], config: [{ id: record.id }, { id: record.id }, { id: record.id }], spec: [cMajor, cMajor, cMajor] }, { dt: 1 / 30 });
    for (const o of out) {
      expect((o.params as SynthParams).voices.every((v) => !v.present)).toBe(true);
      expect((o.category as CategoryScores).present).toBe(false);
    }
  });
});

describe.runIf(FACES)('the resolver (off the tick)', () => {
  // A real categorizer file (the shipped demo), stamped with the modality under test.
  const file = importCategorizer(readFileSync(join(process.cwd(), 'public/categorizers/demo-smile.json'), 'utf8'));
  if (!file.ok) throw new Error(file.error);
  const record = (id: string, modality: string): FaceModelRecord => ({ id, name: id, createdAt: 0, model: { categorizer: { ...file.categorizer, modality } } }) as unknown as FaceModelRecord;

  it('claims the hand groups while a hand categorizer is named, publishes it, and releases at none', async () => {
    let dial: Partial<CategorizerChordsDial> = { id: 'hand:fists' };
    let listener = () => {};
    const claims: (string | null)[] = [];
    const published: (CategorizerChordPlay | null)[] = [];
    const deps: CategorizerChordsDeps = {
      load: async (modality, id) => (modality === 'hand' && id === 'hand:fists' ? record(id, handModality.id) : id === 'body:p' ? record(id, 'hand') : null),
      dial: () => dial,
      subscribe: (l) => ((listener = l), () => {}),
      onModelsChanged: () => () => {},
      publish: (p) => published.push(p),
      claim: (m) => claims.push(m),
    };
    const stop = startCategorizerChords(deps);
    await vi.waitFor(() => expect(useCategorizerChords.getState().phase).toBe('ready'));
    expect(claims[0]).toBe('hand');
    expect(published.at(-1)?.id).toBe('hand:fists');
    expect(useCategorizerChords.getState().categories).toEqual(file.categorizer.categories.map((c) => ({ id: c.id, name: c.label })));
    // A body id whose record is not a body categorizer: missing, nothing plays.
    dial = { id: 'body:p' };
    listener();
    await vi.waitFor(() => expect(useCategorizerChords.getState().phase).toBe('missing'));
    expect(claims.at(-1)).toBe('body');
    expect(published.at(-1)).toBeNull();
    dial = { id: '' };
    listener();
    await vi.waitFor(() => expect(useCategorizerChords.getState().phase).toBe('none'));
    expect(claims.at(-1)).toBeNull();
    stop();
    expect(claims.at(-1)).toBeNull();
    void bodyModality;
  });
});

describe.runIf(FACES)('a saved pose categorizer plays chords (#468: the same node, the body modality)', () => {
  it('each pose its chord by place, through the body vector', async () => {
    const names = ['ready', 'fermata', 'cut-off'] as const;
    const categorizer = scriptedPoseCategorizer([...names]);
    const play = categorizerChordPlay({ id: 'body:conducting', name: 'Conducting', modality: 'body', categorizer });
    const frames = names.flatMap((n, c) => Array.from({ length: 20 }, (_, f) => ({ pose: n, vector: poseVector(POSES[n], 50_000 + 100 * c + f) })));
    const node = categorizerChordNode.make(categorizerChordNode.params.parse({}));
    const config = { ...DEFAULT_CATEGORIZER_CHORDS, id: 'body:conducting' };
    const out = await replayNode(node, { vector: frames.map((x) => x.vector), model: frames.map(() => play), config: frames.map(() => config), spec: frames.map(() => cMajor) }, { dt: 1 / 30 });
    names.forEach((n, c) => {
      const last = out[20 * c + 19];
      expect((last.category as CategoryScores).label).toBe(n);
      const i = categorizer.categories.findIndex((x) => x.label === n);
      expect(last.triad).toEqual(diatonicTriad(cMajor, ORDER_DEGREES[i]));
      expect((last.params as SynthParams).voices.some((v) => v.present)).toBe(true);
    });
  });
});

describe('voice id blocks stay disjoint (#450: a collision lets one chord silence another)', () => {
  it('the categorizer chord\'s block overlaps no other producer\'s', async () => {
    const { CHORD_VOICE_ID_BASE, MAX_CHORD_VOICES, POSE_VOICE_ID_BASE, MAX_POSE_VOICES, SCORE_VOICE_ID_BASE } = await import('@/nodes');
    const { FLUTE_VOICE_ID } = await import('@thoremin/ext-air/nodes/air_flute');
    const { MAX_CATEGORIZER_CHORD_VOICES } = await import('@thoremin/ext-faces/nodes/categorizer_chord');
    const blocks: [string, number, number][] = [
      ['hands', 0, 2],
      ['face chord', CHORD_VOICE_ID_BASE, MAX_CHORD_VOICES],
      ['pose chord', POSE_VOICE_ID_BASE, MAX_POSE_VOICES],
      // The score counts up from its base, one id per note of the piece: give it a million.
      ['score', SCORE_VOICE_ID_BASE, 1_000_000 - SCORE_VOICE_ID_BASE],
      ['air flute', FLUTE_VOICE_ID, 1],
      ['categorizer chord', CATEGORIZER_CHORD_VOICE_ID_BASE, MAX_CATEGORIZER_CHORD_VOICES],
    ];
    try {
      const asl = await import('@thoremin/ext-asl/nodes/sign_chord');
      blocks.push(['sign chord', asl.SIGN_CHORD_VOICE_ID_BASE, 4]);
    } catch {
      // ASL is a git dependency: absent in a build without it.
    }
    for (const [a, sa, na] of blocks)
      for (const [b, sb, nb] of blocks) if (a !== b) expect(sa + na <= sb || sb + nb <= sa, `${a} vs ${b}`).toBe(true);
  });
});
