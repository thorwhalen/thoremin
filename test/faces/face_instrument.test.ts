/**
 * An instrument chooses its face categorizer (#330 P4): the `faceCategorizer` dial composes the
 * faces extension's branch in place of the general face chord (rule 5 of `composeGraph`), the
 * general model stays composed under it as its fallback, and nothing changes for an instrument
 * that keeps the default. The resolved model reaches the graph through the transient the
 * manifest declares, set by the host off the tick (`startCategorizerPlay`).
 */
import { describe, expect, it } from 'vitest';
import { Engine, StreamRecorder } from '@thoremin/dag';
import { createAppRegistry } from '@/nodes/browser';
import { branchIdsFor, composeInstrumentGraph } from '@/app/graph';
import { SEED_INSTRUMENTS } from '@/app/dials/instruments';
import { settingsFromLayer } from '@/app/library/derive';
import { categorizerFromModel, type PersonalCategorizer } from '@thoremin/sdk/enroll';
import { createFaceTake } from '@thoremin/ext-faces/lib/take';
import { carveView, carverFor } from '@thoremin/ext-faces/lib/carving';
import { SYNTHETIC_TIMELINE, syntheticFaceVector } from '@thoremin/ext-faces/lib/synthetic';
import type { FaceCategorizerPlay } from '@thoremin/ext-faces/lib/play';
import { startCategorizerPlay, useCategorizerPlay, type CategorizerPlayDeps } from '@thoremin/ext-faces/app/categorizerPlay';
import type { FaceModelRecord } from '@thoremin/ext-faces/app/models';
import { chooseCategorizerWrites, DEFAULT_FACE_CATEGORIZER, GENERAL_CATEGORIZER, type FaceCategorizerDial } from '@thoremin/ext-faces/schema';
import { FACES } from '../helpers/extensions';

const seed = (name: string) => settingsFromLayer(SEED_INSTRUMENTS.find((s) => s.name === name)!.layer);
const withCategorizer = (s: ReturnType<typeof seed>, id: string) => ({ ...s, faceCategorizer: { ...DEFAULT_FACE_CATEGORIZER, id } });

describe.runIf(FACES)('the dial picks the categorizer the face chords read', () => {
  it('the default is the general model: the face chord composes exactly as before', () => {
    const s = seed('Glass Bells');
    expect((s.faceCategorizer as FaceCategorizerDial).id).toBe(GENERAL_CATEGORIZER);
    expect(branchIdsFor(s).sort()).toEqual(['face-chord', 'face-source', 'field-voices']);
  });

  it('a personal categorizer composes its branch in place of the general chord, the general model under it', () => {
    const ids = branchIdsFor(withCategorizer(seed('Glass Bells'), 'mine'));
    expect(ids).toEqual(expect.arrayContaining(['face-chord', 'face-categorizer']));
    const composed = composeInstrumentGraph(ids, {}, createAppRegistry());
    expect(composed.branches).not.toContain('face-chord');
    expect(composed.branches).toEqual(expect.arrayContaining(['face-categorizer', 'face-expression', 'face-chord-voice']));
    const into = (node: string, port: string) => composed.spec.edges.filter((e) => e.to.node === node && e.to.port === port).map((e) => `${e.from.node}.${e.from.port}`);
    expect(into('exprChord', 'expression')).toEqual(['faceCat.expression']);
    expect(into('faceCat', 'general')).toEqual(['faceExpr.expression']);
    expect(into('faceCat', 'model')).toEqual(['ui.faceCategorizerModel']);
    expect(into('overlay', 'expression')).toEqual(['faceCat.expression']);
  });

  it('only where the face plays chords: a timbre or a silent face never composes it', () => {
    const timbre = { ...withCategorizer(seed('Glass Bells'), 'mine'), faceMapping: 'timbre' as const };
    expect(branchIdsFor(timbre)).not.toContain('face-categorizer');
  });

  it('the composed graph compiles and ticks against the real registry, its ports validated', () => {
    const registry = createAppRegistry();
    const ids = branchIdsFor(withCategorizer(seed('Glass Bells'), 'mine'));
    const recorder = new StreamRecorder({ only: ['merge.params', 'faceCat.expression'] });
    const engine = new Engine(composeInstrumentGraph(ids, undefined, registry).spec, registry, { taps: [recorder], validatePorts: true });
    for (let i = 0; i < 30; i++) engine.tick();
    expect(recorder.values('merge.params')).toHaveLength(30);
    expect(recorder.values('faceCat.expression')).toHaveLength(30);
    engine.dispose();
  });

  it('choosing a categorizer is one patch: the id, every category back to Auto, and the face chords on when the face did nothing', () => {
    const writes = chooseCategorizerWrites('mine', 'none');
    expect(writes[0]).toEqual(['faceCategorizer.id', 'mine']);
    expect(writes.filter(([k]) => k.startsWith('faceCategorizer.degrees.'))).toHaveLength(12);
    expect(writes).toContainEqual(['face.mapping', 'chord']);
    expect(chooseCategorizerWrites('mine', 'timbre')).not.toContainEqual(['face.mapping', 'chord']);
    expect(chooseCategorizerWrites(GENERAL_CATEGORIZER, 'none')).not.toContainEqual(['face.mapping', 'chord']);
  });
});

