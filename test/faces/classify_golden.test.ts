/**
 * Old categorizer files classify EXACTLY as they did before Neutral became a modelled class
 * (#385 E5, #426).
 *
 * The golden (`fixtures/classify.golden.json`) was written BEFORE E5, at main 009d3a4, by this
 * same replay: every categorizer the repo ships or keeps as a fixture (version 1 and version 2),
 * the recorded `video_face_expressions` categorizer, and a version-2 file of the shape E4 could
 * save (strangers read as the nearest face, with holds in the Neutral bin, which E4 did not
 * train on), each imported (so migrated to the current version) and read under its default
 * tuning. The probes are every sample, the midpoint of each sample with another, and (for the
 * recording) every frame. Each probe's pure classification (`classify`: the category and
 * whether it was rejected) and the settled reading of the live reader fed the probes in order
 * (`createLiveReader`, each probe held a few frames: the tracker's hysteresis included) are kept as id sequences, so a
 * difference names the probe. `GOLDEN_WRITE=1` rewrites it, which a migrated file must never
 * need.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importCategorizer, type PersonalCategorizer } from '@thoremin/sdk/enroll/categorizer';
import { classify } from '@thoremin/sdk/enroll/classify';
import type { FeatureVector } from '@thoremin/sdk/enroll/types';
import { createLiveReader, liveModel, tuneVector } from '@thoremin/ext-faces/lib/live';
import { FaceModelRecordSchema } from '@thoremin/ext-faces/app/models';
import { recordedCategorizer, recordedFrames, vectorOf } from '../helpers/faceRecording';

const FIXTURES = join(__dirname, 'fixtures');
const GOLDEN = join(FIXTURES, 'classify.golden.json');
/** Frames each probe is held for the live reader. */
const HOLD_FRAMES = 4;

/** A file as the app reads it: imported, so migrated to this build's version. */
function load(json: string): PersonalCategorizer {
  const r = importCategorizer(json);
  if (!r.ok) throw new Error(r.error);
  return r.categorizer;
}

const readFile = (path: string): PersonalCategorizer => {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  return load(JSON.stringify(doc.categorizer ?? doc));
};

/** The scenarios: a name, the file, and extra probes beyond its samples and their midpoints. */
function scenarios(): { name: string; categorizer: PersonalCategorizer; extra: FeatureVector[] }[] {
  const frames = recordedFrames().map(vectorOf);
  // The recording as a version-2 file (what the builder made before version 3).
  const { neutralTrained: _t, ...recordedV2 } = recordedCategorizer(recordedFrames()) as PersonalCategorizer & { neutralTrained?: boolean };
  void _t;
  const recorded = load(JSON.stringify({ ...recordedV2, version: 2 }));
  // The shipped demo as it was shipped at version 2 (kept as a fixture: the shipped file moves on).
  const demo = readFile(join(FIXTURES, 'demo_smile.v2.categorizer.json'));
  // What E4 could save: the demo read as the nearest face, its resting holds left in Neutral
  // (E4 did not train on them).
  const { rejectRadius: _r, ...demoRest } = demo;
  void _r;
  const { neutralTrained: _d, ...demoV2 } = { ...demoRest, strangers: 'nearest', version: 2 } as Record<string, unknown>;
  void _d;
  const e4Nearest = load(JSON.stringify(demoV2));
  return [
    { name: 'demo_smile.v1', categorizer: readFile(join(FIXTURES, 'demo_smile.v1.categorizer.json')), extra: [] },
    { name: 'synthetic_partition.v1', categorizer: readFile(join(FIXTURES, 'synthetic_partition.v1.categorizer.json')), extra: [] },
    { name: 'two_faces.v1', categorizer: readFile(join(FIXTURES, 'two_faces.categorizer.json')), extra: [] },
    { name: 'demo-smile (shipped v2)', categorizer: demo, extra: frames },
    { name: 'demo-smile as nearest, Neutral untrained (E4)', categorizer: e4Nearest, extra: frames },
    { name: 'recorded video_face_expressions (reject)', categorizer: recorded, extra: frames },
  ];
}

function probes(c: PersonalCategorizer, extra: readonly FeatureVector[]): FeatureVector[] {
  const vs = c.samples.map((s) => s.vector);
  const mid = (a: FeatureVector, b: FeatureVector): FeatureVector => {
    const out: FeatureVector = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = ((a[k] ?? 0) + (b[k] ?? 0)) / 2;
    return out;
  };
  return [...vs, ...vs.map((v, i) => mid(v, vs[(i * 7 + 3) % vs.length])), ...extra];
}

/** One scenario's readings as compact sequences: `-` none, `!` rejected, else the category id. */
function readings(c: PersonalCategorizer, extra: readonly FeatureVector[]) {
  const live = liveModel(c);
  const reader = createLiveReader(live);
  const pure: string[] = [];
  const settled: string[] = [];
  for (const v of probes(c, extra)) {
    const r = classify(live.model, tuneVector(live, v), { temperature: live.temperature });
    pure.push(r.rejected ? '!' : (r.categoryId ?? '-'));
    // Each probe held for a few frames, so the tracker can settle on it (one frame never would).
    let r2 = reader.push(v);
    for (let i = 1; i < HOLD_FRAMES; i++) r2 = reader.push(v);
    settled.push(r2.categoryId ?? '-');
  }
  return { pure: pure.join(' '), settled: settled.join(' ') };
}

describe('old categorizer files classify as before Neutral was a modelled class (#385 E5)', () => {
  const now = Object.fromEntries(scenarios().map((s) => [s.name, readings(s.categorizer, s.extra)]));

  if (process.env.GOLDEN_WRITE === '1') {
    writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof now;

  it('covers the same scenarios', () => {
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
  });
  for (const name of Object.keys(golden)) {
    it(`${name}: every probe reads the same category, purely and settled`, () => {
      expect(now[name]).toEqual(golden[name]);
    });
  }

  it('a version-2 SAVED record (the tool\'s collection, migrated on load) reads as the golden too', () => {
    const doc = JSON.parse(readFileSync(join(FIXTURES, 'demo_smile.v2.categorizer.json'), 'utf8'));
    const record = FaceModelRecordSchema.parse({ id: 'r1', name: 'Old', createdAt: 0, model: { categorizer: doc } });
    expect(record.model.categorizer.neutralTrained).toBe(false);
    const extra = recordedFrames().map(vectorOf);
    expect(readings(record.model.categorizer, extra)).toEqual(golden['demo-smile (shipped v2)']);
  });
});
