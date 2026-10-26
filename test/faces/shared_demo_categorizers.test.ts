/**
 * The shipped hand-shape and pose demo categorizers (#330 P5), and where they come from: each is
 * carved by the real session store from the scripted hand or body (`?carve.source=synthetic`, no
 * person), its categories named after the scripted shapes, exported as P1's file. This test is
 * their provenance: it carves them again and compares with the files in `public/categorizers/`;
 * `UPDATE_DEMO_CATEGORIZERS=1 npx vitest run test/faces/shared_demo_categorizers.test.ts` rewrites
 * them. It also reads each back as the shared source would (its modality checked) and checks that
 * it names the scripted shapes, so the synthetic sources play them in the app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInMemoryProvider } from '@zodal/store';
import { createCategorizerStore, type CategorizerRecord } from '@thoremin/sdk-ui/enroll/categorizers';
import { exportCategorizer, modelFromCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { classify } from '@thoremin/sdk/enroll/classify';
import type { CarveModality } from '@thoremin/sdk/enroll/modality';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { handModality } from '@thoremin/sdk/features/modalities/hand';
import { bodyModality } from '@thoremin/sdk/features/modalities/body';
import { createFaceSessionStore } from '@thoremin/ext-faces/app/sessionStore';
import { memoryThumbStore } from '@thoremin/ext-faces/app/thumbnails';
import { BODY_SCRIPT, HAND_SCRIPT, type FaceSource, type SyntheticScript } from '@thoremin/ext-faces/app/sources';
import { bodyModalityUi } from '@thoremin/ext-faces/app/bodyModality';
import { createSharedSource } from '@thoremin/ext-faces/app/sharedModels';
import { parseSharedIndex } from '@thoremin/ext-faces/lib/shared';
import { SYNTHETIC_HAND_SHAPES, SYNTHETIC_HAND_TIMELINE } from '@thoremin/ext-faces/lib/synthetic_hand';
import { SYNTHETIC_BODY_TIMELINE, SYNTHETIC_POSES } from '@thoremin/ext-faces/lib/synthetic_body';
import { FACES } from '../helpers/extensions';

const DIR = join(__dirname, '../../public/categorizers');
const UPDATE = process.env.UPDATE_DEMO_CATEGORIZERS === '1';
const STREAM = {} as MediaStream;
let clock = 0;

interface Demo {
  file: string;
  name: string;
  modality: CarveModality;
  script: SyntheticScript;
  /** How long the take runs, ms. */
  takeMs: number;
  /** When each scripted shape (by name, the rest left out) is held, ms from the take's start. */
  holds: Record<string, number>;
}

const H = SYNTHETIC_HAND_TIMELINE;
const B = SYNTHETIC_BODY_TIMELINE;
/** The middle of the k-th hold after `start` (the cycle: a shape, the rest, the next shape...). */
const holdAt = (start: number, span: number, hold: number, k: number) => start + k * span + hold / 2 + 200;

const DEMOS: Demo[] = [
  {
    file: 'demo-hand-shapes',
    name: 'Demo: open, fist, point, pinch',
    modality: handModality,
    script: HAND_SCRIPT,
    takeMs: H.restMs + 16 * (H.holdMs + H.glideMs),
    holds: Object.fromEntries(SYNTHETIC_HAND_SHAPES.slice(1).map((s, i) => [s.name, holdAt(H.restMs, H.holdMs + H.glideMs, H.holdMs, 2 * i)])),
  },
  {
    file: 'demo-poses',
    name: 'Demo: arms up, an arm out, crouch',
    modality: bodyModality,
    script: BODY_SCRIPT,
    takeMs: B.restMs + 3 * B.nuisanceMs + 16 * (B.holdMs + B.glideMs),
    holds: Object.fromEntries(SYNTHETIC_POSES.slice(1).map((p, i) => [p.name, holdAt(B.restMs + 3 * B.nuisanceMs, B.holdMs + B.glideMs, B.holdMs, 2 * i)])),
  },
];

/** Carve the scripted take of `d` through the session store and name each category after the
 *  scripted shape it reads. */