/** A synthetic categorizer, saved as a record. */
function savedRecord(id: string): FaceModelRecord {
  const take = createFaceTake();
  take.start(0);
  const ms = SYNTHETIC_TIMELINE.restMs + 12 * (SYNTHETIC_TIMELINE.holdMs + SYNTHETIC_TIMELINE.glideMs);
  for (let f = 0, t = 0; t <= ms; f++, t = (f * 1000) / 30) take.push(syntheticFaceVector(t, f), t);
  take.stop();
  const session = take.session();
  const carver = carverFor(session, take.restVectors(), 'reject');
  const view = carveView({ session, restVectors: take.restVectors(), carver, k: carver.suggestedK() });
  const categorizer: PersonalCategorizer = categorizerFromModel(view.model, session.points(), { name: id, mode: 'reject', modality: 'face' });
  return { id, name: id.toUpperCase(), createdAt: 0, model: { categorizer } };
}

/** In-memory dependencies: a dial, a records map, and what was published. */
function harness(records: Record<string, FaceModelRecord>) {
  let dial: Partial<FaceCategorizerDial> = { ...DEFAULT_FACE_CATEGORIZER };
  const listeners = new Set<() => void>();
  const changed = new Set<() => void>();
  const published: (FaceCategorizerPlay | null)[] = [];
  const gates: (() => void)[] = [];
  let gated = false;
  const deps: CategorizerPlayDeps = {
    load: async (id) => {
      if (gated) await new Promise<void>((r) => gates.push(r));
      return records[id] ?? null;
    },
    dial: () => dial,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    onModelsChanged: (l) => (changed.add(l), () => changed.delete(l)),
    publish: (p) => published.push(p),
  };
  return {
    deps,
    published,
    set(id: string) {
      dial = { ...dial, id };
      for (const l of listeners) l();
    },
    modelsChanged: () => changed.forEach((l) => l()),
    gate: (on: boolean) => (gated = on),
    release: () => gates.splice(0).forEach((r) => r()),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the host resolves the dial to a model, off the tick', () => {
  it('general publishes null; a saved id publishes its model; an unknown id publishes null and says so', async () => {
    const h = harness({ mine: savedRecord('mine') });
    const stop = startCategorizerPlay(h.deps);
    await settle();
    expect(h.published.at(-1)).toBeNull();
    expect(useCategorizerPlay.getState().phase).toBe('general');
    h.set('mine');
    await settle();
    expect(h.published.at(-1)?.id).toBe('mine');
    expect(useCategorizerPlay.getState()).toMatchObject({ phase: 'ready', id: 'mine', name: 'MINE' });
    h.set('gone');
    await settle();
    expect(h.published.at(-1)).toBeNull();
    expect(useCategorizerPlay.getState().phase).toBe('missing');
    stop();
  });

  it('a later choice wins over a slower earlier load', async () => {
    const h = harness({ a: savedRecord('a'), b: savedRecord('b') });
    const stop = startCategorizerPlay(h.deps);
    await settle();
    h.gate(true);
    h.set('a');
    h.set('b');
    h.release();
    await settle();
    h.release();
    await settle();
    expect(h.published.at(-1)?.id).toBe('b');
    expect(h.published.some((p) => p?.id === 'a')).toBe(false);
    stop();
  });

  it('a saved correction reaches the instrument: the record is read again', async () => {
    const records = { mine: savedRecord('mine') };
    const h = harness(records);
    const stop = startCategorizerPlay(h.deps);
    h.set('mine');
    await settle();
    const before = h.published.at(-1);
    records.mine = { ...records.mine, name: 'Mine, corrected' };
    h.modelsChanged();
    await settle();
    expect(h.published.at(-1)).not.toBe(before);
    expect(useCategorizerPlay.getState().name).toBe('Mine, corrected');
    stop();
  });
});