async function carve(d: Demo): Promise<PersonalCategorizer> {
  const models = createCategorizerStore(d.modality, { provider: createInMemoryProvider<CategorizerRecord>([], { idField: 'id', searchFields: ['name'] }) });
  const source = (): FaceSource => {
    const start = clock;
    let frame = 0;
    return { kind: 'synthetic', read: () => ({ vector: d.script.vectorAt(clock - start, frame++), t: clock }), video: () => STREAM, dispose: () => {} };
  };
  const store = createFaceSessionStore({
    source,
    thumbs: memoryThumbStore(),
    frames: () => null,
    ...(d.modality === bodyModality ? { region: bodyModalityUi.region, figure: bodyModalityUi.figure, stillsByDefault: false } : {}),
    models,
    modality: d.modality,
    now: () => clock,
    pollMs: 33,
    claim: () => {},
    newTakeId: () => `take-${d.file}`,
    isoNow: () => '2026-10-20T00:00:00.000Z',
  });
  store.getState().start();
  for (let t = 0; t < d.takeMs; t += 33) {
    clock += 33;
    await vi.advanceTimersByTimeAsync(33);
  }
  await store.getState().stop();
  await vi.advanceTimersByTimeAsync(0);
  expect(await store.getState().save(d.name)).toBe(true);
  const saved = (await models.list())[0];
  const c = (await models.load(saved.id))!.model.categorizer;
  const model = modelFromCategorizer(c);
  const named = new Map<string, string>();
  for (const [shape, ms] of Object.entries(d.holds)) {
    const id = classify(model, d.modality.read(d.script.vectorAt(ms, 900) as FeatureVector)!).categoryId;
    expect(id, `${shape} reads as a category`).not.toBeNull();
    expect(named.has(id!), `${shape} reads as its own category`).toBe(false);
    named.set(id!, shape);
  }
  return { ...c, name: d.name, categories: c.categories.map((cat) => ({ ...cat, label: named.get(cat.id) ?? cat.label })) };
}

/** Parsed JSON with every number rounded to 10 significant digits: platform noise in the last bits drops out, a real change does not. */
const roundedJson = (text: string): unknown =>
  JSON.parse(text, (_k, v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(10)) : v));

describe.runIf(FACES)('the shipped hand-shape and pose demo categorizers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1000;
  });
  afterEach(() => vi.useRealTimers());

  for (const d of DEMOS) {
    it(`${d.file}: carved from the scripted ${d.modality.id}, one category per scripted shape, as committed`, async () => {
      const c = await carve(d);
      expect(c.categories.map((x) => x.label).sort()).toEqual(Object.keys(d.holds).sort());
      const text = `${exportCategorizer(c)}\n`;
      const path = join(DIR, `${d.file}.json`);
      if (UPDATE) writeFileSync(path, text);
      // Numerically equal, not byte-equal: the last bit of a trained weight depends on the platform's `Math` (#828).
      expect(roundedJson(readFileSync(path, 'utf8'))).toEqual(roundedJson(text));
    }, 60_000);
  }

  it('are listed with their modality, and read back only as that modality', async () => {
    const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
    const { entries, error } = parseSharedIndex(index);
    expect(error).toBeNull();
    const source = createSharedSource({ fetchJson: async (p) => (p.endsWith('index.json') ? index : JSON.parse(readFileSync(join(DIR, p.replace('categorizers/', '')), 'utf8'))) });
    for (const d of DEMOS) {
      expect(entries.find((e) => e.name === d.file)?.modality).toBe(d.modality.id);
      const record = await source.load(`shared:${d.file}`, d.modality.id as 'hand' | 'body');
      expect(record?.model.categorizer.modality).toBe(d.modality.id);
      expect(record?.model.categorizer.categories.map((c) => c.id)[0]).toBe('cat-1');
      expect(await source.load(`shared:${d.file}`)).toBeNull(); // not a face one
    }
    expect(await source.load('shared:demo-smile', 'hand')).toBeNull();
    expect(await source.load('shared:demo-smile')).not.toBeNull();
  });
});

describe.runIf(FACES)('Hand-shape Chords and Pose Chords play the shipped demos', () => {
  it('compose the categorizer chords of their modality, naming the shared demo', async () => {
    const { SEED_INSTRUMENTS } = await import('@/app/dials/instruments');
    const { settingsFromLayer } = await import('@/app/library/derive');
    const { branchIdsFor } = await import('@/app/graph');
    const of = (name: string) => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === name)!.layer) as unknown as { categorizerChords: { id: string } };
    expect(of('Hand-shape Chords').categorizerChords.id).toBe('hand:shared:demo-hand-shapes');
    expect(branchIdsFor(of('Hand-shape Chords') as never)).toContain('hand-chords');
    expect(of('Pose Chords').categorizerChords.id).toBe('body:shared:demo-poses');
    expect(branchIdsFor(of('Pose Chords') as never)).toContain('pose-chords');
  });

  it('the resolver reads a shared id from the shipped files, a saved one from the collection', async () => {
    const { browserCategorizerChordsDeps, sharedPartOf, sharedChordId } = await import('@thoremin/ext-faces/app/categorizerChords');
    expect(sharedChordId('hand', 'demo-hand-shapes')).toBe('hand:shared:demo-hand-shapes');
    expect(sharedPartOf('hand', 'hand:shared:demo-hand-shapes')).toBe('shared:demo-hand-shapes');
    expect(sharedPartOf('hand', 'hand:shapes')).toBeNull();
    const asked: string[] = [];
    const shared = { list: async () => ({ entries: [], error: null }), load: async (id: string, m?: string) => (asked.push(`${id}|${m}`), null) };
    await browserCategorizerChordsDeps(shared).load('body', 'body:shared:demo-poses');
    expect(asked).toEqual(['shared:demo-poses|body']);
  });
});
